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

console.log(`jobs: crawl ${index.jobs.length} kept of 10, fixture ${fixture.jobs.length}, fallbacks ok`);
