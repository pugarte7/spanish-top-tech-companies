// scripts/jobs.mjs, offline: autoapply-mcp's real adapters over a stubbed
// fetch, the index's shape and filter, the committed fixture, and the
// fallbacks when the crawl cannot run. Run after site.py:
//     node tests/jobs.test.mjs
import assert from "node:assert/strict";
import { execFile, execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, existsSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { crawl, isIndex, loadAutoapply } from "../scripts/jobs.mjs";

process.env.AUTOAPPLY_MIN_INTERVAL_MS = "0";
process.env.AUTOAPPLY_LOG_LEVEL = "error";

const KEYS = ["id", "company", "slug", "tier", "title", "url", "ats", "location", "location_classes",
              "workplace", "department", "posted_at", "salary"];
const CLASSES = new Set(["bay-area", "us-other", "canada", "remote-us", "remote-canada", "remote-global",
                         "spain", "remote-spain", "europe", "remote-europe", "other", "unknown"]);
const OPEN = ["spain", "remote-spain", "remote-europe", "remote-global"];
const iso = (v) => v === null || (typeof v === "string" && !Number.isNaN(Date.parse(v)));

function checkIndex(index, name) {
  assert.ok(isIndex(index), `${name}: not a jobs index`);
  assert.deepEqual(Object.keys(index), ["version", "generated_at", "boards", "jobs"], name);
  assert.match(index.generated_at, /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/, name);
  assert.deepEqual(Object.keys(index.boards), ["queried", "failed", "issues"], name);
  for (const [code, n] of Object.entries(index.boards.issues)) {
    assert.match(code, /^[a-z]+:[a-z_]+$/, `${name}: issue ${code}`);
    assert.ok(Number.isInteger(n) && n > 0);
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
               { pay_input_ranges: [{ min_cents: 6000000, max_cents: 8000000, currency_type: "EUR" }] }),
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
const requested = [];
globalThis.fetch = async (url) => {
  const key = String(url).split("?")[0];
  requested.push(key);
  return key in BOARDS ? new Response(JSON.stringify(BOARDS[key]), { status: 200 })
                       : new Response("not found", { status: 404 });
};

const boardsList = { version: 1, companies: [
  { name: "Cabify", ats: "greenhouse", board: "cabify", tier: "B", tags: ["spain"] },
  { name: "Gone", ats: "greenhouse", board: "gone", tier: "C", tags: ["spain"] },
  { name: "Job&Talent", ats: "lever", board: "jobandtalent", tier: "A", tags: ["spain"] },
  { name: "Nowhere", ats: "nope", board: "x", tier: "A", tags: [] },
] };
const data = { companies: [{ name: "Cabify", levels: "cabify" }, { name: "Job&Talent", levels: "jobandtalent" }] };
const { index } = await crawl(boardsList, data, await loadAutoapply(), { minutes: 1 });

checkIndex(index, "crawl");
assert.deepEqual(index.boards, { queried: 4, failed: 2,
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
});
assert.deepEqual(byId["greenhouse:cabify:3"].location_classes, ["remote-global"]);
assert.equal(byId["greenhouse:cabify:3"].workplace, "remote");
assert.deepEqual(byId["greenhouse:cabify:6"].location_classes, ["remote-europe"]);
assert.equal(byId["greenhouse:cabify:8"].salary, null, "pay read from a description is not published");
const lever = byId["lever:jobandtalent:aaaa-1"];
assert.deepEqual([lever.slug, lever.tier, lever.workplace, lever.url, lever.location],
                 ["jobandtalent", "A", "hybrid", "https://jobs.lever.co/jobandtalent/aaaa-1", "Barcelona; Lisbon"]);
assert.deepEqual(lever.location_classes, ["spain", "europe"]);
assert.deepEqual(lever.salary, { min: 50000, max: 65000, currency: "EUR", period: "year" });
assert.ok(!JSON.stringify(index).includes("We build things"), "descriptions stay out of the index");
assert.deepEqual(requested.sort(), ["https://api.lever.co/v0/postings/jobandtalent",
  "https://boards-api.greenhouse.io/v1/boards/cabify/jobs", "https://boards-api.greenhouse.io/v1/boards/gone/jobs"]);

// --- The committed fixture ----------------------------------------------------

const fixture = JSON.parse(readFileSync("tests/fixtures/jobs.json", "utf8"));
checkIndex(fixture, "fixture");
assert.ok(fixture.jobs.length >= 5 && fixture.jobs.length <= 10);
const site = JSON.parse(readFileSync("data/data.json", "utf8"));
const slugs = new Set(site.companies.map((c) => c.levels));
for (const job of fixture.jobs) assert.ok(slugs.has(job.slug), `fixture ${job.id}: ${job.slug} not in data.json`);

// --- The script itself: fixture copy, and a crawl that cannot run --------------

const tmp = mkdtempSync(join(tmpdir(), "jobs-test-"));
const run = (...args) => execFileSync(process.execPath, ["scripts/jobs.mjs", ...args],
                                      { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
run("--fixture", "tests/fixtures/jobs.json", "--out", join(tmp, "copy.json"));
assert.deepEqual(JSON.parse(readFileSync(join(tmp, "copy.json"), "utf8")), fixture);

let answer = { status: 200, body: JSON.stringify(fixture) };
const server = createServer((req, res) => { res.writeHead(answer.status); res.end(answer.body); });
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const previous = `http://127.0.0.1:${server.address().port}/api/v1/jobs.json`;
const broken = (out) => new Promise((resolve, reject) => {
  // Not execFileSync: the stub server answers on this process's event loop.
  execFile(process.execPath,
    ["scripts/jobs.mjs", "--boards", join(tmp, "missing.json"), "--out", out, "--previous", previous],
    (error) => (error ? reject(error) : resolve()));
});
await broken(join(tmp, "kept.json"));
assert.deepEqual(JSON.parse(readFileSync(join(tmp, "kept.json"), "utf8")), fixture,
                 "a crawl that cannot run keeps production's index");
answer = { status: 500, body: "" };
await broken(join(tmp, "none.json"));
assert.ok(!existsSync(join(tmp, "none.json")), "no index at all when production's cannot be read");
server.close();

console.log(`jobs: crawl ${index.jobs.length} kept of 10, fixture ${fixture.jobs.length}, fallbacks ok`);
