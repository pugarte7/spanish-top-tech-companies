// /api/v1/jobs.json: the open postings, today, at the companies the site lists
// whose job board is known, kept to the ones a person in Spain could take.
// The MCP server's job tools search it, so an agent can apply without
// installing anything. Postings only: titles, links, locations, stated pay,
// and what api/_classify.js reads of each (roles and level from the title,
// years of experience from the description, regions from the location). No
// descriptions (size), nothing about any person.
//
//     node scripts/jobs.mjs                    # after site.py: crawl the boards
//     node scripts/jobs.mjs --fixture tests/fixtures/jobs.json   # offline copy
//     node scripts/jobs.mjs --reuse 36         # production's index if under 36h old
//
// The boards are _site/api/v1/boards-list.json (site.py, from data/boards.json)
// and every fetch goes through the ATS adapters and polite client in lib/ats
// (per-host interval, retries, timeouts), so the postings and their location
// classes are exactly what lib/ats sees. Boards are crawled one at a
// time per host, hosts side by side.
//
// vercel.json runs it after site.py in the build. The daily scheduled deploy
// (deploy.yml) crawls; a deploy for a push to main passes JOBS_REUSE_HOURS
// and republishes production's index unchanged while it is that fresh, so a
// code change ships in minutes instead of waiting on every board (since
// 2026-11-05: "porque tenemos que hacer el rastreo de ofertas cada vez que
// hacemos un deploy?"). An older or unreadable index means a crawl. It never
// fails the build. A host that refuses is retried with growing waits and slowed down.
// A board that still fails is counted under boards.issues, and its postings
// in production's previous jobs.json are carried over unchanged for up to a
// week (boards.stale, boards.stale_since); a board that answers 404 or with
// no postings has none. A crawl that cannot run at all publishes production's
// previous jobs.json unchanged (its generated_at says how old), and with no
// board read and nothing to carry over there is no file.

import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { pathToFileURL } from "node:url";
import { classify } from "../api/_classify.js";

export const VERSION = 1;
/** lib/ats location classes for an office in Spain, or remote from it.
 * Its "europe" is an office in another European country, or remote from one
 * of them, unless the place is Europe as a whole ("Home based - EMEA"). */
const SPAIN_CLASSES = new Set(["spain", "remote-spain", "remote-europe"]);
/** An office that names no place, only remoteness: "Remote", "Distributed",
 * "Home based - Worldwide". lib/ats calls any remote office it cannot place
 * remote-global, "Remote India" and "Sydney" on a remote posting included. */
const NO_PLACE = /^(?:remote|fully|100%|work|from|at|home|based|distributed|anywhere|worldwide|global|globally|virtual|wfh|flexible|international|[\s\-–—:,/()[\]&.])+$/i;
const REMOTE_WORD = /remote|home|distributed|anywhere|worldwide|global|virtual|wfh/i;
/** A title that scopes a placeless remote posting elsewhere. */
const ELSEWHERE_TITLE = /\b(?:north america|americas|latam|apac|asia|us|usa|united states|canada|india|australia|japan|brazil|mexico)\b/i;
const WORKPLACES = new Set(["remote", "hybrid", "onsite"]);
const PERIODS = new Set(["year", "month", "hour"]);

const SITE = (process.env.SITE_URL || "https://spanishtoptechcompanies.com").replace(/\/$/, "");
const DEFAULTS = {
  boards: "_site/api/v1/boards-list.json",
  data: "_site/api/v1/data.json",
  out: "_site/api/v1/jobs.json",
  previous: process.env.JOBS_PREVIOUS_URL || `${SITE}/api/v1/jobs.json`,
  // A run past this publishes what it has; the boards not reached count as
  // "timeout". GitHub's build has room, a stuck host should not hold a deploy.
  minutes: Number(process.env.JOBS_MAX_MINUTES) || 20,
  // Hours within which production's index is republished instead of a crawl;
  // 0 always crawls.
  reuse: Number(process.env.JOBS_REUSE_HOURS) || 0,
  concurrency: 6,
};

const THROTTLE_STATUS = new Set([402, 403, 405, 429, 503]);
/** First wait after a host refuses; the waits double up to eight times this. */
const BACKOFF_MS = 15_000;
/** Attempts per board, the first included. */
const MAX_TRIES = 4;
/** Refusals in a row after which a host is left alone for the run: after
 * waits of 15s, 30s, 60s and 2 min, so a host that blocks the build's address
 * all day costs a deploy four minutes, not the whole time limit. */
const HOST_STRIKES = 5;
/** Days a failing board's postings are carried over from the previous index. */
const STALE_DAYS = 7;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const norm = (s) => String(s ?? "").normalize("NFKD").replace(/[̀-ͯ]/g, "").trim().toLowerCase();

/** The site's slug (data.json's `levels`) of a board, by the company's name:
 * site.py writes boards-list.json from data.json's companies. */
export function slugFinder(data) {
  const byName = new Map((data?.companies ?? []).map((c) => [norm(c.name), c.levels ?? null]));
  return (board) => byName.get(norm(board.name)) ?? null;
}

/** One string per office, split as lib/ats's classifier splits them. */
const officesOf = (job) => job.locationsRaw.flatMap((v) => v.split(/\s*[;|]\s*/)).map((v) => v.trim()).filter(Boolean);

/**
 * The posting's location classes when a person living in Spain could take it,
 * else null: an office in Spain, remote from Spain or from Europe, or remote
 * with no place named at all. Each office is classed on its own by lib/ats's
 * analyzeLocation, as its gates do (jobLocationClasses), with two corrections:
 * an office naming only remoteness is remote-global (lib/ats reads "Home
 * based - Worldwide" as other), and remote Europe as a whole is remote-europe
 * ("Home based - EMEA", which it reads as an office in Europe). A placeless
 * "Remote" beside a named office elsewhere ("Distributed; Atlanta, GA") is
 * remote from that office, so it counts only when every office is placeless
 * or Europe-wide.
 */
export function openToSpain(job, analyzeLocation) {
  const hints = { workplaceType: job.workplaceType };
  const offices = officesOf(job).map((office) => {
      const { locationClass, country } = analyzeLocation([office], hints);
      const placeless = NO_PLACE.test(office) && REMOTE_WORD.test(office);
      const europeWide = locationClass === "europe" && country === "unknown";
      const remote = REMOTE_WORD.test(office) || job.workplaceType === "remote";
      return { placeless, europeWide, raw: locationClass,
               cls: placeless ? "remote-global" : europeWide && remote ? "remote-europe" : locationClass };
    });
  // job.locationClass is one office's class, or one lib/ats read from the
  // title or the board's published country, which the offices do not show.
  // Its "other" for Recruitee's "Barcelona, Catalunya [Cataluña], Spain" says
  // nothing the offices do not.
  const fromElsewhere = !offices.some((o) => o.raw === job.locationClass)
    && !["other", "unknown"].includes(job.locationClass);
  const classes = [...new Set([...offices.map((o) => o.cls), ...(fromElsewhere ? [job.locationClass] : [])])];
  if (offices.some((o) => SPAIN_CLASSES.has(o.cls))) return classes;
  if (["remote-us", "remote-canada"].includes(job.locationClass) || ELSEWHERE_TITLE.test(job.title)) return null;
  const open = offices.some((o) => o.placeless) && offices.every((o) => o.placeless || o.europeWide);
  return open ? classes : null;
}

/** Pay the board publishes in its own fields. Pay read out of the description
 * is left out: lib/ats's parser reads Affirm's equity grant as a salary, and
 * a multi-country posting's text often gives another country's range. */
function salary(comp) {
  if (!comp || comp.source !== "ats-structured" || !PERIODS.has(comp.period)) return null;
  const min = Number.isFinite(comp.min) ? Math.round(comp.min) : null;
  const max = Number.isFinite(comp.max) ? Math.round(comp.max) : null;
  if (min === null && max === null) return null;
  return { min, max, currency: comp.currency, period: comp.period };
}

/** One index entry from lib/ats's normalized Job, or null when nobody
 * in Spain could take it. `location` is lib/ats's ranking/location module,
 * `known` the role slugs data.json has, which the posting's roles come from. */
export function entry(job, board, slug, location, known = new Set()) {
  const classes = openToSpain(job, location.analyzeLocation);
  if (!classes) return null;
  const row = {
    id: `${job.ats}:${job.board}:${job.externalId}`,
    company: board.name,
    slug: slug ?? null,
    tier: board.tier ?? null,
    title: job.title,
    // Greenhouse's absolute_url is often the employer's marketing page; its
    // hosted posting (description and form) is the apply URL lib/ats keeps.
    url: job.ats === "greenhouse" ? job.applyUrl || job.url : job.url || job.applyUrl,
    ats: job.ats,
    // The board's text, once per office: Greenhouse repeats the primary
    // location among the offices.
    location: [...new Map(officesOf(job).map((v) => [v.toLowerCase(), v])).values()].join("; "),
    location_classes: classes,
    workplace: WORKPLACES.has(job.workplaceType) ? job.workplaceType : null,
    // lib/ats's normalized Job does not carry the board's department.
    department: null,
    posted_at: job.postedAt ?? null,
    salary: salary(job.compensation),
  };
  // Read here because the description is: it is not stored.
  return { ...row, ...classify(row, job.descriptionText, known) };
}

const sortJobs = (jobs) => jobs.sort((a, b) =>
  a.company.localeCompare(b.company, "en", { sensitivity: "base" })
  || a.title.localeCompare(b.title, "en", { sensitivity: "base" })
  || a.id.localeCompare(b.id));

/**
 * Crawls every board and returns the index. `ats` holds what is
 * taken from lib/ats (discoverJobs and adapterFor, CompanySchema, the
 * location module), so a test can hand in the real ones over a stubbed fetch.
 */
export async function crawl(boardsList, data, ats, opts = {}) {
  const { discoverJobs, adapterFor, CompanySchema, location } = ats;
  const deadline = Date.now() + (opts.minutes ?? DEFAULTS.minutes) * 60_000;
  const slugOf = slugFinder(data);
  const known = new Set((data?.roles ?? []).map((r) => r.slug));
  const issues = {};
  const failures = [];
  const jobs = new Map();
  const done = new Set();
  let failed = 0;
  const fail = (board, code, message) => {
    done.add(board);
    failed += 1;
    issues[`${board.ats}:${code}`] = (issues[`${board.ats}:${code}`] ?? 0) + 1;
    failures.push({ company: board.name, ats: board.ats, board: board.board, code, message });
  };

  // One queue per host: lib/ats's client spaces requests to a host, but only
  // for requests made one after another.
  const queues = new Map();
  for (const board of boardsList.companies ?? []) {
    let company;
    let host;
    try {
      company = CompanySchema.parse({ ...board, active: true });
      host = new URL(adapterFor(company.ats).listUrl(company)).host;
    } catch (error) {
      fail(board, "invalid_board", String(error?.message ?? error).slice(0, 200));
      continue;
    }
    if (!queues.has(host)) queues.set(host, []);
    queues.get(host).push({ board, company, tries: 1 });
  }

  // A host that refuses (403 and the like) is backing off, not saying the board
  // is gone: the board goes to the back of its host's queue, the host waits
  // 15s, 30s, 60s, then 2 min after each refusal in a row, and every later
  // board on it is spaced further apart for the rest of the run. Greenhouse
  // refused GitHub's runner the first 24 of its 37 boards on the first daily
  // build, then served the rest.
  const backoff = opts.backoffMs ?? BACKOFF_MS;
  let retries = 0;
  const runHost = async (host, queue) => {
    let gap = 0;
    let strikes = 0;
    while (queue.length) {
      const item = queue.shift();
      if (Date.now() > deadline) { fail(item.board, "timeout", "crawl time limit reached"); continue; }
      const result = await discoverJobs([item.company]);
      const issue = result.issues[0];
      if (issue && throttled(issue) && strikes + 1 >= HOST_STRIKES) {
        // Refused that many times running: the host is not letting this run
        // in today, so its boards are left to the previous index.
        log(`  ${host} refused ${HOST_STRIKES} times in a row; skipping its other ${queue.length} boards`);
        for (const rest of [item, ...queue.splice(0)]) fail(rest.board, issue.code, issue.message);
        break;
      }
      if (issue && throttled(issue) && item.tries < MAX_TRIES && Date.now() < deadline) {
        item.tries += 1;
        retries += 1;
        strikes += 1;
        gap = Math.min(backoff, Math.max(gap * 2, backoff / 5));
        const wait = Math.min(backoff * 2 ** (strikes - 1), backoff * 8, Math.max(0, deadline - Date.now()));
        log(`  ${host} refused ${item.board.name} (${issue.message.slice(0, 80)}); retrying in ${Math.round(wait / 1000)}s`);
        queue.push(item);
        await sleep(wait);
        continue;
      }
      // Any answer, a 404 included, means the host is serving again.
      if (!issue || !throttled(issue)) strikes = 0;
      if (issue) {
        for (const each of result.issues) fail(item.board, each.code, each.message);
      } else {
        done.add(item.board);
        const slug = slugOf(item.board);
        for (const job of result.jobs) {
          const row = entry(job, item.board, slug, location, known);
          if (row) jobs.set(row.id, row);
        }
      }
      if (queue.length && gap) await sleep(gap);
    }
  };
  const pending = [...queues.entries()];
  const worker = async () => {
    for (let next = pending.shift(); next; next = pending.shift()) await runHost(...next);
  };
  const workers = Array.from({ length: Math.min(opts.concurrency ?? DEFAULTS.concurrency, pending.length) }, worker);
  // A request already on the wire past the deadline is abandoned, not awaited.
  let timer;
  const late = new Promise((resolve) => { timer = setTimeout(resolve, Math.max(0, deadline - Date.now()) + 60_000); });
  await Promise.race([Promise.all(workers), late]);
  clearTimeout(timer);
  // Boards still in flight, or not started, when the grace period ran out.
  for (const board of boardsList.companies ?? []) {
    if (!done.has(board)) fail(board, "timeout", "crawl time limit reached");
  }
  const queried = done.size;

  return {
    index: {
      version: VERSION,
      generated_at: new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
      boards: { queried, failed, stale: 0, stale_since: {},
                issues: Object.fromEntries(Object.entries(issues).sort()) },
      jobs: sortJobs([...jobs.values()]),
    },
    failures,
    retries,
  };
}

/** A refusal or an outage, which may pass, rather than an answer about the
 * board. 402/403/405/429/503 are how ATS hosts throttle; lib/ats's client
 * already retries 429 and 5xx a couple of times and reports them as
 * retryable_http. */
export function throttled(issue) {
  if (["retryable_http", "network_error"].includes(issue.code)) return true;
  return THROTTLE_STATUS.has(Number(/\bHTTP (\d{3})\b/.exec(issue.message)?.[1]));
}

const boardKey = (failure) => `${failure.ats}:${failure.board}`;

/**
 * Carries over, unchanged, the postings production's previous index had for
 * each board that failed this run, so one bad day at a host does not empty
 * those companies. Only a board that answered loses its postings: an empty
 * list is a success, and not_found (404) means the board is gone. A board
 * carried over since before `maxDays` ago is dropped: its postings may have
 * closed. `stale_since` keeps, per board, when it was last read.
 */
export function carryOver(index, failures, previous, now = Date.now(), maxDays = STALE_DAYS) {
  if (!isIndex(previous)) return index;
  const since = {};
  for (const failure of failures) {
    if (failure.code === "not_found") continue;
    const key = boardKey(failure);
    const read = previous.boards?.stale_since?.[key] ?? previous.generated_at;
    if (now - Date.parse(read) <= maxDays * 86_400_000) since[key] = read;
  }
  const kept = previous.jobs.filter((job) => since[job.id.split(":").slice(0, 2).join(":")]);
  const carried = Object.keys(since).filter((key) => kept.some((job) => job.id.startsWith(`${key}:`)));
  const ids = new Set(index.jobs.map((job) => job.id));
  return {
    ...index,
    boards: { ...index.boards, stale: carried.length,
              stale_since: Object.fromEntries(carried.sort().map((key) => [key, since[key]])) },
    jobs: sortJobs([...index.jobs, ...kept.filter((job) => !ids.has(job.id))]),
  };
}

/** The ATS modules in lib/ats. */
export async function loadAts() {
  const [registry, location, campaign] = await Promise.all([
    import("../lib/ats/sources/registry.js"),
    import("../lib/ats/ranking/location.js"),
    import("../lib/ats/domain/campaign.js"),
  ]);
  return { discoverJobs: registry.discoverJobs, adapterFor: registry.adapterFor,
           CompanySchema: campaign.CompanySchema, location };
}

/** Production's index, when it is one and younger than `hours`. */
export function fresh(prior, hours, now = Date.now()) {
  if (!(hours > 0) || !isIndex(prior)) return null;
  const age = now - Date.parse(prior.generated_at);
  return age >= 0 && age < hours * 3_600_000 ? prior : null;
}

/** True for a jobs.json this script could have written. */
export function isIndex(value) {
  return value?.version === VERSION && typeof value.generated_at === "string"
    && Array.isArray(value.jobs) && typeof value.boards === "object";
}

function write(path, index) {
  const body = JSON.stringify(index);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(`${path}.tmp`, body);
  renameSync(`${path}.tmp`, path);
  return Buffer.byteLength(body);
}

async function previous(url) {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(20_000),
                                        headers: { "cache-control": "no-cache" } });
    if (!response.ok) return `HTTP ${response.status}`;
    const body = await response.json();
    return isIndex(body) ? body : "not a jobs index";
  } catch (error) {
    return String(error?.message ?? error);
  }
}

function args(argv) {
  const out = { ...DEFAULTS };
  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i].replace(/^--/, "");
    if (!(key in out) && key !== "fixture") throw new Error(`unknown option ${argv[i]}`);
    out[key] = ["minutes", "concurrency", "reuse"].includes(key) ? Number(argv[++i]) : argv[++i];
  }
  return out;
}

const log = (message) => process.stderr.write(`jobs: ${message}\n`);

async function main() {
  const opts = args(process.argv.slice(2));
  if (opts.fixture) {
    const index = JSON.parse(readFileSync(opts.fixture, "utf8"));
    if (!isIndex(index)) throw new Error(`${opts.fixture} is not a jobs index`);
    log(`${index.jobs.length} postings from ${opts.fixture} -> ${opts.out} (${write(opts.out, index)} bytes)`);
    return;
  }

  if (opts.reuse > 0) {
    const prior = await previous(opts.previous);
    const kept = typeof prior === "object" ? fresh(prior, opts.reuse) : null;
    if (kept) {
      log(`reused production's index of ${kept.generated_at} (${kept.jobs.length} postings, ` +
          `${write(opts.out, kept)} bytes); no crawl`);
      return;
    }
    log(`production's index is not under ${opts.reuse}h old (${typeof prior === "object" ? prior.generated_at : prior}); crawling`);
  }

  const started = Date.now();
  let index = null;
  let reason = "";
  try {
    const boardsList = JSON.parse(readFileSync(opts.boards, "utf8"));
    const data = JSON.parse(readFileSync(opts.data, "utf8"));
    // Says who is asking: this crawl is the site's.
    process.env.ATS_USER_AGENT ??= `spanishtoptechcompanies-jobs/${VERSION} (+${SITE}; daily job index)`;
    process.env.ATS_LOG_LEVEL ??= "error";
    const result = await crawl(boardsList, data, await loadAts(), opts);
    const { boards } = result.index;
    const seconds = Math.round((Date.now() - started) / 1000);
    log(`${boards.queried} boards queried, ${boards.failed} failed, ${result.retries} retries, ` +
        `${result.index.jobs.length} postings kept, ${seconds}s`);
    for (const [code, n] of Object.entries(boards.issues)) log(`  ${code}: ${n}`);
    for (const f of result.failures) log(`  - ${f.company} (${f.ats}:${f.board}) ${f.code}: ${f.message.slice(0, 160)}`);
    index = result.index;
    if (result.failures.some((f) => f.code !== "not_found")) {
      const prior = await previous(opts.previous);
      if (typeof prior === "object") {
        index = carryOver(index, result.failures, prior);
        log(`carried over ${index.jobs.length - result.index.jobs.length} postings of ${index.boards.stale} ` +
            `failed boards from production's index of ${prior.generated_at}`);
      } else {
        log(`failed boards not carried over; previous ${opts.previous}: ${prior}`);
      }
    }
    // An index with no board read and nothing carried over would read as "no
    // openings anywhere"; no file says the truth.
    if (boards.queried > 0 && boards.failed === boards.queried && !index.boards.stale) {
      log("no board could be read and none carried over; no index published");
      return;
    }
  } catch (error) {
    reason = String(error?.stack ?? error);
  }

  if (index) {
    log(`wrote ${opts.out} (${write(opts.out, index)} bytes)`);
    return;
  }
  log(`crawl failed: ${reason}`);
  const prior = await previous(opts.previous);
  if (typeof prior === "object") {
    log(`kept production's index from ${prior.generated_at} (${prior.jobs.length} postings, ${write(opts.out, prior)} bytes)`);
  } else {
    log(`no index published; previous ${opts.previous}: ${prior}`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  // Never fail the build over postings, and do not wait on requests abandoned
  // at the deadline.
  main().then(() => process.exit(0), (error) => {
    log(`error: ${error?.stack ?? error}`);
    process.exit(0);
  });
}
