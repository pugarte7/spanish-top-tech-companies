#!/usr/bin/env node
// Finds job boards with remote postings open to Spain or Europe at employers
// the site does not list, and writes the candidates scripts/remote_levels.py
// judges. A company gets into the daily crawl without a salary in Spain when
// it posts remote work on one of these boards and either Levels.fyi knows it
// or the posting states its pay.
//
//   node scripts/remote_boards.mjs                    # every ATS below
//   node scripts/remote_boards.mjs --ats ashby,lever
//   node scripts/remote_boards.mjs --limit 50         # per ATS, to try it out
//
// No ATS publishes a directory of its customers, so the boards come from
// Common Crawl's URL index: every path under jobs.ashbyhq.com names one. The
// index is read block by block from its files (the cluster index says which
// blocks hold a host); its search API times out. Each board is then read
// through the adapters and the polite client the daily crawl uses.
//
// Only an ATS whose URL carries the board is here. Each run starts somewhere
// else in an ATS's list: one that is cut short by refusals reaches other
// boards the next time. Workable is left out: it refuses anything faster
// than a board every 2.5s, which took 3.5 hours for 4,900 boards and 3 new
// employers; the ones found then stay in remote-boards.json by hand.
// Recruitee, BambooHR and Rippling had no remote posting in 120 boards each.

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
const UA = "spanishtoptechcompanies-boards/1 (+https://spanishtoptechcompanies.com; finds job boards with remote postings)";

/** ATS -> the SURT prefixes its boards live under, and where the board is:
 * the first path segment, or the host's first label. */
export const SOURCES = {
  greenhouse: { prefixes: ["io,greenhouse,boards)/", "io,greenhouse,job-boards)/"], in: "path" },
  ashby: { prefixes: ["com,ashbyhq,jobs)/"], in: "path" },
  lever: { prefixes: ["co,lever,jobs)/"], in: "path" },
  teamtailor: { prefixes: ["com,teamtailor,"], in: "host", board: (slug) => `${slug}.teamtailor.com` },
};
const NOT_A_BOARD = new Set(["embed", "api", "v1", "jobs", "job_app", "job_board", "boards", "careers", "www", "j",
                             "robots.txt", "favicon.ico", "sitemap.xml", "app", "assets", "static"]);
/** Classes that make a posting remote from Spain: an office here is not it. */
export const REMOTE_CLASSES = new Set(["remote-spain", "remote-europe"]);
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

/** One board's verdict: its postings, how many are remote from Spain or
 * Europe, how many of those state pay, and the hosts they mention. */
export function judge(jobs, openToSpain, analyzeLocation) {
  const remote = jobs.filter((job) => (openToSpain(job, analyzeLocation) ?? []).some((c) => REMOTE_CLASSES.has(c)));
  return { postings: jobs.length, remote: remote.length,
           paid: remote.filter((job) => job.compensation?.source === "ats-structured").length,
           sample: remote.slice(0, 2).map((job) => `${job.title} | ${job.locationsRaw.join("; ")}`.slice(0, 160)),
           hosts: remote.length ? hostsIn(jobs) : [] };
}

async function probe(kind, boards, ats, openToSpain, log) {
  const adapter = ats.adapterFor(kind);
  const found = [];
  let strikes = 0;
  let read = 0;
  for (const board of boards) {
    try {
      const company = ats.CompanySchema.parse({ name: board, ats: kind, board, active: true });
      const jobs = await Promise.race([
        adapter.listJobs(company, new Date().toISOString()),
        new Promise((_, reject) => setTimeout(() => reject(Object.assign(new Error("timeout"), { code: "timeout" })), 120_000)),
      ]);
      strikes = 0;
      read += 1;
      const verdict = judge(jobs, openToSpain, ats.location.analyzeLocation);
      if (verdict.remote) found.push({ ats: kind, board, ...verdict });
    } catch (error) {
      strikes = THROTTLED.has(error?.code) ? strikes + 1 : 0;
      if (strikes >= HOST_STRIKES) {
        log(`${kind} refused ${HOST_STRIKES} boards in a row after ${read}; left for the next run`);
        return { found, read, complete: false };
      }
    }
  }
  return { found, read, complete: true };
}

const key = (entry) => `${entry.ats}:${String(entry.board).toLowerCase()}`;

async function main() {
  const { values } = parseArgs({ options: {
    ats: { type: "string", default: Object.keys(SOURCES).join(",") },
    indexes: { type: "string", default: "2" },
    limit: { type: "string" },
    boards: { type: "string", default: join(ROOT, "data/boards.json") },
    remote: { type: "string", default: join(ROOT, "data/remote-boards.json") },
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
  // The site's own boards are crawled already; the remote ones on file are
  // read again whether or not this index saw them.
  const listed = new Set(Object.values(JSON.parse(readFileSync(values.boards, "utf8"))).map(key));
  const onFile = existsSync(values.remote) ? Object.values(JSON.parse(readFileSync(values.remote, "utf8"))) : [];
  for (const entry of onFile) boards[entry.ats]?.add(entry.board);

  const { loadAts, openToSpain } = await import(pathToFileURL(join(ROOT, "scripts/jobs.mjs")).href);
  const ats = await loadAts();
  const results = await Promise.all(kinds.map(async (kind) => {
    let list = rotated([...boards[kind]].filter((board) => !listed.has(key({ ats: kind, board }))).sort());
    if (values.limit) list = list.slice(0, Number(values.limit));
    const result = await probe(kind, list, ats, openToSpain, log);
    log(`${kind}: ${result.read} of ${list.length} boards read, ${result.found.length} with remote postings`);
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
