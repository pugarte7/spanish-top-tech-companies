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
import { carryOver, crawl, stampSeen, storeForms, fresh, isIndex, loadAts, ownerOf, slugFinder, summary, summaryPath, throttled } from "../scripts/jobs.mjs";
import { KEYWORDS } from "../api/_classify.js";

process.env.ATS_MIN_INTERVAL_MS = "0";
process.env.ATS_LOG_LEVEL = "error";

const KEYS = ["id", "company", "slug", "tier", "title", "url", "ats", "location", "location_classes",
              "workplace", "department", "posted_at", "salary", "roles", "seniority", "years", "regions", "keywords"];
const SENIORITIES = ["intern", "junior", "mid", "senior", "staff", "lead", "head"];
const KEYWORD_IDS = new Set(KEYWORDS.map(([id]) => id));
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
    assert.ok(Array.isArray(job.keywords) && job.keywords.every((k) => KEYWORD_IDS.has(k)), `${at} keywords`);
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

// A group's account posts its companies' openings: a brand the site lists owns
// the posting, one it does not list leaves it with the board.
{
  const slugOf = slugFinder({ companies: [{ name: "Glovo", levels: "glovo" }, { name: "Delivery Hero", levels: "delivery-hero" }] });
  const dh = { name: "Delivery Hero", ats: "smartrecruiters", board: "DeliveryHero", tier: "B" };
  assert.deepEqual(ownerOf({ brand: "Glovo" }, dh, slugOf), { ...dh, name: "Glovo" });
  assert.equal(ownerOf({ brand: "Talabat" }, dh, slugOf), dh);
  assert.equal(ownerOf({ brand: "Delivery Hero" }, dh, slugOf), dh);
  assert.equal(ownerOf({}, dh, slugOf), dh);
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
  // The title names no level: 3-5 years asked read as mid.
  roles: ["software-engineer"], seniority: "mid", years: [3, 5], regions: ["MD"], keywords: ["golang"],
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
// A board two listed companies share (careers.json "shared"): each posting is
// listed under both, the second narrowed by its title filter.
const shared = await crawl({ companies: [
  { name: "Vueling", ats: "teamtailor", board: "careers.vueling.com", tier: "B", tags: ["spain"] },
  { name: "Vueling Data", ats: "teamtailor", board: "careers.vueling.com", tier: "B", tags: ["spain"], title: "^data" },
] }, { ...ttData, companies: [...ttData.companies, { name: "Vueling Data", levels: "vueling-data" }] }, await loadAts(), { minutes: 1 });
assert.deepEqual(shared.index.jobs.map((j) => [j.id, j.slug]).sort(),
                 [["teamtailor:careers.vueling.com:8681660#vueling-data", "vueling-data"], ["teamtailor:careers.vueling.com:8681660", "vueling"],
                  ["teamtailor:careers.vueling.com:8681661", "vueling"]]);
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
{
  const { parseBoard } = await import("../lib/ats/sources/oracle.js");
  assert.equal(parseBoard("enterpriseplatform.dell.com/CX_1001").host, "enterpriseplatform.dell.com", "a known vanity host");
  assert.throws(() => parseBoard("careers.example.com/CX_1"), /oracle board/);
}
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
// The home page's card reads the summary written beside the index, never the index.
assert.equal(summaryPath("_site/api/v1/jobs.json"), "_site/api/v1/jobs-summary.json");
const brief = JSON.parse(readFileSync(join(tmp, "copy-summary.json"), "utf8"));
assert.deepEqual(brief, summary(fixture));
assert.deepEqual(Object.keys(brief), ["version", "generated_at", "postings", "companies", "boards", "remote", "roles"]);
assert.equal(brief.postings, fixture.jobs.length);
assert.equal(brief.generated_at, fixture.generated_at);
const perRole = Object.values(brief.roles);
assert.ok(perRole.length && perRole.every((n, i) => n > 0 && n <= brief.postings && (!i || n <= perRole[i - 1])));

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

// Gem's public job board API, read by lib/ats/sources/gem.js.
BOARDS["https://api.gem.com/job_board/v0/acme-gmbh/job_posts/"] = [
  { id: "am9i1", title: "Backend Engineer", location: { name: "Barcelona, Spain" }, location_type: "hybrid",
    offices: [{ location: { name: "Barcelona, Spain" }, name: "Barcelona" }], content: "<p>Go and Postgres.</p>",
    absolute_url: "https://jobs.gem.com/acme-gmbh/am9i1", first_published_at: "2026-11-03T14:06:05.656Z" },
  { id: "am9i2", title: "Account Executive", location: { name: "Berlin, Germany" }, location_type: "in_office" },
];
{
  const ats = await loadAts();
  const gem = ats.adapterFor("gem");
  const acme = ats.CompanySchema.parse({ name: "Acme", ats: "gem", board: "acme-gmbh" });
  const jobs = await gem.listJobs(acme, "2026-11-09T00:00:00Z");
  assert.deepEqual(jobs.map((j) => [j.title, j.locationsRaw, j.url, j.workplaceType]), [
    ["Backend Engineer", ["Barcelona, Spain"], "https://jobs.gem.com/acme-gmbh/am9i1", "hybrid"],
    ["Account Executive", ["Berlin, Germany"], "https://jobs.gem.com/acme-gmbh/am9i2", "onsite"],
  ]);
  assert.equal((await gem.verifyBoard(acme)).postings, 2);
  assert.deepEqual(gem.boardFromUrl("https://jobs.gem.com/acme-gmbh/am9i1"), { ats: "gem", board: "acme-gmbh", region: "global" });
  assert.equal(gem.boardFromUrl("https://www.gem.com/pricing"), null);
  assert.equal(gem.boardFromPage("https://acme.example/careers", '<a href="https://jobs.gem.com/acme-gmbh">Open roles</a>')?.board, "acme-gmbh");
}


// --- Radancy, Cornerstone, Pinpoint and BambooHR over a stubbed fetch --------

{
  const { adapterFor } = await import("../lib/ats/sources/registry.js");
  const { CompanySchema } = await import("../lib/ats/domain/campaign.js");
  const { spainPostings } = await import("../lib/ats/presets/spain.js");
  const pages = {
    "https://careers.acme.com/en/search-jobs/results": JSON.stringify({ hasJobs: true, results:
      '<section data-total-pages="1"><ul><li><a href="/en/job/barcelona/data-engineer/1/111" data-job-id="111">' +
      '<h2>Data Engineer &#x2013; Platform</h2><span class="job-location"><strong>Location: </strong>Barcelona, Catalonia</span></a></li>' +
      '<li><a href="/en/job/valencia/it-planner/1/222" data-job-id="222"><h3>IT Planner</h3>' +
      '<span class="job-location">Valencia, Valencia</span></a></li></ul></section>' }),
    "https://careers.acme.com/en/job/barcelona/data-engineer/1/111":
      '<script type="application/ld+json">{"@type":"JobPosting","description":"<p>You have 3-5 years of Spark.</p>","datePosted":"2026-10-01"}</script>',
    "https://careers.acme.com/en/job/valencia/it-planner/1/222": "<html>no ld</html>",
    "https://acme.csod.com/ux/ats/careersite/4/home": '<script>var c={"token":"guest-123","cloud":"https://eu-fra.api.csod.com/"};</script>',
    "https://eu-fra.api.csod.com/rec-job-search/external/jobs": JSON.stringify({ data: { totalCount: 3, requisitions: [
      { requisitionId: 7, displayJobTitle: "Cybersecurity engineer", externalDescription: "<p>Defend.</p>",
        postingEffectiveDate: "2026-10-02", locations: [{ city: "Tres Cantos", state: "Madrid", country: "ES" }] },
      { requisitionId: 8, displayJobTitle: "Envía tu CV", locations: [{ country: "ES" }] },
      { requisitionId: 9, displayJobTitle: "Branch clerk", locations: [{}] },
    ] } }),
    "https://jobs.acme.com/postings.json": JSON.stringify({ data: [
      { id: "1", title: "Account Manager", url: "https://jobs.acme.com/en/postings/u-1", workplace_type: "remote",
        location: { city: "Remote", name: "EMEA-Spain-Field based" }, description: "<p>Sell.</p>" },
      { id: "2", title: "Engineer", url: "https://jobs.acme.com/en/postings/u-2", workplace_type: "hybrid",
        location: { city: "Madrid", province: "Community of Madrid", name: "ESP Madrid" } },
      { id: "3", title: "Analyst", url: "https://jobs.acme.com/en/postings/u-3", workplace_type: "onsite",
        location: { city: "Rijswijk", name: "NLD Rijswijk" } },
    ] }),
    "https://acme.bamboohr.com/careers/list": JSON.stringify({ result: [
      { id: "5", jobOpeningName: "Backend Engineer", location: { city: "Barcelona", state: "Barcelona" },
        atsLocation: { country: null } },
      { id: "6", jobOpeningName: "Sales UK", location: { city: "City of London, UK#UK", state: "Hybrid" },
        atsLocation: { country: null } },
    ] }),
    "https://acme.bamboohr.com/careers/5/detail": JSON.stringify({ result: { jobOpening: {
      description: "<p>Go.</p>", datePosted: "2026-10-28", location: { addressCountry: "Spain" } } } }),
    "https://acme.bamboohr.com/careers/6/detail": JSON.stringify({ result: { jobOpening: {
      description: "<p>Sell.</p>", location: { addressCountry: "Argentina" } } } }),
    "https://career2.successfactors.eu/career": `<?xml version="1.0" encoding="UTF-8"?>
<Job-Listing>
<Job><JobTitle><![CDATA[Arquitecto/a .NET]]></JobTitle><Job-Description><![CDATA[<p>Buscamos.</p>]]></Job-Description><ReqId>10112</ReqId>
<filter1><label>Ubicación/provincia</label><value>Vizcaya</value></filter1></Job>
<Job><JobTitle><![CDATA[Sales &amp; Spend]]></JobTitle><ReqId>459001</ReqId><Posted-Date>09/07/2026</Posted-Date>
<filter7><label>Country</label><value>Germany</value></filter7><filter8><label>Internal Posting Location</label><value>Walldorf</value></filter8>
<filter10><label>Additional Locations</label><value>Virtual - Germany</value></filter10></Job>
</Job-Listing>`,
    "https://jobs.acme.es/jobs": (url) => new URL(url).searchParams.get("page") === "2" ? `<a class="job-card card-grid-image" href="https://jobs.acme.es/jobs/dev-2"><div class="title">Developer</div><div class="details"><span>Teletrabajo/Remoto</span></div></a>` : `<a class="job-card card-grid-image" href="https://jobs.acme.es/jobs/qa-1"><div class="title">QA Senior</div><div class="details"><span>Madrid</span><span>Híbrido</span></div></a><a class="job-card card-grid-image" href="https://jobs.acme.es/jobs/trabaja-con-nosotros"><div class="title">Trabaja con nosotros</div><div class="details"><span>Presencial</span></div></a><a rel="next" class="next" href="/jobs?page=2">Siguiente</a>`,
    "https://api-prod.letsdeel.com/deelapi/guest/ats/organizations/11111111-1111-4111-8111-111111111111/job_boards/22222222-2222-4222-8222-222222222222/job_postings": JSON.stringify([
      { id: "33333333-3333-4333-8333-333333333333", title: "Product Manager", richtextDescription: "<p>Ship.</p>", createdAt: "2026-10-22T15:37:26.054Z",
        isCompensationVisible: true, job: { workArrangementEnum: "REMOTE",
          jobLocations: [{ location: { name: "Spain", country: { code: "ES", name: "Spain" } } }],
          currentCompensation: { currencyIsoCode: "EUR", minAmount: 41000, maxAmount: 55000, periodSlug: "annually" } } },
      { id: "44444444-4444-4444-8444-444444444444", title: "Sales", isCompensationVisible: false, job: { workArrangementEnum: "ONSITE",
          jobLocations: [{ location: { name: "Berlin", country: { code: "DE", name: "Germany" } } }] } },
    ]),
    "https://jobs.acme.com/en_US/careers/SearchJobs/": (url) => new URL(url).searchParams.get("jobOffset") === "2" ? `<p>3 results</p><article class="article article--result 1"><h3><a class="link" href="https://jobs.acme.com/en_US/careers/JobDetail/3">Analyst</a></h3><div class="article__header__text__subtitle"><span>Lisbon, Portugal</span> &nbsp;&#8226;&nbsp; <span>Job ID: 3</span></div></article>` : `<p>3 results</p><article class="article article--result 1"><h3><a class="link" href="https://jobs.acme.com/en_US/careers/JobDetail/1">Data Engineer</a></h3><div class="article__header__text__subtitle"><span>Tres Cantos , Madrid , Spain</span> &nbsp;&#8226;&nbsp; <span>Job ID: 1</span></div></article><article class="article article--result 1"><h3><a class="link" href="https://jobs.acme.com/en_US/careers/JobDetail/2">Sales</a></h3><div class="article__header__text__subtitle"><span>Multiple Locations</span> &nbsp;&#8226;&nbsp; <span>Job ID: 2</span></div></article><a href="https://jobs.acme.com/en_US/careers/SearchJobs/?jobRecordsPerPage=2&amp;jobOffset=2">2</a>`,
    "https://acme.jobs.personio.de/xml": `<?xml version="1.0" encoding="UTF-8"?>
<workzag-jobs>
<position><id>11</id><office>Spain - Barcelona</office><name>Backend Engineer</name>
<jobDescriptions><jobDescription><name>Your role</name><value><![CDATA[<p>Build & ship.</p>]]></value></jobDescription></jobDescriptions>
<employmentType>permanent</employmentType><createdAt>2026-10-20T09:00:00+00:00</createdAt></position>
<position><id>12</id><office>Munich</office><additionalOffices><office>Madrid</office></additionalOffices><name>Sales</name></position>
<position><id>13</id><office>Germany - Berlin</office><name>Accountant</name></position>
</workzag-jobs>`,
  };
  const seen = [];
  const before = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    const key = String(url).split("?")[0];
    seen.push({ key, auth: init.headers?.authorization ?? init.headers?.Authorization ?? null, body: init.body ?? null });
    const page = typeof pages[key] === "function" ? pages[key](String(url)) : pages[key];
    return key in pages ? new Response(page, { status: 200 }) : new Response("not found", { status: 404 });
  };
  const list = async (ats, board, query = "") =>
    adapterFor(ats).listJobs(CompanySchema.parse({ name: "Acme", ats, board, query }), "2026-11-09T00:00:00Z");

  const radancy = await list("radancy", "careers.acme.com/en");
  assert.deepEqual(radancy.map((j) => [j.title, j.locationsRaw[0]]),
                   [["Data Engineer – Platform", "Barcelona, Catalonia, Spain"], ["IT Planner", "Valencia, Valencia, Spain"]],
                   "the Spain facet was asked, so a place without its country is in Spain");
  assert.equal(spainPostings(radancy).length, 2);
  assert.match(radancy[0].descriptionText, /3-5 years/);
  assert.equal(radancy[0].postedAt, "2026-10-01");
  assert.ok(seen.some((s) => s.key === "https://careers.acme.com/en/search-jobs/results"));

  const csod = await list("cornerstone", "acme/4", "ES");
  assert.deepEqual(csod.map((j) => [j.externalId, j.locationsRaw[0]]),
                   [["7", "Tres Cantos, Madrid, Spain"], ["9", "Spain"]], "open applications are not postings");
  assert.equal(seen.find((s) => s.key.endsWith("/rec-job-search/external/jobs")).auth, "Bearer guest-123");
  assert.equal(csod[0].url, "https://acme.csod.com/ux/ats/careersite/4/home/requisition/7?c=acme");
  assert.equal(spainPostings(csod).length, 2);

  const pinpoint = await list("pinpoint", "jobs.acme.com");
  assert.deepEqual(pinpoint.map((j) => j.locationsRaw[0]),
                   ["Remote, Spain", "Madrid, Community of Madrid, Spain", "Rijswijk, Netherlands"]);
  assert.deepEqual(spainPostings(pinpoint).map((j) => j.externalId), ["1", "2"]);
  assert.equal(pinpoint[1].applyUrl, "https://jobs.acme.com/en/postings/u-2/applications/new");

  const bamboo = await list("bamboohr", "acme");
  assert.deepEqual(bamboo.map((j) => j.locationsRaw[0]), ["Barcelona, Spain", "City of London, UK, United Kingdom"],
                   "the country after the hash wins over the address country");
  assert.deepEqual(spainPostings(bamboo).map((j) => j.externalId), ["5"]);
  assert.equal(bamboo[0].postedAt, "2026-10-28");
  const avature = await list("avature", "jobs.acme.com/en_US/careers");
  assert.deepEqual(avature.map((j) => [j.externalId, j.locationsRaw[0]]),
                   [["1", "Tres Cantos, Madrid, Spain"], ["2", "Spain"], ["3", "Lisbon, Portugal"]],
                   "pages with the portal's own offset; a search for Spain places an unplaced posting there");
  assert.ok(seen.some((s) => s.key === "https://jobs.acme.com/en_US/careers/SearchJobs/"));
  assert.deepEqual(spainPostings(avature).map((j) => j.externalId), ["1", "2"]);
  const sfc = await list("sfclassic", "career2.successfactors.eu/acme", "Spain");
  assert.deepEqual(sfc.map((j) => [j.title, j.locationsRaw]),
                   [["Arquitecto/a .NET", ["Vizcaya, Spain"]], ["Sales & Spend", ["Walldorf, Germany", "Remote, Germany"]]],
                   "the query's country only for postings that name none");
  assert.match(sfc[1].postedAt, /^2026-09-07/);
  assert.deepEqual(spainPostings(sfc).map((j) => j.externalId), ["10112"]);
  {
    const { allLocationClasses } = await import("../lib/ats/ranking/location.js");
    assert.deepEqual(allLocationClasses(["La Jonquera, Catalunya, Spain", "Remote, La Rioja, Spain", "New Orleans, LA"]),
                     ["spain", "remote-spain", "us-other"], "a place ending in Spain is in Spain, whatever word spells a state");
    assert.deepEqual(allLocationClasses(["Logroño, La Rioja", "Baton Rouge, LA", "Lafayette, LA 70501"]),
                     ["spain", "us-other"], "LA before a word is the article, not Louisiana");
  }
  const bizneo = await list("bizneo", "jobs.acme.es");
  assert.deepEqual(bizneo.map((j) => [j.externalId, j.locationsRaw[0], j.workplaceType]),
                   [["qa-1", "Madrid, Spain", "hybrid"], ["dev-2", "Remote, Spain", "remote"]],
                   "pages until no next link; the open application is not a posting");
  assert.ok(seen.some((s) => s.key === "https://jobs.acme.es/jobs"));
  const deel = await list("deel", "acme/11111111-1111-4111-8111-111111111111/22222222-2222-4222-8222-222222222222");
  assert.deepEqual(deel.map((j) => [j.locationsRaw[0], j.url]),
                   [["Remote, Spain", "https://jobs.deel.com/acme/job-details/33333333-3333-4333-8333-333333333333"],
                    ["Berlin, Germany", "https://jobs.deel.com/acme/job-details/44444444-4444-4444-8444-444444444444"]]);
  assert.deepEqual(spainPostings(deel).map((j) => j.title), ["Product Manager"]);
  assert.deepEqual([deel[0].compensation?.min, deel[0].compensation?.currency], [41000, "EUR"]);
  assert.equal(deel[1].compensation, null, "pay the employer hides is not read");
  const avatureFiltered = await list("avature", "jobs.acme.com/en_US/careers", "3183=[8010]&listFilterMode=1");
  assert.ok(seen.some((s) => s.key === "https://jobs.acme.com/en_US/careers/SearchJobs/") && avatureFiltered.length === 3);
  const personio = await list("personio", "acme");
  assert.deepEqual(personio.map((j) => j.locationsRaw), [["Barcelona, Spain"], ["Munich", "Madrid"], ["Berlin, Germany"]],
                   "\"Country - City\" is turned round; additional offices are kept");
  assert.deepEqual(spainPostings(personio).map((j) => j.externalId), ["11", "12"]);
  assert.match(personio[0].descriptionText, /Build & ship/);
  assert.equal(personio[0].url, "https://acme.jobs.personio.de/job/11?language=en");
  assert.match(personio[0].postedAt, /^2026-10-20/);
  globalThis.fetch = before;

  // Board recognition, for scripts/boards.mjs.
  const from = (ats, url) => adapterFor(ats).boardFromUrl(url);
  assert.deepEqual(from("cornerstone", "https://odigeo.csod.com/ux/ats/careersite/2/home/requisition/2852?c=odigeo"),
                   { ats: "cornerstone", board: "odigeo/2", region: "global" });
  assert.equal(from("cornerstone", "https://odigeo.csod.com/ATS/careersite/da.aspx?routename=x&amp;site=2&amp;c=odigeo")?.board, "odigeo/2");
  assert.equal(from("pinpoint", "https://tabby.pinpointhq.com/en/jobs/603651")?.board, "tabby.pinpointhq.com");
  assert.equal(from("pinpoint", "https://app.pinpointhq.com/assets/x.js"), null);
  assert.equal(from("bamboohr", "https://wallbox.bamboohr.com/careers")?.board, "wallbox");
  assert.equal(from("bamboohr", "https://staticfe.bamboohr.com/careers/x.js"), null);
  assert.equal(from("personio", "https://tado.jobs.personio.com/job/123?language=en")?.board, "tado");
  assert.equal(from("personio", "https://www.personio.com/careers/"), null);
  assert.equal(from("avature", "https://mercadona.avature.net/es_ES/Careers/JobDetail/M-dico-a/308814")?.board, "mercadona.avature.net/es_ES/Careers");
  assert.equal(from("avature", "https://jobs.siemens.com/en_US/externaljobs/JobDetail/1"), null);
  assert.deepEqual(adapterFor("radancy").boardFromPage("https://careers.ing.com/en/search-jobs",
                   '<link href="https://tbcdn.talentbrew.com/x.css"><a href="/en/search-jobs">'),
                   { ats: "radancy", board: "careers.ing.com/en", region: "global" });
  assert.equal(adapterFor("radancy").boardFromPage("https://example.com/", "<html></html>"), null);
}


// --- Employer APIs (jsonapi) and Rippling over a stubbed fetch ---------------
{
  const { adapterFor } = await import("../lib/ats/sources/registry.js");
  const { CompanySchema } = await import("../lib/ats/domain/campaign.js");
  const { jobLocationClasses } = await import("../lib/ats/ranking/location.js");
  const posted = [];
  const API = {
    "https://cg-jobstream-api.azurewebsites.net/api/job-search": { count: 1, data: [
      { id: "1-es_ES_SAPBTP", title: "Senior Data Engineer", location: "Valencia", country_code: "es-es",
        description: "<p>Data</p>", apply_job_url: "https://careers.capgemini.com/job/1/", indexed_at: "2026-10-28T17:11:57.000Z" }] },
    "https://www.sage.com/api/sagedotcom/careersearch/getcareersearchdata/": { vacancies: { TotalSize: 2, Records: [
      { Id: "VN1", Name: "Director of Engineering", Url: "https://sagehr.example/apply?vacancyNo=VN1",
        OfficeLocation: "Barcelona", Country: "Spain", ActiveDate: "2026-11-05", Description: "x" },
      { Id: "VN2", Name: "Sales Advisor", Url: "https://sagehr.example/apply?vacancyNo=VN2",
        OfficeLocation: "Pretoria", Country: "South Africa", ActiveDate: "2026-11-05" }] } },
    "https://schwarz-digits.de/en/api/v1/job/search": (body) => body.filters.location_city.length === 0
      ? { jobs: [], pagination: { totalCount: 339 }, filters: { groups: [{ identifier: "location_city", values: [
          { identifier: "location_SIT-ES_Barcelona" }, { identifier: "location_SIT-BG_Sofia" }] }] } }
      : { jobs: [{ id: "48", title: "SOC Analyst", location: "Barcelona", url: "https://schwarz-digits.de/en/jobsearch/soc-48" }],
          pagination: { totalCount: 1 } },
    "https://careers.epam.com/api/jobs/v2/search/careers-i18n": { data: { total: 2, jobs: [
      { uid: "blt1", name: "Senior Java Engineer", vacancy_type: "Hybrid", description: "<p>Java</p>",
        seo: { url: "/en/vacancy/senior-java-engineer-blt1_en" }, created_at: "2026-11-01T10:00:00Z",
        city: [{ name: "Madrid", country: { name: "Spain" } }, { name: "Warsaw", country: { name: "Poland" } }],
        category: { requirements: ["5+ years of Java"] } },
      { uid: "blt2", name: "Data Engineer", vacancy_type: "Remote", seo: { url: "/en/vacancy/data-engineer-blt2_en" },
        city: null, country: [{ name: "Spain" }] }] } },
    "https://api.rippling.com/platform/api/ats/v2/board/chess/jobs": { page: 0, pageSize: 100, totalItems: 2, totalPages: 1, items: [
      { id: "a1", name: "Site Reliability Engineer", url: "https://ats.rippling.com/chess/jobs/a1",
        locations: [{ name: "Remote", country: "Spain", countryCode: "ES", workplaceType: "REMOTE" }] },
      { id: "b2", name: "Japanese Translator ", url: "https://ats.rippling.com/chess/jobs/b2",
        locations: [{ name: "Remote", country: "Japan", countryCode: "JP", workplaceType: "REMOTE" }] }] },
    "https://api.rippling.com/platform/api/ats/v2/board/chess/jobs/a1": { description: { role: "<p>Run it</p>" } },
    "https://api.rippling.com/platform/api/ats/v2/board/chess/jobs/b2": { description: { role: "<p>Translate</p>" } },
  };
  const asked = [];
  const saved = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    const key = String(url).split("?")[0];
    const body = init.body ? JSON.parse(init.body) : null;
    if (body) posted.push(body);
    asked.push(key);
    const answer = typeof API[key] === "function" ? API[key](body) : API[key];
    return answer ? new Response(JSON.stringify(answer), { status: 200 }) : new Response("not found", { status: 404 });
  };
  const read = (name, ats, board) =>
    adapterFor(ats).listJobs(CompanySchema.parse({ name, ats, board }), "2026-11-09T00:00:00Z");
  const inSpain = (jobs) => jobs.filter((j) => jobLocationClasses(j).some((c) => ["spain", "remote-spain", "remote-europe"].includes(c)));
  const cap = await read("Capgemini", "jsonapi", "capgemini-es");
  assert.deepEqual(cap.map((j) => [j.title, j.locationsRaw, j.url]),
                   [["Senior Data Engineer", ["Valencia, Spain"], "https://careers.capgemini.com/job/1/"]]);
  const sage = await read("Sage", "jsonapi", "sage");
  assert.deepEqual(inSpain(sage).map((j) => j.externalId), ["VN1"], "Sage lists every country; Spain is filtered after");
  const sd = await read("Schwarz Digits", "jsonapi", "schwarz-digits");
  assert.deepEqual(sd.map((j) => j.locationsRaw), [["Barcelona, Spain"]]);
  assert.deepEqual(posted.at(-1).filters.location_city, ["location_SIT-ES_Barcelona"], "only the Spanish offices are asked for");
  const epam = await read("EPAM Systems", "jsonapi", "epam-es");
  assert.deepEqual(epam.map((j) => [j.title, j.locationsRaw, j.url]), [
    ["Senior Java Engineer", ["Madrid, Spain"], "https://careers.epam.com/en/vacancy/senior-java-engineer-blt1_en"],
    ["Data Engineer", ["Remote, Spain"], "https://careers.epam.com/en/vacancy/data-engineer-blt2_en"]]);
  assert.equal(inSpain(epam).length, 2);
  assert.match(epam[0].descriptionText, /5\+ years of Java/);
  await assert.rejects(read("X", "jsonapi", "nobody"), /no jsonapi mapping/);
  const chess = await read("Chess.com", "rippling", "chess");
  assert.deepEqual(inSpain(chess).map((j) => [j.title, j.workplaceType]), [["Site Reliability Engineer", "remote"]]);
  assert.match(chess[0].descriptionText, /Run it/);
  asked.length = 0;
  const lean = await adapterFor("rippling").listJobs(CompanySchema.parse({ name: "Chess.com", ats: "rippling", board: "chess" }),
    "2026-11-09T00:00:00Z", { wanted: (job) => inSpain([job]).length > 0 });
  assert.deepEqual(asked.filter((key) => /\/jobs\/./.test(key)), ["https://api.rippling.com/platform/api/ats/v2/board/chess/jobs/a1"],
                   "board discovery spends a request only on a posting open to Spain");
  assert.deepEqual(lean.map((j) => j.descriptionText.length > 0), [true, false], "the other comes back as the list has it");
  const rippling = adapterFor("rippling");
  assert.deepEqual(rippling.boardFromUrl("https://ats.rippling.com/chess/jobs"), { ats: "rippling", board: "chess", region: "global" });
  assert.equal(rippling.boardFromPage("https://www.chess.com/jobs", '<a href="https://ats.rippling.com/chess/jobs/a1">')?.board, "chess");
  assert.equal(rippling.boardFromUrl("https://www.chess.com/jobs"), null);
  globalThis.fetch = saved;
}

// --- SuccessFactors career sites, over a stubbed fetch -------------------------

const sf = await import("../lib/ats/sources/successfactors.js");
const sfRow = (id, title, place) => `<tr class="data-row">
  <td class="colTitle"><span class="jobTitle"><a href="/job/Madrid-${id}/${id}/" class="jobTitle-link">${title}</a></span></td>
  <td class="colLocation"><span class="jobLocation"> ${place} </span></td>
  <td class="colDate"><span class="jobDate">Nov 3, 2026 </span></td></tr>`;
const SF = {
  "https://careers.acme.example/search/?q=&locationsearch=Spain":
    `<link href="https://rmkcdn.successfactors.com/x/site.css"><span class="paginationLabel">Resultados <b>1 – 2</b> de <b>3</b></span>
     ${sfRow("1000001", "Backend Engineer", "Madrid, M, ES")}${sfRow("1000002", "Data &amp; AI Lead", "MADRID, ES, 28046")}`,
  // Indra's layout: no date column, the date beside the title, in Spanish.
  "https://careers.acme.example/search/?q=&locationsearch=Spain&startrow=2": `<tr class="data-row">
  <td class="colTitle"><span class="jobTitle"><a href="/job/Lisboa-1000003/1000003/" class="jobTitle-link">Sales Rep</a></span>
  <span class="jobDate visible-phone">3 dic 2025 </span></td><td class="colLocation"><span class="jobLocation"> Lisboa, PT </span></td></tr>`,
  "https://careers.acme.example/job/Madrid-1000001/1000001/":
    `<span itemprop="jobLocation"><meta itemprop="addressLocality" content="Barcelona"><meta itemprop="addressRegion" content="B">
     <meta itemprop="addressCountry" content="ES"></span><meta itemprop="datePosted" content="Sat Nov 07 08:00:00 UTC 2026">
     <span itemprop="description"><span class="jobdescription"><p>Go and <span>Kafka</span>.</p></span></span>`,
  "https://jobs.newer.example/search/?q=&locationsearch=Spain": `<script>var CSRFToken = "42b238cd-9b2d-4a8a";</script>`,
  "https://jobs.newer.example/services/recruiting/v1/jobs": { totalJobs: 1, jobSearchResult: [{ response: {
    id: "1425", unifiedStandardTitle: "SAP Lead", unifiedUrlTitle: "SAP-Lead", supportedLocales: ["en_US"],
    jobLocationShort: ["Sant Cugat del Valles, B, ESP, "], unifiedStandardStart: "10/15/26" } }] },
};
const sfSeen = [];
globalThis.fetch = async (url, init = {}) => {
  sfSeen.push([String(url), init.method, init.headers?.["X-CSRF-Token"] ?? null]);
  const body = SF[String(url)];
  if (body === undefined) return new Response("not found", { status: 404 });
  return new Response(typeof body === "string" ? body : JSON.stringify(body), { status: 200 });
};
const sfCompany = (name, board) => ({ name, ats: "successfactors", board, query: "", tier: "B", tags: [] });
// Only the first posting page is read; the others keep what the table says.
process.env.ATS_SUCCESSFACTORS_MAX_DETAILS = "1";
const sfJobs = await sf.successfactorsAdapter.listJobs(sfCompany("Acme", "careers.acme.example"), "2026-11-09T00:00:00Z");
assert.deepEqual(sfJobs.map((j) => [j.title, j.locationsRaw.join("|")]), [
  ["Backend Engineer", "Barcelona, B, Spain"], ["Data & AI Lead", "MADRID, Spain"], ["Sales Rep", "Lisboa, Portugal"],
], "postings from both pages, the posting page's place winning over the table's");
assert.deepEqual(sfJobs.map((j) => j.postedAt), ["2026-11-07T08:00:00.000Z", "2026-11-03T00:00:00.000Z", "2025-12-03T00:00:00.000Z"],
                 "the posting page's date, else the table's, in English or Spanish");
assert.match(sfJobs[0].descriptionText, /Go and Kafka/);
const newer = await sf.successfactorsAdapter.listJobs(sfCompany("Newer", "jobs.newer.example"), "2026-11-09T00:00:00Z");
assert.deepEqual(newer.map((j) => [j.title, j.url, j.locationsRaw[0], j.postedAt]),
                 [["SAP Lead", "https://jobs.newer.example/job/SAP-Lead/1425-en_US/", "Sant Cugat del Valles, B, Spain", "2026-10-15T00:00:00.000Z"]]);
assert.deepEqual(sfSeen.at(-1).slice(1), ["POST", "42b238cd-9b2d-4a8a"], "the API is asked with the page's own token");
assert.deepEqual(sf.successfactorsAdapter.boardFromPage("https://careers.acme.example/", SF["https://careers.acme.example/search/?q=&locationsearch=Spain"]),
                 { ats: "successfactors", board: "careers.acme.example", region: "global" });
assert.equal(sf.successfactorsAdapter.boardFromPage("https://acme.example/", "<html>no board</html>"), null);
assert.throws(() => sf.searchUrl({ board: "https://x.example/search" }), /career site's host/);
assert.equal(sf.searchUrl({ board: "careers.indragroup.com", query: "locationsearch=Spain&optionsFacetsDD_customfield5=Minsait" }),
             "https://careers.indragroup.com/search/?q=&locationsearch=Spain&optionsFacetsDD_customfield5=Minsait", "a query with = is the search's own parameters");

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
{
  const { searchTexts } = await import("../lib/ats/sources/workday.js");
  assert.deepEqual(searchTexts("Spain|Madrid| Barcelona"), ["Spain", "Madrid", "Barcelona"], "one Workday search per office");
  assert.deepEqual(searchTexts("Spain"), ["Spain"]);
  assert.deepEqual(searchTexts(undefined), [undefined], "no query stays no search text");
}
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
const given = await spain.probeCompany(
  { name: "Acme", levelsSlug: "acme", website: null, careers: { ats: "lever", board: "acme" },
    cities: [], engineerMedian: null, engineerCount: 0 },
  rules,
  { resolve: async () => [], listJobs: async () => [{ locationClass: "spain", locationsRaw: ["Madrid, Spain"] }] },
);
assert.equal(given.kept?.board, "acme", "a board written out in data/careers.json is taken as it is");
// Dormant boards: the company's own board stays with nothing in Spain today.
const acmeCo = { name: "Acme", levelsSlug: "acme", website: null, cities: [], engineerMedian: null, engineerCount: 0 };
const berlin = [{ locationClass: "europe", locationsRaw: ["Berlin, Germany"], title: "Engineer at Acme", descriptionText: "Acme" }];
const madrid = [{ locationClass: "spain", locationsRaw: ["Madrid, Spain"], title: "Engineer", descriptionText: "Acme" }];
const probe = (company, guesses, jobsFor) => spain.probeCompany(company, rules,
  { resolve: async () => guesses, listJobs: async (entry) => jobsFor(entry.board) });
const own = await probe({ ...acmeCo, careers: { ats: "lever", board: "acme" } }, [], () => berlin);
assert.deepEqual([own.kept?.board, own.dormant], ["acme", true], "its own board with nothing in Spain is kept, dormant");
const empty = await probe({ ...acmeCo, careers: { ats: "lever", board: "acme" } }, [], () => []);
assert.equal(empty.kept?.board, "acme", "its own empty board is kept too");
const guessedEmpty = await probe(acmeCo, [{ ats: "lever", board: "acme", url: "https://api.lever.co/v0/postings/acme" }], () => []);
assert.equal(guessedEmpty.kept, null, "a guessed slug with nothing on it is not kept");
const guessedNamed = await probe(acmeCo, [{ ats: "lever", board: "acme", url: "https://api.lever.co/v0/postings/acme" }], () => berlin);
assert.equal(guessedNamed.dormant, true, "a guessed board naming the company is kept, dormant");
const spainWins = await probe({ ...acmeCo, careers: { ats: "lever", board: "acme" } },
  [{ ats: "greenhouse", board: "acmeco", url: "https://boards-api.greenhouse.io/v1/boards/acmeco" }],
  (board) => (board === "acmeco" ? madrid : berlin));
assert.deepEqual([spainWins.kept?.board, spainWins.dormant], ["acmeco", false], "postings in Spain beat a dormant board");

// Bending Spoons: the positions in its own site's __NEXT_DATA__; Apple's careers links read as its search for Spain.
const { entry } = await import("../scripts/jobs.mjs");
const spoonsAts = await loadAts();
const office = (title, isoCode, name) => ({ title, country: { isoCode, name, enablesRemoteWork: true } });
const spoonsList = [
  { id: "aa1", status: "active", isEvent: false, jobTitle: "Software engineer", workSchedule: "full_time_and_part_time",
    officeLocations: [office("Madrid (Spain)", "ES", "Spain"), office("Milan (Italy)", "IT", "Italy")],
    availableAsRemoteInDefaultCountries: false, additionalRemoteWorkCountries: [],
    highLevelDescription: "<span>We build apps.</span>", responsibilities: ["<span>Ship.</span>"],
    requirements: [{ title: "Reasoning", description: "Sharp." }], sellingPoints: [] },
  { id: "aa2", status: "active", isEvent: false, jobTitle: "Legal counsel, US",
    officeLocations: [office("New York (NY)", "US", "United States")], availableAsRemoteInDefaultCountries: false,
    additionalRemoteWorkCountries: [{ isoCode: "US", name: "United States", enablesRemoteWork: true }] },
  { id: "aa3", status: "active", isEvent: true, jobTitle: "Hackathon", officeLocations: [office("Madrid (Spain)", "ES", "Spain")] },
];
globalThis.fetch = async () => new Response(`<html><script id="__NEXT_DATA__" type="application/json">${
  JSON.stringify({ props: { pageProps: { list: spoonsList } } })}</script></html>`, { status: 200 });
const spoonsBoard = { name: "Bending Spoons", ats: "bendingspoons", board: "jobs.bendingspoons.com", tier: "A", tags: ["spain"] };
const spoonsJobs = await spoonsAts.adapterFor("bendingspoons").listJobs(spoonsAts.CompanySchema.parse(spoonsBoard), new Date().toISOString());
assert.deepEqual(spoonsJobs.map((j) => j.externalId), ["aa1", "aa2"], "events are not postings");
assert.deepEqual(spoonsJobs[0].locationsRaw, ["Madrid, Spain", "Milan, Italy"]);
assert.equal(spoonsJobs[0].url, "https://jobs.bendingspoons.com/positions/aa1");
assert.ok(/Reasoning/.test(spoonsJobs[0].descriptionText));
const spoonsRows = spoonsJobs.map((j) => entry(j, spoonsBoard, "bending-spoons", spoonsAts.location)).filter(Boolean);
assert.deepEqual(spoonsRows.map((r) => r.id), ["bendingspoons:jobs.bendingspoons.com:aa1"], "only the Madrid role is open to Spain");
assert.throws(() => spoonsAts.CompanySchema.parse({ ...spoonsBoard, ats: "nextdata" }));
await assert.rejects(spoonsAts.adapterFor("bendingspoons").listJobs(
  spoonsAts.CompanySchema.parse({ ...spoonsBoard, board: "jobs.example.com" }), new Date().toISOString()));
const apple = spoonsAts.adapterFor("apple");
assert.equal(apple.boardFromUrl("https://www.apple.com/careers/us/")?.board, "spain-ESPC");
assert.equal(apple.boardFromUrl("https://www.apple.com/iphone/"), null);
assert.equal(spoonsAts.adapterFor("bendingspoons").boardFromUrl("https://jobs.bendingspoons.com/positions/x")?.board,
             "jobs.bendingspoons.com");

// --- JSON-LD career sites: a listing, then one JobPosting per page ----------
const { jsonldAdapter, jobPostings } = await import("../lib/ats/sources/jsonld.js");
const ld = (posting) => `<html><script type="application/ld+json">${JSON.stringify(posting)}</script></html>`;
const SITE = {
  "https://acme.example/careers/jobs/": `<a href="/jobs/backend-engineer/">Backend</a>
    <a href="https://acme.example/jobs/sales-lead/#apply">Sales</a><a href="/careers/jobs/<%- url %>">x</a>
    <a href="https://other.example/jobs/elsewhere/">elsewhere</a><a href="/about/">about</a>`,
  "https://acme.example/jobs/backend-engineer/": ld({ "@context": "https://schema.org", "@type": "JobPosting",
    title: "Backend Engineer", identifier: { "@type": "PropertyValue", value: "be-1" }, datePosted: "2026-11-01",
    description: "<p>You have 3+ years of experience with Go.</p>",
    jobLocation: { "@type": "Place", address: { "@type": "PostalAddress", addressLocality: "Barcelona", addressCountry: "ES" } },
    baseSalary: { "@type": "MonetaryAmount", currency: "EUR", value: { minValue: 55000, maxValue: 70000, unitText: "YEAR" } } }),
  "https://acme.example/jobs/sales-lead/": ld({ "@graph": [{ "@type": "WebPage" }, { "@type": "JobPosting",
    title: "Sales Lead", jobLocation: [{ "@type": "Place", address: "Boston" }], validThrough: "2020-01-01" }] }),
};
const realFetch = globalThis.fetch;
const seenLd = [];
globalThis.fetch = async (url) => {
  seenLd.push(String(url));
  return String(url) in SITE ? new Response(SITE[String(url)], { status: 200 }) : new Response("gone", { status: 404 });
};
const acme = { name: "Acme", ats: "jsonld", board: "acme.example/careers/jobs/", tier: "B", tags: [], query: "" };
const ldJobs = await jsonldAdapter.listJobs(acme, "2026-11-09T00:00:00Z");
globalThis.fetch = realFetch;
assert.deepEqual(ldJobs.map((j) => [j.externalId, j.title, j.locationsRaw]), [["be-1", "Backend Engineer", ["Barcelona, Spain"]]],
                 "the closed posting is dropped, the template and foreign links never read");
assert.deepEqual(seenLd.filter((u) => u.includes("other.example") || u.includes("%")), []);
assert.equal(ldJobs[0].compensation.min, 55000);
assert.equal(ldJobs[0].compensation.period, "year");
assert.equal(jobPostings('<script type="application/ld+json">{"@type":"JobPosting","title":"A\nB"}</script>').length, 1,
             "raw line breaks inside JSON-LD strings are tolerated");
assert.throws(() => jsonldAdapter.listUrl({ ...acme, query: "everything" }), /unknown jsonld option/);
const { pageLinks } = await import("../lib/ats/sources/jsonld.js");
assert.deepEqual(pageLinks('<a href="/jobs/page/2/">2</a><a href="/jobs/?page=3">3</a><a href="/blog/page/2/">x</a>' +
                           '<a href="/jobs/page/99/">99</a>', new URL("https://acme.example/jobs/")),
                 ["https://acme.example/jobs/page/2/", "https://acme.example/jobs/?page=3"], "listing pages, capped at 10");

// --- Boards behind a page built with JavaScript ---------------------------------

{
  const { boardFromRequest, probeCompany } = await import("../lib/ats/presets/spain.js");
  assert.deepEqual(boardFromRequest("https://boards-api.greenhouse.io/v1/boards/acme/jobs?content=true"), { ats: "greenhouse", board: "acme", region: "global" });
  assert.deepEqual(boardFromRequest("https://api.eu.lever.co/v0/postings/acme?mode=json"), { ats: "lever", board: "acme", region: "eu" });
  assert.deepEqual(boardFromRequest("https://api.ashbyhq.com/posting-api/job-board/acme"), { ats: "ashby", board: "acme", region: "global" });
  assert.deepEqual(boardFromRequest("https://api.smartrecruiters.com/v1/companies/Acme/postings"), { ats: "smartrecruiters", board: "Acme", region: "global" });
  assert.deepEqual(boardFromRequest("https://apply.workable.com/api/v3/accounts/acme/jobs"), { ats: "workable", board: "acme", region: "global" });
  assert.deepEqual(boardFromRequest("https://acme.wd3.myworkdayjobs.com/wday/cxs/acme/External/jobs"), { ats: "workday", board: "acme/wd3/External", region: "global" });
  assert.deepEqual(boardFromRequest("https://jobs.ashbyhq.com/acme/embed"), { ats: "ashby", board: "acme", region: "global" }, "links still count");
  assert.equal(boardFromRequest("https://www.googletagmanager.com/gtm.js?id=X"), null);

  const company = { name: "Acme", levelsSlug: "acme", website: "https://acme.example", careers: "https://acme.example/careers", cities: [], engineerMedian: null, engineerCount: 0 };
  const rules = { threshold: 60_000, companyFloor: 45_000, minRanked: 3, dataAsOf: "" };
  const rendered = [];
  const deps = {
    resolve: async () => [],
    listJobs: async () => [],
    fetchPage: async () => "<div id=root></div>",
    renderPage: async (url) => {
      rendered.push(url);
      return url === "https://acme.example/careers"
        ? { url, html: "<div id=root>Jobs</div>", requests: ["https://boards-api.greenhouse.io/v1/boards/acme/jobs"] }
        : null;
    },
  };
  const report = await probeCompany(company, rules, deps);
  assert.deepEqual(rendered, ["https://acme.example/careers"], "rendered once, after the HTML gave nothing");
  assert.equal(report.kept?.board, "acme", "the board the page called is the company's own");
  assert.equal(report.dormant, true);

  rendered.length = 0;
  deps.fetchPage = async () => '<a href="https://jobs.lever.co/acme">Jobs</a>';
  await probeCompany(company, rules, deps);
  assert.deepEqual(rendered, [], "no browser when the HTML links a board");
}
// --- Remote boards: employers with no salary in Spain on file ---------------
const { boardOf, hostsIn, judge, rotated } = await import("../scripts/remote_boards.mjs");
const remoteBoard = { name: "Far", ats: "ashby", board: "far", remote: true, tags: ["remote"] };
const { normalizeJob } = await import("../lib/ats/sources/normalize.js");
const posting = (id, locations, more = {}) => normalizeJob({
  company: spoonsAts.CompanySchema.parse(remoteBoard), externalId: id, title: "Backend Engineer",
  locations, url: `https://jobs.ashbyhq.com/far/${id}`, descriptionPlain: "Write to jobs@far.dev or see www.far.dev/team.", ...more,
}, new Date().toISOString());
const farJobs = [posting("1", ["Remote - Europe"], { workplaceType: "remote" }), posting("2", ["Remote"], { workplaceType: "remote" }),
                 posting("3", ["Madrid, Spain"]), posting("4", ["Remote - Spain"], { workplaceType: "remote",
                   structuredCompensation: { min: 70000, max: 90000, currency: "EUR", period: "year", source: "ats-structured" } })];
const kept = (board) => farJobs.map((j) => entry(j, board, null, spoonsAts.location)).filter(Boolean).map((r) => r.id.split(":")[2]);
assert.deepEqual(kept(remoteBoard), ["1", "3", "4"], "a bare Remote on a remote board is not open to Spain");
assert.deepEqual(kept({ ...remoteBoard, remote: undefined }), ["1", "2", "3", "4"], "as it is on a listed company's");
assert.equal(entry(farJobs[0], remoteBoard, null, spoonsAts.location).tier, null, "and nobody without salaries is tiered");
const asRemote = (job) => entry(job, remoteBoard, null, spoonsAts.location);
const verdict = judge(farJobs, asRemote);
assert.deepEqual([verdict.postings, verdict.open, verdict.paid], [4, 3, 1], "a posting open to Spain makes a board a candidate, and its pay is counted");
assert.ok(verdict.hosts.includes("far.dev") && verdict.hosts.includes("jobs.ashbyhq.com"));
assert.deepEqual(hostsIn([{ descriptionText: "v1.2 and e.g. nothing", url: "https://www.acme.com/x" }]), ["acme.com"]);
const pay = { structuredCompensation: { min: 40000, max: 50000, currency: "EUR", period: "year", source: "ats-structured" } };
const inOffice = judge([posting("5", ["Madrid, Spain"], pay), posting("6", ["Barcelona, Spain"]), posting("7", ["Berlin, Germany"], pay)], asRemote);
assert.deepEqual([inOffice.open, inOffice.paid], [2, 1], "an office in Spain counts like remote work, pay elsewhere does not");
const inText = judge([posting("8", ["Valencia, Spain"], { descriptionPlain: "Salario: 45.000 - 55.000 € brutos anuales." }),
                      posting("9", ["Remote - Europe"], { workplaceType: "remote", descriptionPlain: "Salary: 45.000 - 55.000 € gross per year." })], asRemote);
assert.deepEqual([inText.open, inText.paid], [2, 1], "pay in the description counts where the crawl reads it: in Spain or remote from it");
assert.deepEqual(judge([posting("10", ["Berlin, Germany"], pay)], asRemote).hosts, [], "nothing open to Spain, nothing to ask about");
assert.equal(boardOf("com,ashbyhq,jobs)/linear/abc 2026", "com,ashbyhq,jobs)/", "path"), "linear");
assert.equal(boardOf("com,ashbyhq,jobs)/api/x", "com,ashbyhq,jobs)/", "path"), null);
assert.equal(boardOf("com,teamtailor,acme)/jobs", "com,teamtailor,", "host"), "acme");
assert.equal(boardOf("com,teamtailor,www)/", "com,teamtailor,", "host"), null);
assert.equal(boardOf("com,workable,apply)/j/ABC123", "com,workable,apply)/", "path"), null, "a posting's short link");
assert.deepEqual(rotated(["a", "b", "c"], 1), ["c", "a", "b"]);
assert.deepEqual([rotated([], 5), rotated(["a", "b", "c"], 3)], [[], ["a", "b", "c"]]);
assert.equal(boardOf("com,ashbyhq,jobs)/%zz", "com,ashbyhq,jobs)/", "path"), null);

console.log(`jobs: crawl ${index.jobs.length} kept of 10, fixture ${fixture.jobs.length}, fallbacks ok`);

{
  const { titlePlace } = await import("../lib/ats/sources/avature.js");
  assert.deepEqual(["Operador de Loja - Braga", "Médico/a - Lugo", "Médico/a"].map(titlePlace),
                   ["Braga, Portugal", "Lugo, Spain", ""], "a place read off the title's end");
}

// --- Classic iCIMS and Jobvite parsers ----------------------------------------
{
  const { parseIcimsCards } = await import("../lib/ats/sources/icimsclassic.js");
  const cards = parseIcimsCards(`<ul class="container-fluid iCIMS_JobsTable"><li class="iCIMS_JobCardItem"><div class="row">
<div class="col-xs-6 header right"><span class="sr-only field-label">Posted Date</span><span title="11/20/2026 6:16 AM">24 hours ago</span></div>
<div class="col-xs-12 title"><a href="https://expleo-jobs-es-en.icims.com/jobs/58722/ingeniero-a-rams/job?in_iframe=1" class="iCIMS_Anchor" title="58722 - Ingeniero/a RAMS"><span class="sr-only field-label">Title</span><h3 >Ingeniero/a RAMS &ndash; Sistemas Embarcados</h3></a></div>
<div class="col-xs-12 additionalFields"><dl class="iCIMS_JobHeaderGroup">
<div class="iCIMS_JobHeaderTag"><dt class="iCIMS_JobHeaderField"><span class="sr-only field-label">Job Locations</span></dt><dd class="iCIMS_JobHeaderData"><span >ES-CL-Le&oacute;n, Castilla y Le&oacute;n ,</span></dd></div>
<div class="iCIMS_JobHeaderTag"><dt class="iCIMS_JobHeaderField">Salary minimum</dt><dd class="iCIMS_JobHeaderData"><span >EUR &euro;25,000.00/Yr.</span></dd></div>
<div class="iCIMS_JobHeaderTag"><dt class="iCIMS_JobHeaderField">Salary maximum</dt><dd class="iCIMS_JobHeaderData"><span >EUR &euro;48,000.00/Yr.</span></dd></div>
</dl></div></div></li>
<li class="iCIMS_JobCardItem"><div class="row"><div class="col-xs-6 header left"><span class="sr-only field-label">Job Locations</span><span >ES-Rivas-Vaciamadrid | ES-Remote | PL</span></div>
<div class="col-xs-12 title"><a href="https://internationalcareers-bruker.icims.com/jobs/20395/team-leader/job?hub=12&amp;in_iframe=1" class="iCIMS_Anchor" title="20395 - Team Leader"><h3 >Team Leader Commercial, IBERIA (m/f/d)</h3></a></div></div></li></ul>`, "worldwidecareers-bruker.icims.com");
  assert.deepEqual(cards.map((c) => c.id), ["58722", "20395"]);
  assert.match(JSON.stringify(cards[0]), /Le[oó]n, Castilla y Le[oó]n, Spain/);
  assert.match(JSON.stringify(cards[1]), /Rivas-Vaciamadrid, Spain.*Remote, Spain.*Poland/);
  assert.ok(cards[1].url.startsWith("https://worldwidecareers-bruker.icims.com/jobs/20395/"), "postings are read on the board's own host");
  const { parseJobviteList, parseJobviteDetail } = await import("../lib/ats/sources/jobvite.js");
  const rows = parseJobviteList(`<table class="jv-job-list"><tbody><tr><td class="jv-job-list-name"><a href="/nutanix/job/omDAAfwT">Senior Support Engineer</a></td><td class="jv-job-list-location">
    Barcelona,
    Spain
</td></tr>
<tr><td class="jv-job-list-name"><a href="/telemedicine-clinic/job/oB94Afw8">Consultant Radiologist</a></td><td class="jv-job-list-location"><div class="jv-meta">
    2 Locations
</div></td></tr></tbody></table>
<div class="jv-job-item card"><div class="jv-job-list-name"><a href="/drillinginfo/job/oy9CAfwD">Business Development Representative</a></div><div class="jv-job-list-location">
    Madrid,
    Spain
</div></div>`, "x");
  assert.equal(rows.length, 3);
  assert.match(JSON.stringify(rows), /Barcelona, Spain.*2.*Madrid, Spain/s);
  const detail = parseJobviteDetail(`<p class="jv-job-detail-meta">
    Marketing<span class='jv-inline-separator'></span>
    Madrid,
    Spain
    <span class="jv-inline-separator"></span>
    Remote,
    Spain
<span class='jv-inline-separator'></span>Req.Num.: 32252
</p>
<div class="jv-job-detail-description" ng-non-bindable><h3>Description</h3><p>Sell.</p></div>
<script type="application/ld+json">{"@context":"http://schema.org","@type":"JobPosting","datePosted":"2026-11-06","identifier":"ojK3Afwq"}</script>`, 2);
  assert.match(JSON.stringify(detail), /Madrid, Spain.*Remote, Spain/);
  assert.match(JSON.stringify(detail), /2026-11-06/);
}

// --- Factorial, Njoyn and BeeSite parsers -------------------------------------
{
  const { parseFactorialList, parseFactorialPosting } = await import("../lib/ats/sources/factorial.js");
  const offers = parseFactorialList(`<option value='city:barcelona'>Barcelona</option>
<li class='job-offer-item w-full' data-is-remote='false' data-job-postings-url='https://mvst.factorial.com/job_posting/full-stack-developer-senior-292895' data-location-key='city:barcelona' role='button'>
<span class='md:w-3/6'><div class="text-sm sm:text-base font-bold factorial__headingFontFamily">Full Stack Developer (Senior)
</div></span><div class='flex-grow'><div class="text-sm leading-sm text-left">Development
</div></div><div class='flex-grow'><div class="text-sm leading-sm text-left">Hybrid
</div></div></li>
<li class='job-offer-item w-full' data-controller='job-postings' role='button'><span><div class="text-sm font-bold">Candidatura espontània</div></span></li>`);
  assert.deepEqual(offers.map((o) => [o.id, o.city, o.mode]), [["292895", "Barcelona", "Hybrid"]], "the open application is not a posting");
  const post = parseFactorialPosting(`<li><span class='self-start m-1'><svg></svg></span>
<span class='inline-block align-middle mr-2 ml-2'>Gurb, Barcelona, Espanya
</span></li>
<div class='styledText'><h2>Què esperem de tu?</h2><div><p>Text</p></div></div><div>after</div>`);
  assert.equal(post.place, "Gurb, Barcelona, Spain", "the country is read in the site's language");
  assert.match(post.descriptionHtml, /Què esperem de tu/);
  const { parseNjoynListing, parseNjoynPosting } = await import("../lib/ats/sources/njoyn.js");
  const listing = parseNjoynListing(`<header>Search Results (51)</header><table><tr HasMultipleLocations='0' RemoteWork='False' CountryIDs=''><td><a href='xweb.asp?NTKN=c&amp;clid=21001&amp;Page=JobDetails&amp;Jobid=J1026-2018&amp;BRID=1342822&amp;lang=1'>J1026-2018</a></td><td>DevOps Engineer con francés</td><td>Project Management</td><td>Madrid</td><td name='CountryCell'>Spain</td></tr>
<tr HasMultipleLocations='0' RemoteWork='True' CountryIDs=''><td><a href='xweb.asp?NTKN=c&amp;clid=21001&amp;Page=JobDetails&amp;Jobid=J0321-3585&amp;BRID=804338&amp;lang=1'>J0321-3585</a></td><td>Multilingual Service Desk Analyst</td><td>Service Desk</td><td>Eschborn</td><td name='CountryCell'>Germany</td></tr></table>`, "https://cgi.njoyn.com/CORP/xweb/");
  assert.match(JSON.stringify(listing), /51/);
  assert.match(JSON.stringify(listing), /Madrid.*Spain.*Eschborn.*Germany/s);
  assert.match(JSON.stringify(parseNjoynPosting(`<script type="application/ld+json">{"@context":"http://schema.org/","@type":"JobPosting","title":"DevOps Engineer","description":"Da el siguiente paso<br />","datePosted":"2026-11-18","validThrough":"2026-12-31","jobLocation":{"@type":"Place","address":{"addressLocality":"Madrid","addressCountry":"ES "}}}</script>`)), /2026-11-18/);
  const { beesitePostingUrl } = await import("../lib/ats/sources/beesite.js");
  assert.equal(beesitePostingUrl({ id: "76098", PositionURI: "/index.php?ac=jobad&id=76098" },
                                 { board: "api-deutschebank.beesite.de", query: "job=https://careers.db.com/professionals/search-roles/#/professional/job/{id}" }),
               "https://careers.db.com/professionals/search-roles/#/professional/job/76098");
}

// --- Own-site parsers in jsonapi ------------------------------------------------
{
  const j = await import("../lib/ats/sources/jsonapi.js");
  const bnp = j.parseBnpParibasCards('<ul class="jobs__list"><li class="block-job"><div class="crd crd--jobs"><div class="wrapper-job"><div class="crd__content"><p class="crd__type">Beca</p><h2 class="crd__title"><a class="crd__link" href="https://www.bnpparibas.es/es/jobs/department-office-pmo-swift-2/">Department Office &#8211; PMO Swift</a></h2><p class="crd__location"><svg class="icon icon-pin"><use href="#icon-pin"></use></svg>ES-Madrid-Madrid</p></div></div></div></li></ul>');
  assert.deepEqual([bnp[0].id, bnp[0].city, bnp[0].country], ["department-office-pmo-swift-2", "Madrid", "ES"]);
  const bsc = j.parseBscRows('<table class="views-table cols-4"><tbody><tr class="odd views-row-first"><td class="views-field views-field-title" ><a href="/join-us/job-opportunities/23126aiimtre1">231_26_AII_MT_RE1</a></td><td class="views-field views-field-field-jobref" >NLP Engineer (RE1)</td></tr></tbody></table>');
  assert.deepEqual([bsc[0].reference, bsc[0].title], ["231_26_AII_MT_RE1", "NLP Engineer (RE1)"]);
  const ms = j.parseManagementSolutionsOffers('<div id="MainContent_div1"><hr /><span id="MainContent_pais0"><font>United States <br /></font></span><a id="MainContent_1" href="VerOfertas.aspx?num=1"><b><font>BUSINESS CONSULTANT BOSTON<br /></font></b></a><span id="MainContent_provincia0"><font>Boston &nbsp;/ &nbsp;</font></span><br /><hr /><span id="MainContent_pais1"><font>Spain <br /></font></span><a id="MainContent_12" href="VerOfertas.aspx?num=12"><b><font>DATA SCIENCE CONSULTANT BILBAO<br /></font></b></a><span id="MainContent_provincia1"><font>Bilbao &nbsp;/ &nbsp;</font></span><br /></div>');
  assert.equal(ms.length, 2);
  assert.match(JSON.stringify(ms), /Spain.*Bilbao/);
}

// --- Cloudflare's challenge and the cloud browser ---------------------------------
{
  const { isChallenge, browserbaseEnabled } = await import("../lib/ats/sources/browserbase.js");
  const res = (status, headers) => new Response("", { status, headers });
  assert.ok(isChallenge(res(403, { "cf-mitigated": "challenge" })));
  assert.ok(isChallenge(res(403, { server: "cloudflare", "server-timing": 'chlray;desc="a5dfefc7393b013e"' })));
  assert.ok(!isChallenge(res(403, { server: "cloudflare" })), "a plain Cloudflare 403 is a refusal, not a challenge");
  assert.ok(!isChallenge(res(429, { "cf-mitigated": "challenge" })));
  // Without the key a challenge stays the HTTP 403 it always was.
  const key = process.env.BROWSERBASE_API_KEY;
  delete process.env.BROWSERBASE_API_KEY;
  assert.ok(!browserbaseEnabled());
  const saved = globalThis.fetch;
  globalThis.fetch = async () => new Response("<title>Just a moment...</title>", { status: 403, headers: { "cf-mitigated": "challenge" } });
  const { fetchText } = await import("../lib/ats/sources/http.js");
  await assert.rejects(fetchText("https://www.revolut.com/careers/", { allowedHosts: ["www.revolut.com"], retries: 0 }), /HTTP 403/);
  globalThis.fetch = saved;
  if (key !== undefined) process.env.BROWSERBASE_API_KEY = key;
}

// --- Undated postings keep the day the index first listed them --------------------
{
  const job = (id, posted_at, seen) => ({ id, posted_at, ...(seen ? { seen } : {}) });
  const prior = { version: 1, generated_at: "2026-11-21T01:00:00Z", boards: {}, jobs: [
    job("a:b:1", null, "2026-03-04"), job("a:b:2", null), job("a:b:3", "2026-01-01T00:00:00Z") ] };
  const today = { version: 1, generated_at: "2026-11-22T01:00:00Z", boards: {}, jobs: [
    job("a:b:1", null), job("a:b:2", null), job("a:b:3", "2026-01-01T00:00:00Z", "2026-02-02"), job("a:b:4", null) ] };
  assert.deepEqual(stampSeen(today, prior).jobs.map((j) => j.seen ?? null), ["2026-03-04", "2026-11-22", null, "2026-11-22"],
    "an undated posting keeps its first day, a new or unrecorded one starts today, a dated one has none");
  assert.deepEqual(stampSeen(today, "HTTP 500").jobs.map((j) => j.seen ?? null), ["2026-11-22", "2026-11-22", null, "2026-11-22"],
    "with no previous index every undated posting starts today");
}

// --- Application forms of sites that turn the MCP away, read once each ------------
{
  const page = readFileSync("tests/fixtures/viterbit-apply.html", "utf8").replace("COUNTRIES", "");
  const site = (id, extra = {}) => ({ id: `jsonld:careers.example.com/sitemap.xml:${id}`, ats: "jsonld",
                                      url: `https://careers.example.com/p-${id}/`, ...extra });
  const other = { id: "jsonld:www.open.example/sitemap.xml:9", ats: "jsonld", url: "https://www.open.example/p-9/" };
  const read = [];
  const reader = (answers) => async (url) => {
    read.push(url);
    const answer = answers[url];
    if (answer instanceof Error) throw answer;
    return answer ?? "<html>no form</html>";
  };
  const prior = { version: 1, generated_at: "2026-11-22T01:00:00Z", boards: {}, forms: [[{ key: "name", label: "Nombre" }]],
    jobs: [site(1, { form: 0, form_read: "2026-11-20" }), site(5, { form: 3 })] };
  const today = { version: 1, generated_at: "2026-11-23T01:00:00Z", boards: {}, forms: [["stale"]],
    jobs: [site(1), site(2), site(3), site(4), site(5), other] };
  const out = await storeForms(today, prior, ["careers.example.com"], reader({
    "https://careers.example.com/p-2/apply/": page, "https://careers.example.com/p-3/apply/": page,
    "https://careers.example.com/p-4/apply/": new Error("HTTP 403") }));
  const byId = Object.fromEntries(out.index.jobs.map((j) => [j.id.split(":").at(-1), j]));
  assert.deepEqual(read, ["https://careers.example.com/p-2/apply/", "https://careers.example.com/p-3/apply/",
    "https://careers.example.com/p-4/apply/", "https://careers.example.com/p-5/apply/"],
    "only postings on the listed hosts with no stored form are read, each at its apply/ page");
  assert.deepEqual([out.reads, out.failed], [4, 1]);
  assert.deepEqual(out.index.forms[byId[1].form], [{ key: "name", label: "Nombre" }], "a stored form is kept from the previous index");
  assert.equal(byId[1].form_read, "2026-11-20");
  assert.equal(byId[2].form, byId[3].form, "two postings with the same form share one entry");
  assert.equal(byId[2].form_read, "2026-11-23");
  assert.equal(out.index.forms[byId[2].form].find((f) => f.key === "question_aa01").preselected, "Básico (A1/A2)");
  assert.equal(out.index.forms.length, 2, "the previous run's forms are not carried as they are");
  for (const id of ["4", "5", "9"]) assert.ok(!("form" in byId[id]) && !("form_read" in byId[id]), `posting ${id} has no form`);
  read.length = 0;
  const off = await storeForms(today, prior, ["careers.example.com"], reader({}), 0);
  assert.deepEqual([read.length, off.index.jobs.filter((j) => "form" in j).length], [0, 1],
    "without the browser nothing is read and stored forms are kept");
  const none = await storeForms({ ...today, jobs: [other] }, null, ["careers.example.com"], reader({}));
  assert.ok(!("forms" in none.index), "an index with no stored form has no forms key");
}

// --- Level from years, workplace from the description, roles the title missed ------
{
  const { levelOfYears, workplaceAsked, titleRoles } = await import("../api/_classify.js");
  assert.deepEqual([[0, 1], [0, 2], [1, null], [3, 5], [5, null], [9, null], [10, null], null].map(levelOfYears),
    ["intern", "junior", "junior", "mid", "senior", "senior", "staff", null]);
  const said = {
    "Ofrecemos horario flexible y modelo híbrido de trabajo.": "hybrid",
    "Standard hybrid schedule of 3 days a week in the office.": "hybrid",
    "Modelo 100% presencial: trabajarás desde nuestra oficina.": "onsite",
    "Typeform is fully remote by design.": "remote",
    "Consultor SAP (100% teletrabajo)": "remote",
    "We build hybrid cloud infrastructure.": null,
    "Horario flexible, teletrabajo y semanas full remote.": null,
    "Medidas de flexibilidad (trabajo en remoto, flexibilidad entrada).": null,
    "Remote or hybrid: fully remote, or a hybrid model in Madrid.": null,
  };
  assert.deepEqual(Object.keys(said).map(workplaceAsked), Object.values(said));
  const known = new Set(["software-engineer", "security-analyst", "information-technologist", "accountant", "marketing",
    "hardware-engineer", "business-analyst", "legal"]);
  const roles = {
    "QA Automation Tester": "software-engineer", "Tech Lead | Java": "software-engineer",
    "Penetration tester M/F": "security-analyst", "Cloud Security Engineer": "software-engineer",
    "Técnico/a Junior de Sistemas y Aplicaciones": "information-technologist", "Document Controller M/F": undefined,
    "Senior Software Engineer - Growth": "software-engineer", "Ingeniero/a de RF M/F": "hardware-engineer",
    "Ingeniero/a de Software Embebido para Defensa Electrónica": "software-engineer",
    "Compliance Officer": "legal", "Senior Security Compliance Engineer": "software-engineer",
    "VENDEDOR/A - MÁLAGA": undefined,
  };
  assert.deepEqual(Object.keys(roles).map((t) => titleRoles(t, known)[0]), Object.values(roles));
}

// --- Pay in the description, and postings that are not office work -----------------
{
  const { payAsked, frontline } = await import("../api/_classify.js");
  const eur = (min, max, extra = {}) => ({ min, max, currency: "EUR", period: "year", source: "description", ...extra });
  const month = (min, max) => eur(min, max, { period: "month" }), hour = (min, max) => eur(min, max, { period: "hour" });
  const pay = [
    ["Banda salarial: 25.000€ -27.000€ (brutos/anuales) + variable", eur(25000, 27000)],
    ["La retribución inicial anual de referencia asociada al puesto es de 78.000 € brutos anuales.", eur(78000, 78000)],
    ["Transparent salary grids from 34.000€ to 48.000€ OTE, with a 70/30 split", eur(34000, 48000, { variable_included: true })],
    ["Excellent Salary conditions: L4 [up to 75K€]", eur(null, 75000)],
    ["Salary range: €45k - €60k", eur(45000, 60000)],
    ["Gestionará una cuenta de resultados que supere los 500 M€ de ingresos anuales", null],
    ["Experiencia en proyectos de gran envergadura (entre 500K€ y 5M€)", null],
    ["Salario 1.500€ brutos al mes", month(1500, 1500)],
    ["Salario 1.200€ - 1.500€ brutos/mes", month(1200, 1500)],
    ["Retribución: 12,50 €/hora", hour(12.5, 12.5)],
    ["Salario 1.200€ netos al mes", null],
    ["Salario: 21.000€ brutos anuales (1.500€ al mes en 14 pagas)", eur(21000, 21000)],
    ["Ticket restaurante de 11 € al día. Salario 28.000€ brutos", eur(28000, 28000)],
    ["The anticipated base salary range is $123,500 - $145,000 per year.", null],
    ["Spain 40.000€-50.000€ gross; Portugal 30.000€ - 35.000€ gross", null],
    ["Vigilante en comercio con plus 650 euros al mes", null],
  ];
  assert.deepEqual(pay.map(([text]) => payAsked(text)), pay.map(([, want]) => want));
  const front = { "VENDEDOR/A - MÁLAGA CAMPAÑA BLACK FRIDAY": true, "STORE MANAGER - ALMERÍA": true,
    "Vigilante de Seguridad - León": true, "Carretillero/a - Mozo/a Almacén - Palencia": true, "Housekeeping Manager": true,
    "Ingeniero/a junior Obra Civil": false, "Supply Chain Manager - Driver & Carrier Experience": false,
    "Data Analyst - Retail stores": false };
  assert.deepEqual(Object.keys(front).map((t) => frontline(t)), Object.values(front));
  assert.equal(frontline("Store Manager", ["sales"]), false, "a title with a role is kept");
}
