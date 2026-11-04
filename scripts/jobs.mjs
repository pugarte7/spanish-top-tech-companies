// /api/v1/jobs.json: the open postings, today, at the companies the site lists
// whose job board is known, kept to the ones a person in Spain could take.
// The MCP server's job tools search it, so an agent can apply without
// installing anything. Postings only: titles, links, locations, stated pay. No
// descriptions (size), nothing about any person.
//
//     node scripts/jobs.mjs                    # after site.py: crawl the boards
//     node scripts/jobs.mjs --fixture tests/fixtures/jobs.json   # offline copy
//
// The boards are _site/api/v1/boards-list.json (site.py, from data/boards.json)
// and every fetch goes through autoapply-mcp's own adapters and polite client
// (per-host interval, retries, timeouts), so the postings and their location
// classes are exactly what autoapply-mcp would see. Boards are crawled one at a
// time per host, hosts side by side.
//
// vercel.json runs it after site.py in the build, so every deploy and the
// daily scheduled one (deploy.yml) publish a fresh index. It never fails the
// build: a board that fails is counted under boards.issues and the rest are
// published; a crawl that cannot run, or reaches no board at all, publishes
// production's previous jobs.json unchanged (its generated_at says how old),
// or no file when that cannot be read either.

import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { pathToFileURL } from "node:url";

export const VERSION = 1;
/** autoapply-mcp's location classes for an office in Spain, or remote from it.
 * Its "europe" is an office in another European country, or remote from one
 * of them, unless the place is Europe as a whole ("Home based - EMEA"). */
const SPAIN_CLASSES = new Set(["spain", "remote-spain", "remote-europe"]);
/** An office that names no place, only remoteness: "Remote", "Distributed",
 * "Home based - Worldwide". autoapply calls any remote office it cannot place
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
  concurrency: 6,
};

const norm = (s) => String(s ?? "").normalize("NFKD").replace(/[̀-ͯ]/g, "").trim().toLowerCase();

/** The site's slug (data.json's `levels`) of a board, by the company's name:
 * site.py writes boards-list.json from data.json's companies. */
export function slugFinder(data) {
  const byName = new Map((data?.companies ?? []).map((c) => [norm(c.name), c.levels ?? null]));
  return (board) => byName.get(norm(board.name)) ?? null;
}

/** One string per office, split as autoapply's classifier splits them. */
const officesOf = (job) => job.locationsRaw.flatMap((v) => v.split(/\s*[;|]\s*/)).map((v) => v.trim()).filter(Boolean);

/**
 * The posting's location classes when a person living in Spain could take it,
 * else null: an office in Spain, remote from Spain or from Europe, or remote
 * with no place named at all. Each office is classed on its own by autoapply's
 * analyzeLocation, as its gates do (jobLocationClasses), with two corrections:
 * an office naming only remoteness is remote-global (autoapply reads "Home
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
  // job.locationClass is one office's class, or one autoapply read from the
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
 * is left out: autoapply's parser reads Affirm's equity grant as a salary, and
 * a multi-country posting's text often gives another country's range. */
function salary(comp) {
  if (!comp || comp.source !== "ats-structured" || !PERIODS.has(comp.period)) return null;
  const min = Number.isFinite(comp.min) ? Math.round(comp.min) : null;
  const max = Number.isFinite(comp.max) ? Math.round(comp.max) : null;
  if (min === null && max === null) return null;
  return { min, max, currency: comp.currency, period: comp.period };
}

/** One index entry from autoapply-mcp's normalized Job, or null when nobody
 * in Spain could take it. `location` is autoapply's ranking/location module. */
export function entry(job, board, slug, location) {
  const classes = openToSpain(job, location.analyzeLocation);
  if (!classes) return null;
  return {
    id: `${job.ats}:${job.board}:${job.externalId}`,
    company: board.name,
    slug: slug ?? null,
    tier: board.tier ?? null,
    title: job.title,
    // Greenhouse's absolute_url is often the employer's marketing page; its
    // hosted posting (description and form) is the apply URL autoapply keeps.
    url: job.ats === "greenhouse" ? job.applyUrl || job.url : job.url || job.applyUrl,
    ats: job.ats,
    // The board's text, once per office: Greenhouse repeats the primary
    // location among the offices.
    location: [...new Map(officesOf(job).map((v) => [v.toLowerCase(), v])).values()].join("; "),
    location_classes: classes,
    workplace: WORKPLACES.has(job.workplaceType) ? job.workplaceType : null,
    // autoapply's normalized Job does not carry the board's department.
    department: null,
    posted_at: job.postedAt ?? null,
    salary: salary(job.compensation),
  };
}

const sortJobs = (jobs) => jobs.sort((a, b) =>
  a.company.localeCompare(b.company, "en", { sensitivity: "base" })
  || a.title.localeCompare(b.title, "en", { sensitivity: "base" })
  || a.id.localeCompare(b.id));

/**
 * Crawls every board and returns the index. `autoapply` holds what is
 * taken from autoapply-mcp (discoverJobs and adapterFor, CompanySchema, the
 * location module), so a test can hand in the real ones over a stubbed fetch.
 */
export async function crawl(boardsList, data, autoapply, opts = {}) {
  const { discoverJobs, adapterFor, CompanySchema, location } = autoapply;
  const deadline = Date.now() + (opts.minutes ?? DEFAULTS.minutes) * 60_000;
  const slugOf = slugFinder(data);
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

  // One queue per host: autoapply's client spaces requests to a host, but only
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
    queues.get(host).push({ board, company });
  }

  const pending = [...queues.values()];
  const worker = async () => {
    for (let queue = pending.shift(); queue; queue = pending.shift()) {
      for (const { board, company } of queue) {
        if (Date.now() > deadline) { fail(board, "timeout", "crawl time limit reached"); continue; }
        const result = await discoverJobs([company]);
        if (result.issues.length) {
          for (const issue of result.issues) fail(board, issue.code, issue.message);
          continue;
        }
        done.add(board);
        const slug = slugOf(board);
        for (const job of result.jobs) {
          const row = entry(job, board, slug, location);
          if (row) jobs.set(row.id, row);
        }
      }
    }
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
      boards: { queried, failed, issues: Object.fromEntries(Object.entries(issues).sort()) },
      jobs: sortJobs([...jobs.values()]),
    },
    failures,
  };
}

/** autoapply-mcp's modules, from the published package's compiled dist/. */
export async function loadAutoapply() {
  const [registry, location, campaign] = await Promise.all([
    import("autoapply-mcp/dist/sources/registry.js"),
    import("autoapply-mcp/dist/ranking/location.js"),
    import("autoapply-mcp/dist/domain/campaign.js"),
  ]);
  return { discoverJobs: registry.discoverJobs, adapterFor: registry.adapterFor,
           CompanySchema: campaign.CompanySchema, location };
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
    out[key] = key === "minutes" || key === "concurrency" ? Number(argv[++i]) : argv[++i];
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

  const started = Date.now();
  let index = null;
  let reason = "";
  try {
    const boardsList = JSON.parse(readFileSync(opts.boards, "utf8"));
    const data = JSON.parse(readFileSync(opts.data, "utf8"));
    // Says who is asking: this crawl is the site's, not someone's autoapply-mcp.
    process.env.AUTOAPPLY_USER_AGENT ??= `spanishtoptechcompanies-jobs/${VERSION} (+${SITE}; daily job index)`;
    process.env.AUTOAPPLY_LOG_LEVEL ??= "error";
    const result = await crawl(boardsList, data, await loadAutoapply(), opts);
    const { boards } = result.index;
    const seconds = Math.round((Date.now() - started) / 1000);
    log(`${boards.queried} boards queried, ${boards.failed} failed, ${result.index.jobs.length} postings kept, ${seconds}s`);
    for (const [code, n] of Object.entries(boards.issues)) log(`  ${code}: ${n}`);
    for (const f of result.failures) log(`  - ${f.company} (${f.ats}:${f.board}) ${f.code}: ${f.message.slice(0, 160)}`);
    if (boards.queried > 0 && boards.failed === boards.queried) reason = "no board could be read";
    else index = result.index;
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
