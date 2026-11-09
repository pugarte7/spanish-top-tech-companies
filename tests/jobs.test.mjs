// scripts/jobs.mjs, offline: the real adapters in lib/ats over a stubbed
// fetch, the index's shape and filter, the committed fixture, and the
// fallbacks when the crawl cannot run. Run after site.py:
//     node tests/jobs.test.mjs
import assert from "node:assert/strict";
import { execFile, execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { carryOver, crawl, fresh, isIndex, loadAts, throttled } from "../scripts/jobs.mjs";

process.env.ATS_MIN_INTERVAL_MS = "0";
process.env.ATS_LOG_LEVEL = "error";

const KEYS = ["id", "company", "slug", "tier", "title", "url", "ats", "location", "location_classes",
              "workplace", "department", "posted_at", "salary", "roles", "seniority", "years", "regions"];
const SENIORITIES = ["intern", "junior", "mid", "senior", "staff", "lead", "head"];
const CLASSES = new Set(["bay-area", "us-other", "canada", "remote-us", "remote-canada", "remote-global",
                         "spain", "remote-spain", "europe", "remote-europe", "other", "unknown"]);
const OPEN = ["spain", "remote-spain", "remote-europe", "remote-global"];
const iso = (v) => v === null || (typeof v === "string" && !Number.isNaN(Date.parse(v)));

function checkIndex(index, name) {
  assert.ok(isIndex(index), `${name}: not a jobs index`);
  assert.deepEqual(Object.keys(index), ["version", "generated_at", "boards", "jobs"], name);
  assert.match(index.generated_at, /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/, name);
  assert.deepEqual(Object.keys(index.boards), ["queried", "failed", "stale", "stale_since", "issues"], name);
  for (const [code, n] of Object.entries(index.boards.issues)) {
    assert.match(code, /^[a-z]+:[a-z_]+$/, `${name}: issue ${code}`);
    assert.ok(Number.isInteger(n) && n > 0);
  }
  assert.equal(Object.keys(index.boards.stale_since).length, index.boards.stale, name);
  for (const [board, since] of Object.entries(index.boards.stale_since)) {
    assert.match(board, /^[a-z]+:[^:]+$/, `${name}: stale ${board}`);
    assert.ok(iso(since), `${name}: stale ${board} since ${since}`);
  }
  const ids = new Set();
  for (const job of index.jobs) {
    const at = `${name} ${job.id}`;
    assert.deepEqual(Object.keys(job), KEYS, at);
    assert.ok(job.id.startsWith(`${job.ats}:`) && job.id.split(":").length >= 3, at);
    assert.ok(!ids.has(job.id), `${at}: duplicate`);
    ids.add(job.id);
    for (const k of ["company", "title", "url", "ats", "location"]) assert.equal(typeof job[k], "string", `${at} ${k}`);
    assert.ok(job.url.startsWith("https://"), at);
    assert.ok(job.slug === null || typeof job.slug === "string", at);
    assert.ok([null, "A", "B", "C"].includes(job.tier), at);
    assert.ok(job.location_classes.length && job.location_classes.every((c) => CLASSES.has(c)), at);
    assert.ok(job.location_classes.some((c) => OPEN.includes(c)), `${at}: not open to Spain`);
    assert.ok([null, "remote", "hybrid", "onsite"].includes(job.workplace), at);
    assert.ok(job.department === null || typeof job.department === "string", at);
    assert.ok(iso(job.posted_at), at);
    assert.ok(Array.isArray(job.roles) && job.roles.length <= 3 && job.roles.every((r) => /^[a-z-]+$/.test(r)), at);
    assert.ok(job.seniority === null || SENIORITIES.includes(job.seniority), at);
    assert.ok(job.years === null || (job.years.length === 2 && Number.isInteger(job.years[0]) &&
              (job.years[1] === null || job.years[1] > job.years[0])), `${at} years`);
    assert.ok(Array.isArray(job.regions) && job.regions.every((r) => /^[A-Z]{2}$/.test(r)), at);
    if (job.salary !== null) {
      assert.deepEqual(Object.keys(job.salary), ["min", "max", "currency", "period"], at);
      assert.match(job.salary.currency, /^[A-Z]{3}$/, at);
      assert.ok(["year", "month", "hour"].includes(job.salary.period), at);
    }
  }
  const order = index.jobs.map((j) => [j.company, j.title]);
  const sorted = [...order].sort((a, b) => a[0].localeCompare(b[0], "en", { sensitivity: "base" })
    || a[1].localeCompare(b[1], "en", { sensitivity: "base" }));
  assert.deepEqual(order, sorted, `${name}: not sorted by company then title`);
}

// --- The crawl over a stubbed fetch ------------------------------------------

const greenhouse = (id, title, location, extra = {}) =>
  ({ id, title, location: { name: location }, absolute_url: `https://careers.example.com/jobs/${id}`,
     first_published: "2026-10-20T10:00:00-04:00", content: "&lt;p&gt;We build things.&lt;/p&gt;", ...extra });
const BOARDS = {
  "https://boards-api.greenhouse.io/v1/boards/cabify/jobs": { jobs: [
    greenhouse(1, "Backend Engineer", "Madrid",
               { pay_input_ranges: [{ min_cents: 6000000, max_cents: 8000000, currency_type: "EUR" }],
                 content: "&lt;p&gt;We build things. You have 3-5 years of experience with Go.&lt;/p&gt;" }),
    greenhouse(2, "Sales Manager", "Remote India"),
    greenhouse(3, "Site Reliability Engineer", "Remote"),
    greenhouse(4, "Account Executive", "Distributed", { offices: [{ location: "Atlanta, GA" }] }),
    greenhouse(5, "Product Manager", "London, United Kingdom"),
    greenhouse(6, "Platform Engineer", "Home based - EMEA"),
    greenhouse(7, "Account Executive - North America", "Remote"),
    greenhouse(8, "Product Designer", "Remote",
               { content: "&lt;p&gt;The salary range is $150,000 - $200,000 per year.&lt;/p&gt;" }),
  ] },
  "https://api.lever.co/v0/postings/jobandtalent": [
    { id: "aaaa-1", text: "Frontend Engineer", hostedUrl: "https://jobs.lever.co/jobandtalent/aaaa-1",
      applyUrl: "https://jobs.lever.co/jobandtalent/aaaa-1/apply", createdAt: 1760000000000, workplaceType: "hybrid",
      categories: { location: "Barcelona", allLocations: ["Barcelona", "Lisbon"], team: "Engineering" },
      salaryRange: { min: 50000, max: 65000, currency: "EUR", interval: "per-year-salary" } },
    { id: "aaaa-2", text: "Support Engineer", hostedUrl: "https://jobs.lever.co/jobandtalent/aaaa-2",
      createdAt: 1760000000000, workplaceType: "remote", categories: { location: "Remote - US" } },
  ],
};
let requested = [];
// How many more times each URL answers 403, as Greenhouse did GitHub's runner.
const refuse = {};
globalThis.fetch = async (url) => {
  const key = String(url).split("?")[0];
  requested.push(key);
  if (refuse[key] > 0) {
    refuse[key] -= 1;
    return new Response("<html>Forbidden</html>", { status: 403 });
  }
  if (typeof BOARDS[key] === "string") return new Response(BOARDS[key], { status: 200 });
  return key in BOARDS ? new Response(JSON.stringify(BOARDS[key]), { status: 200 })
                       : new Response("not found", { status: 404 });
};

const boardsList = { version: 1, companies: [
  { name: "Cabify", ats: "greenhouse", board: "cabify", tier: "B", tags: ["spain"] },
  { name: "Gone", ats: "greenhouse", board: "gone", tier: "C", tags: ["spain"] },
  { name: "Job&Talent", ats: "lever", board: "jobandtalent", tier: "A", tags: ["spain"] },
  { name: "Nowhere", ats: "nope", board: "x", tier: "A", tags: [] },
] };
const data = { companies: [{ name: "Cabify", levels: "cabify" }, { name: "Job&Talent", levels: "jobandtalent" }],
               roles: [{ slug: "software-engineer" }, { slug: "product-designer" }] };
const { index } = await crawl(boardsList, data, await loadAts(), { minutes: 1 });

checkIndex(index, "crawl");
assert.deepEqual(index.boards, { queried: 4, failed: 2, stale: 0, stale_since: {},
                                 issues: { "greenhouse:not_found": 1, "nope:invalid_board": 1 } });
assert.deepEqual(index.jobs.map((j) => j.id), [
  "greenhouse:cabify:1", "greenhouse:cabify:6", "greenhouse:cabify:8", "greenhouse:cabify:3",
  "lever:jobandtalent:aaaa-1",
]);
const byId = Object.fromEntries(index.jobs.map((j) => [j.id, j]));
assert.deepEqual(byId["greenhouse:cabify:1"], {
  id: "greenhouse:cabify:1", company: "Cabify", slug: "cabify", tier: "B", title: "Backend Engineer",
  url: "https://job-boards.greenhouse.io/embed/job_app?for=cabify&token=1", ats: "greenhouse",
  location: "Madrid", location_classes: ["spain"], workplace: null, department: null,
  posted_at: "2026-10-20T10:00:00-04:00",
  salary: { min: 60000, max: 80000, currency: "EUR", period: "year" },
  roles: ["software-engineer"], seniority: null, years: [3, 5], regions: ["MD"],
});
assert.deepEqual([byId["greenhouse:cabify:8"].roles, byId["greenhouse:cabify:8"].years], [["product-designer"], null],
                 "a description naming no years of experience");
assert.deepEqual(byId["greenhouse:cabify:3"].location_classes, ["remote-global"]);
assert.equal(byId["greenhouse:cabify:3"].workplace, "remote");
assert.deepEqual(byId["greenhouse:cabify:6"].location_classes, ["remote-europe"]);
assert.equal(byId["greenhouse:cabify:8"].salary, null, "pay read from a description is not published");
const lever = byId["lever:jobandtalent:aaaa-1"];
assert.deepEqual([lever.slug, lever.tier, lever.workplace, lever.url, lever.location],
                 ["jobandtalent", "A", "hybrid", "https://jobs.lever.co/jobandtalent/aaaa-1", "Barcelona; Lisbon"]);
assert.deepEqual(lever.location_classes, ["spain", "europe"]);
assert.deepEqual(lever.salary, { min: 50000, max: 65000, currency: "EUR", period: "year" });
assert.deepEqual(lever.regions, ["CT"], "Lisbon is no Spanish region");
assert.ok(!JSON.stringify(index).includes("We build things"), "descriptions stay out of the index");
assert.deepEqual(requested.sort(), ["https://api.lever.co/v0/postings/jobandtalent",
  "https://boards-api.greenhouse.io/v1/boards/cabify/jobs", "https://boards-api.greenhouse.io/v1/boards/gone/jobs"]);

// --- Teamtailor: one RSS feed per career site, the site's host as the board ------

const ttItem = (id, title, places, remote = "hybrid") => `<item><title>${title}</title>
  <description>&lt;p&gt;We fly. You have 2+ years of experience.&lt;/p&gt;</description>
  <pubDate>Fri, 06 Nov 2026 15:14:31 +0100</pubDate>
  <link>https://careers.vueling.com/jobs/${id}-${title.toLowerCase().replace(/\W+/g, "-")}</link>
  <remoteStatus>${remote}</remoteStatus><guid>g-${id}</guid>
  <tt:locations>${places.map(([city, country]) => `<tt:location><tt:name>${city}</tt:name>
    <tt:city>${city}</tt:city><tt:country>${country}</tt:country></tt:location>`).join("")}</tt:locations>
  <tt:department>Tech</tt:department><tt:role/></item>`;
const rss = (items) => `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:tt="https://teamtailor.com/locations"><channel><title>Vueling</title>
<link>https://careers.vueling.com/jobs</link>${items.join("")}</channel></rss>`;
BOARDS["https://careers.vueling.com/jobs.rss"] = rss([
  ttItem(8681660, "Data Engineer", [["Viladecans", "Spain"]]),
  ttItem(8681661, "Backend Developer", [["Lisbon", "Portugal"], ["Barcelona", "Spain"]], "fully"),
  ttItem(8681662, "Cabin Crew Paris", [["Paris", "France"]], "onsite"),
]);
BOARDS["https://careers.notteamtailor.com/jobs.rss"] = `<?xml version="1.0"?><rss version="2.0"><channel><title>x</title></channel></rss>`;
const ttData = { companies: [{ name: "Vueling", levels: "vueling" }], roles: [{ slug: "software-engineer" }, { slug: "data-engineer" }] };
const tt = await crawl({ companies: [
  { name: "Vueling", ats: "teamtailor", board: "careers.vueling.com", tier: "B", tags: ["spain"] },
  { name: "Plain RSS", ats: "teamtailor", board: "careers.notteamtailor.com", tier: "C", tags: [] },
  { name: "Not a host", ats: "teamtailor", board: "vueling", tier: "C", tags: [] },
] }, ttData, await loadAts(), { minutes: 1 });
checkIndex(tt.index, "teamtailor crawl");
assert.deepEqual(tt.index.boards.issues, { "teamtailor:invalid_board": 1, "teamtailor:invalid_source_payload": 1 });
assert.deepEqual(tt.index.jobs.map((j) => j.id), ["teamtailor:careers.vueling.com:8681661", "teamtailor:careers.vueling.com:8681660"]);
const ttJob = Object.fromEntries(tt.index.jobs.map((j) => [j.id, j]));
assert.deepEqual([ttJob["teamtailor:careers.vueling.com:8681660"].location, ttJob["teamtailor:careers.vueling.com:8681660"].workplace,
                  ttJob["teamtailor:careers.vueling.com:8681660"].url, ttJob["teamtailor:careers.vueling.com:8681660"].slug,
                  ttJob["teamtailor:careers.vueling.com:8681660"].posted_at],
                 ["Viladecans, Spain", "hybrid", "https://careers.vueling.com/jobs/8681660-data-engineer", "vueling", "2026-11-06T14:14:31.000Z"]);
assert.equal(ttJob["teamtailor:careers.vueling.com:8681661"].workplace, "remote");
const { teamtailorAdapter } = await import("../lib/ats/sources/teamtailor.js");
assert.deepEqual(teamtailorAdapter.boardFromUrl("https://ironhackers.teamtailor.com/jobs/123-x"),
                 { ats: "teamtailor", board: "ironhackers.teamtailor.com", region: "global" });
assert.equal(teamtailorAdapter.boardFromUrl("https://www.teamtailor.com/en-us/"), null);
assert.deepEqual(teamtailorAdapter.boardFromPage("https://www.mercadonatech.com/",
  '<a href="https://www.teamtailor.com/en-us/?utm_campaign=poweredby&amp;utm_content=www.mercadonatech.com">Teamtailor</a>'),
  { ats: "teamtailor", board: "www.mercadonatech.com", region: "global" });
assert.deepEqual(teamtailorAdapter.boardFromPage("https://careers.idealista.com/",
  '<link href="https://assets.teamtailor-cdn.com/x.css"><a href="/jobs">Jobs</a>'),
  { ats: "teamtailor", board: "careers.idealista.com", region: "global" });
assert.equal(teamtailorAdapter.boardFromPage("https://www.example.com/", '<a href="/jobs">Jobs</a>'), null);

// --- A host that refuses -----------------------------------------------------

const GH = "https://boards-api.greenhouse.io/v1/boards";
assert.ok(throttled({ code: "http_error", message: "[http_error] HTTP 403 from boards-api.greenhouse.io" }));
assert.ok(throttled({ code: "retryable_http", message: "HTTP 503 from x" }));
assert.ok(!throttled({ code: "not_found", message: "board not found (404): x" }));
assert.ok(!throttled({ code: "http_error", message: "HTTP 400 from x" }));

// Refused twice, then served: retried, nothing lost, the other host untouched.
requested = [];
refuse[`${GH}/cabify/jobs`] = 2;
const fast = { minutes: 1, backoffMs: 5 };
const twice = await crawl({ companies: boardsList.companies.slice(0, 3) }, data, await loadAts(), fast);
assert.equal(twice.retries, 2);
assert.deepEqual(twice.index.boards.issues, { "greenhouse:not_found": 1 });
assert.deepEqual(twice.index.jobs.map((j) => j.id), index.jobs.map((j) => j.id));
assert.equal(requested.filter((u) => u === `${GH}/cabify/jobs`).length, 3);

// Refusing every time: the host is given up after five refusals in a row, its
// boards fail with the refusal, and no board is retried past four attempts.
requested = [];
for (const b of ["cabify", "gone", "third"]) refuse[`${GH}/${b}/jobs`] = Infinity;
const blocked = await crawl({ companies: [...boardsList.companies.slice(0, 3),
  { name: "Third", ats: "greenhouse", board: "third", tier: "A", tags: [] }] }, data, await loadAts(), fast);
assert.deepEqual(blocked.index.boards.issues, { "greenhouse:http_error": 3 });
assert.equal(blocked.retries, 4);
assert.equal(requested.filter((u) => u.startsWith(GH)).length, 5);
assert.deepEqual(blocked.index.jobs.map((j) => j.id), ["lever:jobandtalent:aaaa-1"]);
for (const b of ["cabify", "gone", "third"]) delete refuse[`${GH}/${b}/jobs`];

// --- Carrying a failed board's postings over ----------------------------------

const old = (id, company, title) => ({ ...byId["greenhouse:cabify:1"], id, company, title, slug: null });
const previousIndex = {
  version: 1, generated_at: "2026-11-03T04:20:00Z",
  boards: { queried: 4, failed: 1, stale: 1, stale_since: { "greenhouse:old": "2026-10-20T04:20:00Z" }, issues: {} },
  jobs: [
    old("greenhouse:cabify:1", "Cabify", "Backend Engineer (yesterday's copy)"),
    old("greenhouse:cabify:99", "Cabify", "Closed since"),
    old("greenhouse:gone:5", "Gone", "Board now 404"),
    old("greenhouse:old:7", "Old", "Failing for two weeks"),
    old("greenhouse:emptied:3", "Emptied", "Board now answers with no postings"),
    old("lever:jobandtalent:aaaa-9", "Job&Talent", "Read fine today, so not carried"),
  ],
};
const today = { ...blocked.index, generated_at: "2026-11-04T04:20:00Z" };
const failures = [
  { company: "Cabify", ats: "greenhouse", board: "cabify", code: "http_error", message: "HTTP 403" },
  { company: "Gone", ats: "greenhouse", board: "gone", code: "not_found", message: "404" },
  { company: "Old", ats: "greenhouse", board: "old", code: "http_error", message: "HTTP 403" },
];
const merged = carryOver(today, failures, previousIndex, Date.parse("2026-11-04T05:00:00Z"));
checkIndex(merged, "carried over");
assert.deepEqual(merged.jobs.map((j) => j.id),
                 ["greenhouse:cabify:1", "greenhouse:cabify:99", "lever:jobandtalent:aaaa-1"]);
assert.deepEqual(merged.jobs[0], previousIndex.jobs[0], "carried over unchanged");
assert.deepEqual(merged.boards, { ...today.boards, stale: 1,
                                  stale_since: { "greenhouse:cabify": "2026-11-03T04:20:00Z" } });
// The next day, still failing: the date it was last read travels along.
const dayAfter = carryOver({ ...today, jobs: [] }, failures.slice(0, 1), merged, Date.parse("2026-11-05T05:00:00Z"));
assert.deepEqual(dayAfter.boards.stale_since, { "greenhouse:cabify": "2026-11-03T04:20:00Z" });
assert.equal(dayAfter.jobs.length, 2);
assert.deepEqual(carryOver(today, failures, null), today, "nothing to carry without a previous index");

// --- Eightfold and Oracle -----------------------------------------------------

const { adapterFor } = await import("../lib/ats/sources/registry.js");
const eightfold = adapterFor("eightfold"), oracle = adapterFor("oracle");
Object.assign(BOARDS, {
  // A new tenant: ten a page, no description in the list.
  "https://az.eightfold.ai/api/pcsx/search": { status: 200, data: { count: 2, positions: [
    { id: 111, name: "Data Engineer", locations: ["Barcelona, , Spain"], standardizedLocations: ["Barcelona, CT, ES"],
      postedTs: 1792972800, workLocationOption: "hybrid", positionUrl: "/careers/job/111" },
    { id: 112, name: "Sales Lead", locations: ["London, England, United Kingdom"], standardizedLocations: ["London, ENG, GB"],
      postedTs: 0, workLocationOption: "onsite", positionUrl: "/careers/job/112" },
  ] } },
  "https://az.eightfold.ai/api/pcsx/position_details": { status: 200, data: {
    jobDescription: "<p>You have 4+ years of experience with Spark.</p>" } },
  // An older tenant: the new API is not found, the old one carries the description.
  "https://old.eightfold.ai/api/apply/v2/jobs": { count: 1, positions: [
    { id: 790, name: "Consultant, Spain", location: "Madrid, Spain", locations: ["Madrid, Spain", "Barcelona, Spain"],
      t_create: 1781170380, work_location_option: "onsite", job_description: "Strategy work.",
      canonicalPositionUrl: "https://talent.example.com/careers/job/790" },
  ] },
  "https://pod.fa.oraclecloud.com/hcmRestApi/resources/latest/recruitingCEJobRequisitions": { items: [{
    TotalJobsCount: 2, requisitionList: [
      { Id: "2108", Title: "Backend Engineer", PostedDate: "2026-11-02", PrimaryLocation: "Madrid, Spain",
        PrimaryLocationCountry: "ES", ShortDescriptionStr: "Short.", secondaryLocations: [] },
      // The location filter is fuzzy: an Indian posting comes back for Spain.
      { Id: "2109", Title: "Analyst", PostedDate: "2026-11-01", PrimaryLocation: "Pune, India",
        PrimaryLocationCountry: "IN", secondaryLocations: [] },
    ] }] },
  "https://pod.fa.oraclecloud.com/hcmRestApi/resources/latest/recruitingCEJobRequisitionDetails": { items: [{
    ExternalDescriptionStr: "<p>Go and Kotlin.</p>", ExternalPostedStartDate: "2026-11-02T15:51:16+00:00",
    WorkplaceType: "Hybrid", JobSchedule: "Full time" }] },
});
requested = [];
const enterprise = await crawl({ companies: [
  { name: "AZ", ats: "eightfold", board: "az.eightfold.ai/az.com", tier: "A", tags: ["spain"] },
  { name: "Old", ats: "eightfold", board: "old.eightfold.ai/old.com", tier: "B", tags: ["spain"] },
  { name: "Pod", ats: "oracle", board: "pod.fa.oraclecloud.com/CX_1", tier: "A", tags: ["spain"] },
] }, { companies: [{ name: "AZ", levels: "az" }, { name: "Pod", levels: "pod" }], roles: [{ slug: "software-engineer" }] },
await loadAts(), { minutes: 1 });
checkIndex(enterprise.index, "eightfold and oracle");
assert.deepEqual(enterprise.index.boards.issues, {});
const ent = Object.fromEntries(enterprise.index.jobs.map((j) => [j.id, j]));
assert.deepEqual(Object.keys(ent).sort(), ["eightfold:az.eightfold.ai/az.com:111", "eightfold:old.eightfold.ai/old.com:790",
                                           "oracle:pod.fa.oraclecloud.com/CX_1:2108"]);
const az = ent["eightfold:az.eightfold.ai/az.com:111"];
assert.deepEqual([az.url, az.location, az.workplace, az.years],
                 ["https://az.eightfold.ai/careers/job/111", "Barcelona, Spain", "hybrid", [4, null]]);
assert.equal(ent["eightfold:old.eightfold.ai/old.com:790"].url, "https://talent.example.com/careers/job/790");
const pod = ent["oracle:pod.fa.oraclecloud.com/CX_1:2108"];
assert.deepEqual([pod.url, pod.location, pod.workplace, pod.posted_at],
  ["https://pod.fa.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX_1/job/2108", "Madrid, Spain", "hybrid",
   "2026-11-02T15:51:16+00:00"]);
assert.ok(requested.includes("https://az.eightfold.ai/api/pcsx/position_details"), "pcsx descriptions are read");
assert.ok(!requested.some((u) => u.startsWith("https://old.eightfold.ai/api/pcsx/position")), "v2 lists carry descriptions");
// A posting dated 0 has no date rather than 1970.
const london = await eightfold.listJobs({ name: "AZ", ats: "eightfold", board: "az.eightfold.ai/az.com", query: "" },
                                        "2026-11-09T00:00:00Z");
assert.equal(london.find((j) => j.externalId === "112").postedAt, null);
// Boards read off the links employers publish.
assert.deepEqual(eightfold.boardFromUrl("https://bcg.eightfold.ai/careers?domain=bcg.com&hl=en"),
                 { ats: "eightfold", board: "bcg.eightfold.ai/bcg.com", region: "global" });
assert.equal(eightfold.boardFromUrl("https://bcg.eightfold.ai/careers/join"), null, "no domain, no board");
assert.deepEqual(eightfold.boardFromPage("https://telekom.eightfold.ai/careers", '<script>{"domain": "telekom.com"}</script>'),
                 { ats: "eightfold", board: "telekom.eightfold.ai/telekom.com", region: "global" });
assert.deepEqual(oracle.boardFromUrl("https://jpmc.fa.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX_1001/jobs"),
                 { ats: "oracle", board: "jpmc.fa.oraclecloud.com/CX_1001", region: "global" });
assert.deepEqual(oracle.boardFromPage("https://www.honeywell.com/careers",
  '<a href="https://ibqbjb.fa.ocs.oraclecloud.com/hcmUI/CandidateExperience/en/sites/Honeywell/jobs">Jobs</a>'),
  { ats: "oracle", board: "ibqbjb.fa.ocs.oraclecloud.com/Honeywell", region: "global" });
assert.equal(oracle.boardFromUrl("https://evil.example.com/hcmUI/CandidateExperience/en/sites/CX_1"), null);
for (const [adapter, bad] of [[eightfold, "az.eightfold.ai"], [eightfold, "a/b/c"], [oracle, "pod.example.com/CX_1"]])
  await assert.rejects(adapter.listJobs({ name: "X", board: bad, query: "" }, "2026-11-09T00:00:00Z"), /must be/);

// --- The committed fixture ----------------------------------------------------

const fixture = JSON.parse(readFileSync("tests/fixtures/jobs.json", "utf8"));
checkIndex(fixture, "fixture");
assert.ok(fixture.jobs.length >= 5 && fixture.jobs.length <= 10);
const site = JSON.parse(readFileSync("data/data.json", "utf8"));
const slugs = new Set(site.companies.map((c) => c.levels));
for (const job of fixture.jobs) assert.ok(slugs.has(job.slug), `fixture ${job.id}: ${job.slug} not in data.json`);

// --- The script itself: fixture copy, carry-over, a crawl that cannot run -----

const tmp = mkdtempSync(join(tmpdir(), "jobs-test-"));
const run = (...args) => execFileSync(process.execPath, ["scripts/jobs.mjs", ...args],
                                      { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
run("--fixture", "tests/fixtures/jobs.json", "--out", join(tmp, "copy.json"));
assert.deepEqual(JSON.parse(readFileSync(join(tmp, "copy.json"), "utf8")), fixture);

let answer = { status: 200, body: JSON.stringify(fixture) };
const server = createServer((req, res) => { res.writeHead(answer.status); res.end(answer.body); });
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const previous = `http://127.0.0.1:${server.address().port}/api/v1/jobs.json`;
const script = (...args) => new Promise((resolve, reject) => {
  // Not execFileSync: the stub server answers on this process's event loop.
  execFile(process.execPath, ["scripts/jobs.mjs", "--previous", previous, ...args],
           (error) => (error ? reject(error) : resolve()));
});
const broken = (out) => script("--boards", join(tmp, "missing.json"), "--out", out);
await broken(join(tmp, "kept.json"));
assert.deepEqual(JSON.parse(readFileSync(join(tmp, "kept.json"), "utf8")), fixture,
                 "a crawl that cannot run keeps production's index");
// A board that fails (here one with no adapter, so nothing touches the
// network) gets its postings from production's index, and the run says so.
writeFileSync(join(tmp, "boards.json"), JSON.stringify({ companies: [{ name: "Nowhere", ats: "nope", board: "x" }] }));
const nowhere = { ...fixture.jobs[0], id: "nope:x:1", company: "Nowhere" };
answer = { status: 200, body: JSON.stringify({ ...fixture, generated_at: new Date().toISOString(), jobs: [nowhere] }) };
await script("--boards", join(tmp, "boards.json"), "--data", "data/data.json", "--out", join(tmp, "stale.json"));
const stale = JSON.parse(readFileSync(join(tmp, "stale.json"), "utf8"));
assert.deepEqual(stale.jobs, [nowhere]);
assert.deepEqual([stale.boards.failed, stale.boards.stale, Object.keys(stale.boards.stale_since)], [1, 1, ["nope:x"]]);
answer = { status: 500, body: "" };
await script("--boards", join(tmp, "boards.json"), "--data", "data/data.json", "--out", join(tmp, "empty.json"));
assert.ok(!existsSync(join(tmp, "empty.json")), "no board read and none carried over: no index");
await broken(join(tmp, "none.json"));
assert.ok(!existsSync(join(tmp, "none.json")), "no index at all when production's cannot be read");
// A push deploy republishes production's index while it is fresh, and
// crawls once it is not.
const at = Date.parse("2026-11-05T12:00:00Z");
const young = { ...fixture, generated_at: "2026-11-05T04:30:00Z" };
assert.equal(fresh(young, 36, at), young);
assert.equal(fresh({ ...fixture, generated_at: "2026-11-03T04:30:00Z" }, 36, at), null, "too old");
assert.equal(fresh(young, 0, at), null, "0 always crawls");
assert.equal(fresh("HTTP 500", 36, at), null);
answer = { status: 200, body: JSON.stringify({ ...fixture, generated_at: new Date().toISOString() }) };
await script("--reuse", "36", "--boards", join(tmp, "missing.json"), "--out", join(tmp, "reused.json"));
assert.equal(JSON.parse(readFileSync(join(tmp, "reused.json"), "utf8")).jobs.length, fixture.jobs.length,
             "a fresh production index is republished");
server.close();

// Phenom and iCIMS career sites live on the employer's own domain.
const careerSite = (ats, board) => ({ name: ats === "phenom" ? "Roche" : "Keysight", ats, board, tier: "B", tags: [],
                                active: true, region: "global", query: "" });
const phenomJob = (jobId, extra) => ({ jobId, title: `Engineer ${jobId}`, country: "Spain", city: "Madrid",
  multi_location: ["Madrid, Spain"], postedDate: "2026-10-13T00:00:00.000+0000", descriptionTeaser: "Teaser",
  applyUrl: `https://roche.wd3.myworkdayjobs.com/roche-ext/job/Madrid/x_${jobId}/apply`, ...extra });
const PHENOM = {
  facets: { refineSearch: { status: 200, totalHits: 300, data: { jobs: [],
    aggregations: [{ field: "country", value: { Switzerland: 200, SPAIN: 3 } }] } } },
  spain: { refineSearch: { status: 200, totalHits: 3, data: { jobs: [
    phenomJob("A-1", { RemoteType: "Hybrid" }),
    phenomJob("A-2", { country: "Switzerland", city: "Zurich", multi_location: ["Zurich, Switzerland", "Barcelona, Spain"] }),
    phenomJob("A-3", { country: "Switzerland", city: "Basel", multi_location: ["Basel, Switzerland"] })] } } },
};
const phenomBodies = [];
globalThis.fetch = async (url, init = {}) => {
  const u = String(url);
  if (u === "https://careers.roche.com/widgets") {
    const body = JSON.parse(init.body);
    phenomBodies.push(body);
    return new Response(JSON.stringify(body.selected_fields.country ? PHENOM.spain : PHENOM.facets));
  }
  if (u === "https://careers.roche.com/global/en/job/A-1")
    return new Response(`<script>phApp.ddo = {"jobDetail":{"data":{"job":{"description":"<p>Full text</p>"}}}}; phApp.x = 1;</script>`);
  if (u.startsWith("https://careers.keysight.com/api/jobs?"))
    return new Response(JSON.stringify({ totalCount: 2, jobs: [
      { data: { slug: "53254", title: "Solutions Architect", language: "en-us", city: "Las Rozas", state: "Madrid",
        country: "Spain", country_code: "ES", description: "<p>About</p>", qualifications: "<p>RF</p>",
        posted_date: "2026-07-16T10:08:00+0000", apply_url: "https://globalcareers-keysight.icims.com/jobs/53254/login" } },
      { data: { slug: "53300", title: "Test Engineer", language: "en-us", city: "Milano", country: "Italy", country_code: "IT",
        description: "<p>Milan</p>", additional_locations: [{ city: "Malaga", country: "Spain", country_code: "ES" }] } }] }));
  return new Response("not found", { status: 404 });
};
process.env.ATS_PHENOM_MAX_DETAILS = "1";
const phenomJobs = await adapterFor("phenom").listJobs(careerSite("phenom", "careers.roche.com/ROCHGLOBAL/global/en"), "2026-11-09T00:00:00Z");
assert.deepEqual(phenomBodies.map((b) => b.selected_fields), [{}, { country: ["SPAIN"] }],
                 "the Spain filter uses the value the site's own facet names");
assert.equal(phenomBodies[1].refNum, "ROCHGLOBAL");
const { spainPostings } = await import("../lib/ats/presets/spain.js");
const inSpain = (jobs) => spainPostings(jobs).map((j) => j.externalId);
assert.deepEqual(phenomJobs.map((j) => j.url), ["A-1", "A-2", "A-3"].map((id) => `https://careers.roche.com/global/en/job/${id}`));
assert.deepEqual(inSpain(phenomJobs), ["A-1", "A-2"], "a fuzzy match in Basel only is not in Spain");
assert.deepEqual([phenomJobs[0].descriptionText, phenomJobs[1].descriptionText], ["Full text", "Teaser"],
                 "past ATS_PHENOM_MAX_DETAILS the search teaser stands in");
assert.equal(phenomJobs[0].workplaceType, "hybrid");
assert.equal(phenomJobs[0].postedAt, "2026-10-13T00:00:00.000Z");
assert.match(phenomJobs[0].applyUrl, /myworkdayjobs\.com/);
const icimsJobs = await adapterFor("icims").listJobs(careerSite("icims", "careers.keysight.com"), "2026-11-09T00:00:00Z");
assert.deepEqual(icimsJobs.map((j) => j.url), ["53254", "53300"].map((id) => `https://careers.keysight.com/jobs/${id}?lang=en-us`));
assert.deepEqual(inSpain(icimsJobs), ["53254", "53300"], "a second location in Spain counts");
assert.match(icimsJobs[0].descriptionText, /About[\s\S]*RF/);
assert.match(icimsJobs[0].applyUrl, /icims\.com/);
const { phenomAdapter } = await import("../lib/ats/sources/phenom.js");
const { icimsAdapter } = await import("../lib/ats/sources/icims.js");
const phenomHome = '<script>phApp.ddo = {}; phApp.x = 1;</script><script>{"country":"global","locale":"en_global","refNum":"CISCISGLOBAL"}</script><img src="https://cdn.phenompeople.com/x.png">';
assert.deepEqual(phenomAdapter.boardFromPage("https://careers.cisco.com/global/en/search-results", phenomHome),
                 { ats: "phenom", board: "careers.cisco.com/CISCISGLOBAL/global/en", region: "global" });
assert.equal(phenomAdapter.boardFromPage("https://careers.clarivate.com/", phenomHome.replace("CISCISGLOBAL", "CLACLAGB")).board,
             "careers.clarivate.com/CLACLAGB", "a site with no locale path");
assert.equal(phenomAdapter.boardFromPage("https://example.com/careers", "<html>careers</html>"), null);
assert.deepEqual(icimsAdapter.boardFromPage("https://careers.keysight.com/external", '<div class="JIBE_INPUT-ADDRESS"></div>'),
                 { ats: "icims", board: "careers.keysight.com", region: "global" });
assert.throws(() => phenomAdapter.listUrl({ board: "careers.cisco.com" }), /host\/refNum/);

// scripts/boards.mjs: how a board is read off a link or a careers page.
const spain = await import("../lib/ats/presets/spain.js");
assert.deepEqual(spain.boardFromUrl("https://redhat.wd5.myworkdayjobs.com/en-US/jobs"),
                 { ats: "workday", board: "redhat/wd5/jobs", region: "global" }, "a Workday site may be called jobs");
assert.deepEqual(spain.boardFromUrl("https://job-boards.eu.greenhouse.io/sahajsoftware"),
                 { ats: "greenhouse", board: "sahajsoftware", region: "global" }, "EU Greenhouse");
assert.equal(spain.boardFromUrl("https://boards.greenhouse.io/embed"), null);
assert.deepEqual(spain.boardFromUrl("https://www.amazon.jobs/en/"), { ats: "amazon", board: "ESP", region: "global" });
assert.equal(spain.boardFromUrl("https://www.google.com/about/careers/applications/")?.board, "Spain");
assert.equal(spain.boardFromUrl("https://www.google.com/"), null, "Google's home page is not its board");
assert.equal(spain.boardFromUrl("https://www.metacareers.com/careers")?.query, "Spain");
assert.deepEqual(spain.boardsLinkedFrom('<a href="https://job-boards.eu.greenhouse.io/acme/jobs/1">').map((b) => b.board), ["acme"]);
const rules = { threshold: 60_000, companyFloor: 45_000, minRanked: 3, dataAsOf: "" };
const pages = {
  "https://acme.example/": "<html>no board here</html>",
  "https://acme.example/careers": '<a href="https://careers.smartrecruiters.com/Acme">Jobs</a>',
};
const seen = [];
const probed = await spain.probeCompany(
  { name: "Acme", levelsSlug: "acme", website: "https://acme.example/", careers: "https://acme.example/careers",
    cities: [], engineerMedian: null, engineerCount: 0 },
  rules,
  { fetchPage: async (url) => pages[url] ?? null, resolve: async () => [],
    listJobs: async (entry) => { seen.push(entry); return [{ locationClass: "spain", locationsRaw: ["Madrid, Spain"] }]; } },
);
assert.equal(probed.kept?.board, "Acme", "the careers page from data/careers.json is read");
assert.equal(probed.candidates[0].source, "website");
assert.equal(seen[0].country, "es", "SmartRecruiters is asked for postings in Spain only");

console.log(`jobs: crawl ${index.jobs.length} kept of 10, fixture ${fixture.jobs.length}, fallbacks ok`);
