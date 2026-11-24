#!/usr/bin/env node
// Finds job boards of employers the site does not list that someone in Spain
// could work for, and writes the candidates scripts/remote_levels.py judges.
// A company gets into the daily crawl without a salary in Spain on file when
// it has a posting open to Spain (an office or hybrid job in Spain, or remote
// work naming Spain or Europe) and either one of those states its pay, read
// as the daily crawl reads it (the board's pay fields, or a euro figure the
// description gives), or Levels.fyi knows the company and has a salary of
// its in Spain.
//
//   node scripts/remote_boards.mjs                    # every ATS below
//   node scripts/remote_boards.mjs --ats ashby,lever
//   node scripts/remote_boards.mjs --limit 50         # per ATS, to try it out
//   node scripts/remote_boards.mjs --minutes 60       # stop reading after an hour
//
// No ATS publishes a directory of its customers, so the boards come from
// Common Crawl's URL index: every path under jobs.ashbyhq.com names one. The
// index is read block by block from its files (the cluster index says which
// blocks hold a host); its search API times out. Each board is then read
// through the adapters and the polite client the daily crawl uses.
//
// Only an ATS whose URL carries the board is here. The run stops reading at
// --minutes and writes what it has: the ATS it did not finish are marked
// incomplete, like one that refused. Each run starts somewhere
// else in an ATS's list: one that is cut short by refusals reaches other
// boards the next time. Workable is left out: it refuses anything faster
// than a board every 2.5s, which took 3.5 hours for 4,900 boards and 3 new
// employers; the ones found then stay in remote-boards.json by hand.

import { createReadStream, createWriteStream, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { createInterface } from "node:readline";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { gunzipSync } from "node:zlib";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const CC = "https://data.commoncrawl.org/cc-index/collections";
const UA = "spanishtoptechcompanies-boards/1 (+https://spanishtoptechcompanies.com; finds job boards with postings open to Spain)";

/** ATS -> the SURT prefixes its boards live under, and where the board is:
 * the first path segment, or the host's first label. */
export const SOURCES = {
  greenhouse: { prefixes: ["io,greenhouse,boards)/", "io,greenhouse,job-boards)/"], in: "path" },
  ashby: { prefixes: ["com,ashbyhq,jobs)/"], in: "path" },
  lever: { prefixes: ["co,lever,jobs)/"], in: "path" },
  teamtailor: { prefixes: ["com,teamtailor,"], in: "host", board: (slug) => `${slug}.teamtailor.com` },
  smartrecruiters: { prefixes: ["com,smartrecruiters,jobs)/", "com,smartrecruiters,careers)/"], in: "path" },
  recruitee: { prefixes: ["com,recruitee,"], in: "host" },
  bamboohr: { prefixes: ["com,bamboohr,"], in: "host" },
  personio: { prefixes: ["de,personio,jobs,", "com,personio,jobs,"], in: "host" },
  pinpoint: { prefixes: ["com,pinpointhq,"], in: "host", board: (slug) => `${slug}.pinpointhq.com` },
  rippling: { prefixes: ["com,rippling,ats)/"], in: "path" },
  gem: { prefixes: ["com,gem,jobs)/"], in: "path" },
  factorial: { prefixes: ["com,factorial,", "es,factorial,"], in: "host", board: (slug) => `${slug}.factorial.com` },
};
const NOT_A_BOARD = new Set(["embed", "api", "v1", "jobs", "job_app", "job_board", "boards", "careers", "www", "j",
                             "robots.txt", "favicon.ico", "sitemap.xml", "app", "assets", "static"]);
/** Refusals in a row after which an ATS is left for the next run. */
const HOST_STRIKES = 25;
const THROTTLED = new Set(["retryable_http", "http_error", "timeout"]);

/** The board a SURT key names under `prefix`, or null. */
export function boardOf(key, prefix, where) {
  if (!key.startsWith(prefix)) return null;
  const rest = key.slice(prefix.length);
  let board;
  if (where === "host") board = rest.split(")")[0].split(",")[0];
  else {
    try { board = decodeURIComponent(rest.split(/[/?]/)[0]); } catch { return null; }
  }
  return board && !NOT_A_BOARD.has(board) && /^[a-z0-9][a-z0-9._-]*$/i.test(board) ? board : null;
}

/** Host names a posting's text and links mention: what ties a board to the
 * domain Levels.fyi has for a company. */
export function hostsIn(jobs, max = 400) {
  const found = new Set();
  for (const job of jobs) {
    const text = `${job.descriptionText ?? ""} ${job.url ?? ""} ${job.applyUrl ?? ""}`.toLowerCase();
    for (const [host] of text.matchAll(/\b(?:[a-z0-9-]+\.)+[a-z]{2,10}\b/g)) {
      found.add(host.replace(/^www\./, ""));
      if (found.size >= max) return [...found];
    }
  }
  return [...found];
}

async function fetchRetry(url, init = {}, tries = 5) {
  let last;
  for (let i = 0; i < tries; i += 1) {
    try {
      const response = await fetch(url, { ...init, headers: { "User-Agent": UA, ...init.headers },
                                          signal: AbortSignal.timeout(init.timeoutMs ?? 120_000) });
      if (response.ok) return response;
      last = new Error(`HTTP ${response.status} ${url}`);
    } catch (error) { last = error; }
    await new Promise((resolve) => setTimeout(resolve, 3000 * (i + 1)));
  }
  throw last;
}

/** Board names per ATS from one Common Crawl index. */
async function boardsIn(collection, kinds, cache) {
  const idx = join(cache, `${collection}-cluster.idx`);
  if (!existsSync(idx) || statSync(idx).size < 1e6) {
    const response = await fetchRetry(`${CC}/${collection}/indexes/cluster.idx`, { timeoutMs: 900_000 });
    await pipeline(Readable.fromWeb(response.body), createWriteStream(idx));
  }
  // The block before the first key at or past a prefix may hold its first rows.
  const wanted = kinds.flatMap((kind) => SOURCES[kind].prefixes.map((prefix) => ({ kind, prefix, blocks: [], before: null })));
  for await (const line of createInterface({ input: createReadStream(idx) })) {
    const [head, file, offset, length] = line.split("\t");
    const key = head.split(" ")[0];
    const block = { file, offset: Number(offset), length: Number(length) };
    for (const w of wanted) {
      if (key < w.prefix) w.before = block;
      else if (key.startsWith(w.prefix)) w.blocks.push(block);
    }
  }
  const out = Object.fromEntries(kinds.map((kind) => [kind, new Set()]));
  for (const w of wanted) {
    for (const block of [...(w.before ? [w.before] : []), ...w.blocks]) {
      const response = await fetchRetry(`${CC}/${collection}/indexes/${block.file}`,
        { headers: { Range: `bytes=${block.offset}-${block.offset + block.length - 1}` } });
      const text = gunzipSync(Buffer.from(await response.arrayBuffer())).toString("utf8");
      for (const line of text.split("\n")) {
        const board = boardOf(line.slice(0, line.indexOf(" ")), w.prefix, SOURCES[w.kind].in);
        if (board) out[w.kind].add(SOURCES[w.kind].board?.(board) ?? board);
      }
    }
  }
  return out;
}

/** `list` from another place each day, so a run cut short is not always
 * cut before the same boards. */
export function rotated(list, day = Math.floor(Date.now() / 86_400_000)) {
  const start = list.length ? (day * 7919) % list.length : 0;
  return [...list.slice(start), ...list.slice(0, start)];
}

/** One board's verdict: how many of its postings the daily crawl would list
 * for an employer with no salary here (`open`), how many of those state their
 * pay, and the hosts its postings mention. `toEntry` is jobs.mjs's entry for
 * such a board, so pay counts here exactly when the crawl would show it. */
export function judge(jobs, toEntry) {
  const rows = jobs.map(toEntry).filter(Boolean);
  const paid = rows.filter((row) => row.salary);
  return { postings: jobs.length, open: rows.length, paid: paid.length,
           sample: (paid.length ? paid : rows).slice(0, 2).map((row) => `${row.title} | ${row.location}`.slice(0, 160)),
           hosts: rows.length ? hostsIn(jobs) : [] };
}

/** Milliseconds between two boards of an ATS that gives each board its own
 * host, where the polite client's interval per host slows nothing down:
 * Personio refuses a few hundred boards read as fast as they answer. */
const BOARD_INTERVAL_MS = { personio: 1000, bamboohr: 400 };
/** How long one board may take. */
const BOARD_MS = 120_000;

/** Why a board was not read: `gone` is a board the ATS no longer has (most of
 * what Common Crawl remembers), `refused` and `timeout` are ours to lose, and
 * anything else is an answer the adapter could not read. */
export function cause(error) {
  const code = error?.code;
  if (code === "not_found") return "gone";
  if (code === "timeout") return "timeout";
  if (code === "retryable_http" || code === "http_error") return `refused ${error?.details?.status ?? error?.status ?? "?"}`;
  return `unread ${code ?? error?.name ?? "error"}`;
}

/** "gone 1020, refused 429 3", the commonest first. */
export const causes = (missed) => [...missed].sort((a, b) => b[1] - a[1]).map(([why, n]) => `${why} ${n}`).join(", ");

async function probe(kind, boards, ats, toEntry, wanted, log, deadline) {
  const adapter = ats.adapterFor(kind);
  const found = [];
  const missed = new Map();
  const shown = new Set();
  let strikes = 0;
  let read = 0;
  let next = 0;
  for (const board of boards) {
    if (Date.now() > deadline) {
      log(`${kind} out of time after ${read}; the rest wait for the next run`);
      return { found, read, missed, complete: false };
    }
    await new Promise((resolve) => setTimeout(resolve, Math.max(0, next - Date.now())));
    next = Date.now() + (BOARD_INTERVAL_MS[kind] ?? 0);
    // A board given up on asks for nothing more.
    let live = true;
    try {
      const company = ats.CompanySchema.parse({ name: board, ats: kind, board, active: true });
      const jobs = await Promise.race([
        adapter.listJobs(company, new Date().toISOString(), { wanted: (job) => live && wanted(job) }),
        new Promise((_, reject) => setTimeout(() => {
          live = false;
          reject(Object.assign(new Error("timeout"), { code: "timeout" }));
        }, BOARD_MS)),
      ]);
      strikes = 0;
      read += 1;
      const verdict = judge(jobs, (job) => toEntry(job, { name: board, ats: kind, board, remote: true }));
      if (verdict.open) found.push({ ats: kind, board, ...verdict });
    } catch (error) {
      const why = cause(error);
      missed.set(why, (missed.get(why) ?? 0) + 1);
      if (why !== "gone" && !shown.has(why)) {
        shown.add(why);
        log(`${kind} ${board}: ${why}: ${String(error?.message ?? error).slice(0, 200)}`);
      }
      strikes = THROTTLED.has(error?.code) ? strikes + 1 : 0;
      if (strikes >= HOST_STRIKES) {
        log(`${kind} refused ${HOST_STRIKES} boards in a row after ${read}; left for the next run`);
        return { found, read, missed, complete: false };
      }
    }
  }
  return { found, read, missed, complete: true };
}

const key = (entry) => `${entry.ats}:${String(entry.board).toLowerCase()}`;

async function main() {
  const { values } = parseArgs({ options: {
    ats: { type: "string", default: Object.keys(SOURCES).join(",") },
    indexes: { type: "string", default: "2" },
    limit: { type: "string" },
    minutes: { type: "string", default: "170" },
    boards: { type: "string", default: join(ROOT, "data/boards.json") },
    data: { type: "string", default: join(ROOT, "data/data.json") },
    remote: { type: "string", default: join(ROOT, "data/remote-boards.json") },
    none: { type: "string", default: join(ROOT, "data/remote-boards-none.json") },
    cache: { type: "string", default: join(ROOT, ".cache/remote") },
    out: { type: "string", default: join(ROOT, ".cache/remote/candidates.json") },
  } });
  const log = (message) => process.stderr.write(`remote_boards: ${message}\n`);
  process.env.ATS_MIN_INTERVAL_MS ??= "700";
  process.env.ATS_LOG_LEVEL ??= "error";
  process.env.ATS_USER_AGENT ??= UA;
  const kinds = values.ats.split(",").map((s) => s.trim()).filter((s) => SOURCES[s]);
  mkdirSync(values.cache, { recursive: true });

  const collections = (await (await fetchRetry("https://index.commoncrawl.org/collinfo.json")).json())
    .slice(0, Number(values.indexes)).map((c) => c.id);
  const boards = Object.fromEntries(kinds.map((kind) => [kind, new Set()]));
  for (const collection of collections) {
    const found = await boardsIn(collection, kinds, values.cache);
    for (const kind of kinds) for (const board of found[kind]) boards[kind].add(board);
    log(`${collection}: ${kinds.map((kind) => `${kind} ${found[kind].size}`).join(", ")}`);
  }
  // The site's own boards are crawled already; the ones on file, kept or
  // turned down, are read again whether or not this index saw them, so a
  // board turned down comes in the day it states pay.
  const listed = new Set(Object.values(JSON.parse(readFileSync(values.boards, "utf8"))).map(key));
  const onFile = existsSync(values.remote) ? Object.values(JSON.parse(readFileSync(values.remote, "utf8"))) : [];
  for (const entry of onFile) boards[entry.ats]?.add(entry.board);
  const turnedDown = existsSync(values.none) ? Object.entries(JSON.parse(readFileSync(values.none, "utf8"))) : [];
  for (const [id, day] of turnedDown) {
    const at = id.indexOf(":");
    if (day !== "no") boards[id.slice(0, at)]?.add(id.slice(at + 1));
  }

  const { loadAts, entry, openToSpain, SPAIN_CLASSES } = await import(pathToFileURL(join(ROOT, "scripts/jobs.mjs")).href);
  const ats = await loadAts();
  const known = new Set(JSON.parse(readFileSync(values.data, "utf8")).roles.map((role) => role.slug));
  const toEntry = (job, board) => entry(job, board, null, ats.location, known);
  // SmartRecruiters, Rippling and BambooHR take a request per posting for
  // its text, most of a run: only a posting whose place the list gives as
  // open to Spain is worth one.
  const wanted = (job) => Boolean(openToSpain(job, ats.location.analyzeLocation)?.some((c) => SPAIN_CLASSES.has(c)));
  const deadline = Date.now() + Number(values.minutes) * 60_000;
  const results = await Promise.all(kinds.map(async (kind) => {
    let list = rotated([...boards[kind]].filter((board) => !listed.has(key({ ats: kind, board }))).sort());
    if (values.limit) list = list.slice(0, Number(values.limit));
    const result = await probe(kind, list, ats, toEntry, wanted, log, deadline);
    log(`${kind}: ${result.read} of ${list.length} boards read, ${result.found.length} candidates`
        + (result.missed.size ? `; not read: ${causes(result.missed)}` : ""));
    return { kind, ...result, asked: list.length };
  }));
  const out = {
    generated: new Date().toISOString().slice(0, 10),
    indexes: collections,
    // An ATS cut short, or a trial run, says nothing about the boards it did
    // not reach: remote_levels.py ages nobody out on it.
    incomplete: results.filter((r) => !r.complete || values.limit).map((r) => r.kind),
    read: Object.fromEntries(results.map((r) => [r.kind, r.read])),
    boards: results.flatMap((r) => r.found),
  };
  writeFileSync(values.out, `${JSON.stringify(out)}\n`);
  log(`${out.boards.length} candidates -> ${values.out}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().then(() => process.exit(0), (error) => {
    process.stderr.write(`remote_boards: ${error?.stack ?? error}\n`);
    process.exit(1);
  });
}
