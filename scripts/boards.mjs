#!/usr/bin/env node
// Finds each listed company's job board and writes data/boards.json, the map
// from a Levels.fyi slug to its board that scripts/jobs.mjs crawls every day
// and the site publishes at /api/v1/boards.json.
//
//   node scripts/boards.mjs                 # companies with no board, not checked lately
//   node scripts/boards.mjs --all           # every listed company again
//   node scripts/boards.mjs --only "BBVA,Airbus"
//   node scripts/boards.mjs --all --resume  # continue an interrupted --all run
//
// The rules live in lib/ats/presets/spain.js: a board is kept
// only when it names the company and publishes a posting in Spain or remote
// from Spain or Europe. Each candidate is probed through the same adapters and
// polite client the daily crawl uses, so a full run makes thousands of requests
// and takes most of an hour. The default run only probes companies that have no
// board and were not found boardless in the last RECHECK_DAYS, which
// data/boards-none.json remembers (slug -> day checked), so the weekly refresh
// only pays for new companies. A probed company with no board kept loses its
// entry; companies not probed keep theirs.

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseArgs } from "node:util";

// Before the modules read them. Workday reads every posting's detail page, so
// a probe stops at 60 postings rather than the discovery default.
process.env.ATS_MIN_INTERVAL_MS ??= "700";
process.env.ATS_WORKDAY_MAX_POSTINGS ??= "60";
process.env.ATS_LOG_LEVEL ??= "error";
process.env.ATS_USER_AGENT ??=
  "spanishtoptechcompanies-boards/1 (+https://spanishtoptechcompanies.com; finds the job boards of listed companies)";
if (Number(process.env.ATS_MIN_INTERVAL_MS) < 500) process.env.ATS_MIN_INTERVAL_MS = "500";

const { fetchText } = await import("../lib/ats/sources/http.js");
const { adapterFor, resolveBoards } = await import("../lib/ats/sources/registry.js");
const { nowIso } = await import("../lib/ats/util/hash.js");
const spain = await import("../lib/ats/presets/spain.js");

const { values } = parseArgs({
  options: {
    data: { type: "string", default: "data/data.json" },
    tables: { type: "string", default: "data/companies/software-engineer.json" },
    boards: { type: "string", default: "data/boards.json" },
    none: { type: "string", default: "data/boards-none.json" },
    report: { type: "string", default: join(tmpdir(), "stc-boards-report.json") },
    all: { type: "boolean", default: false },
    only: { type: "string" },
    limit: { type: "string" },
    resume: { type: "boolean", default: false },
    "no-websites": { type: "boolean", default: false },
  },
});

const readJson = (path) => JSON.parse(readFileSync(path, "utf8"));

async function fetchPage(url) {
  try {
    return await fetchText(url, { retries: 1, timeoutMs: 12_000, maxBytes: 3 * 1024 * 1024 });
  } catch {
    return null;
  }
}

const snapshot = spain.readSiteSnapshot(readJson(values.data), { "software-engineer": readJson(values.tables) });
const boards = existsSync(values.boards) ? readJson(values.boards) : {};
const none = existsSync(values.none) ? readJson(values.none) : {};
const RECHECK_DAYS = 30;
const today = new Date().toISOString().slice(0, 10);
const recent = (day) => day && (Date.parse(today) - Date.parse(day)) / 86_400_000 < RECHECK_DAYS;

let companies = snapshot.companies;
if (values.only) {
  const wanted = new Set(values.only.split(",").map((name) => name.trim().toLowerCase()));
  companies = companies.filter((company) => wanted.has(company.name.toLowerCase()));
} else if (!values.all) {
  companies = companies.filter((company) => !(company.levelsSlug in boards) && !recent(none[company.levelsSlug]));
}
if (values.limit) companies = companies.slice(0, Number.parseInt(values.limit, 10));

const previous = values.resume && existsSync(values.report) ? readJson(values.report) : null;
const reports = previous?.companies ?? [];
const done = new Set(reports.map((report) => report.name));

const capturedAt = nowIso();
const deps = {
  resolve: (name, extra) => resolveBoards(name, extra),
  listJobs: (company) => adapterFor(company.ats).listJobs(company, capturedAt),
  ...(values["no-websites"] ? {} : { fetchPage }),
};

let index = 0;
for (const company of companies) {
  index += 1;
  if (done.has(company.name)) continue;
  const report = await spain.probeCompany(company, snapshot.rules, deps);
  reports.push(report);
  writeFileSync(values.report, `${JSON.stringify({ dataAsOf: snapshot.rules.dataAsOf, companies: reports }, null, 2)}\n`);
  const kept = report.kept ? `kept ${report.kept.ats}/${report.kept.board}` : "none";
  process.stderr.write(`[${index}/${companies.length}] ${company.name}: ${report.candidates.length} board(s), ${kept}\n`);
}

const preset = spain.assemblePreset(reports);
const slugOf = new Map(snapshot.companies.map((company) => [company.name, company.levelsSlug]));
const kept = new Map(preset.companies.map((entry) => [entry.name, entry]));
for (const report of reports) {
  const slug = slugOf.get(report.name);
  if (!slug) continue;
  const entry = kept.get(report.name);
  if (!entry) {
    delete boards[slug];
    none[slug] = today;
    continue;
  }
  delete none[slug];
  boards[slug] = { ats: entry.ats, board: entry.board, ...(entry.region ? { region: entry.region } : {}), ...(entry.query ? { query: entry.query } : {}) };
}
// One company per line, sorted by slug, so the diff shows what changed.
const lines = Object.keys(boards)
  .sort()
  .map((slug) => `  ${JSON.stringify(slug)}: ${JSON.stringify(boards[slug])}`);
writeFileSync(values.boards, `{\n${lines.join(",\n")}\n}\n`);
const noneLines = Object.keys(none).sort().map((slug) => `  ${JSON.stringify(slug)}: ${JSON.stringify(none[slug])}`);
writeFileSync(values.none, `{\n${noneLines.join(",\n")}\n}\n`);
console.log(JSON.stringify({ dataAsOf: snapshot.rules.dataAsOf, probed: reports.length, boards: lines.length, ...spain.summarize(reports, preset) }, null, 2));
