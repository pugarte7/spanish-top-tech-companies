#!/usr/bin/env node
// Finds each listed company's job board and writes data/boards.json, the map
// from a Levels.fyi slug to its board that scripts/jobs.mjs crawls every day
// and the site publishes at /api/v1/boards.json.
//
//   node scripts/boards.mjs                 # companies with no board, not checked lately
//   node scripts/boards.mjs --all           # every listed company again
//   node scripts/boards.mjs --only "BBVA,airbus"     # names or Levels.fyi slugs
//   node scripts/boards.mjs --all --resume  # continue an interrupted --all run
//   node scripts/boards.mjs --render        # a browser reads pages whose HTML links no board
//
// The rules live in lib/ats/presets/spain.js: a board is kept when it is the
// company's own (its site or careers page links it, or its postings name it),
// even with nothing in Spain today ("dormant"), so the daily crawl sees the day
// it posts here; among several, the one with most postings in Spain wins. Each candidate is probed through the same adapters and
// polite client the daily crawl uses, so a full run makes thousands of requests
// and takes most of an hour. The default run only probes companies that have no
// board and were not found boardless in the last RECHECK_DAYS, which
// data/boards-none.json remembers (slug -> day checked), so the weekly refresh
// only pays for new companies. A probed company with no board kept loses its
// entry; companies not probed keep theirs, and so does one whose probe ran past
// --timeout seconds.
//
// data/careers.json (slug -> careers page URL, set by hand) is read before the
// company's website: many employers' home pages never link their board, and a
// board on the employer's own domain is only recognisable from its careers page.
// An entry may instead be the board itself, {"ats", "board", "query"?}, for
// sites nothing on the page identifies.
//
// --render (on Actions, .github/workflows/boards.yml): when a page's HTML gives
// no board, headless Chromium loads it and the board is read off the built DOM
// and the requests the page makes. On 2026-11-20, 305 of 747 listed companies
// had no board, Glovo and Skyscanner among them, because their careers pages
// are built in JavaScript. The browser sends the same User-Agent as the client.

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
    careers: { type: "string", default: "data/careers.json" },
    browser: { type: "string", default: "data/browser-hosts.json" },
    timeout: { type: "string", default: "300" },
    report: { type: "string", default: join(tmpdir(), "stc-boards-report.json") },
    all: { type: "boolean", default: false },
    only: { type: "string" },
    limit: { type: "string" },
    resume: { type: "boolean", default: false },
    "no-websites": { type: "boolean", default: false },
    render: { type: "boolean", default: false },
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

// One browser for the run, one context per page. Images, fonts and media are
// never loaded: the board shows in the DOM and in the page's API calls.
// A page the local browser cannot load (a bot challenge, a 403) is tried once
// more in a Browserbase cloud browser when BROWSERBASE_API_KEY is set, and a
// page on a host in data/browser-hosts.json goes there at once: one session
// for the run, opened at the first such page.
const CHALLENGE_TITLE = /just a moment|un momento|attention required|checking your browser/i;
async function openBrowser() {
  const { chromium } = await import("@playwright/test");
  const bb = await import("../lib/ats/sources/browserbase.js");
  const local = await chromium.launch();
  let remote = null;
  const SKIP = new Set(["image", "media", "font"]);
  const render = async (page, url) => {
    await page.route("**/*", (route) => (SKIP.has(route.request().resourceType()) ? route.abort() : route.continue()));
    const requests = [];
    page.on("request", (request) => requests.push(request.url()));
    const response = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 20_000 });
    if (!response) return null;
    if (response.status() >= 400) {
      // A challenge page gives way to the site by itself once the browser passes;
      // any other refusal is final.
      if (!CHALLENGE_TITLE.test(await page.title())) return null;
      await page.waitForFunction((re) => !new RegExp(re, "i").test(document.title), CHALLENGE_TITLE.source, { timeout: 25_000 })
        .catch(() => {});
      if (CHALLENGE_TITLE.test(await page.title())) return null;
    }
    await page.waitForLoadState("networkidle", { timeout: 8_000 }).catch(() => {});
    return { url: page.url(), html: await page.content(), requests: [...requests, ...page.frames().map((frame) => frame.url())] };
  };
  const inCloud = async (url) => {
    remote ??= bb.createSession(3600).then((session) => chromium.connectOverCDP(session.connectUrl).then(
      (browser) => ({ session, browser }),
      async (error) => { await bb.releaseSession(session.id); throw error; }));
    let page;
    try {
      const { browser } = await remote;
      const context = browser.contexts()[0];
      page = await context.newPage();
      const cdp = await context.newCDPSession(page);
      const agent = await page.evaluate(() => navigator.userAgent);
      await cdp.send("Network.setUserAgentOverride", { userAgent: `${agent} ${process.env.ATS_USER_AGENT}` });
      return await render(page, url);
    } catch {
      return null;
    } finally {
      await page?.close().catch(() => {});
    }
  };
  return {
    async renderPage(url) {
      if (bb.browserbaseEnabled() && bb.readsDirectly(new URL(url).hostname)) return inCloud(url);
      let context;
      let rendered = null;
      try {
        context = await local.newContext({ userAgent: process.env.ATS_USER_AGENT, locale: "es-ES" });
        rendered = await render(await context.newPage(), url);
      } catch {
        rendered = null;
      } finally {
        await context?.close().catch(() => {});
      }
      if (rendered || !bb.browserbaseEnabled()) return rendered;
      const cloud = await inCloud(url);
      if (cloud) bb.noteReadThroughBrowser(new URL(url).hostname);
      return cloud;
    },
    async close() {
      await local.close();
      if (!remote) return;
      const { session, browser } = await remote.catch(() => ({}));
      await browser?.close().catch(() => {});
      if (session) await bb.releaseSession(session.id);
    },
  };
}

const snapshot = spain.readSiteSnapshot(readJson(values.data), { "software-engineer": readJson(values.tables) });
const careers = existsSync(values.careers) ? readJson(values.careers) : {};
for (const company of snapshot.companies) {
  if (careers[company.levelsSlug]) company.careers = careers[company.levelsSlug];
}
const boards = existsSync(values.boards) ? readJson(values.boards) : {};
const none = existsSync(values.none) ? readJson(values.none) : {};
// Weekly: a company with no board may have one by next Monday.
const RECHECK_DAYS = 7;
const today = new Date().toISOString().slice(0, 10);
const recent = (day) => day && (Date.parse(today) - Date.parse(day)) / 86_400_000 < RECHECK_DAYS;

let companies = snapshot.companies;
if (values.only) {
  const wanted = new Set(values.only.split(",").map((name) => name.trim().toLowerCase()));
  companies = companies.filter((company) => wanted.has(company.name.toLowerCase()) || wanted.has(company.levelsSlug));
} else if (!values.all) {
  companies = companies.filter((company) => !(company.levelsSlug in boards) && !recent(none[company.levelsSlug]));
}
if (values.limit) companies = companies.slice(0, Number.parseInt(values.limit, 10));

const previous = values.resume && existsSync(values.report) ? readJson(values.report) : null;
const reports = previous?.companies ?? [];
const done = new Set(reports.map((report) => report.name));

// Hosts known to refuse plain clients are read through the cloud browser at
// once; any other that refuses gets one more try there (lib/ats/sources/http.js),
// and the ones that answered it are added to the list at the end.
const bb = await import("../lib/ats/sources/browserbase.js");
const browserHosts = existsSync(values.browser) ? readJson(values.browser) : [];
bb.readDirectly(browserHosts);

const capturedAt = nowIso();
const deps = {
  resolve: (name, extra) => resolveBoards(name, extra),
  listJobs: (company) => adapterFor(company.ats).listJobs(company, capturedAt),
  ...(values["no-websites"] ? {} : { fetchPage }),
};
const browser = values.render && !values["no-websites"] ? await openBrowser() : null;
if (browser) deps.renderPage = browser.renderPage;

let index = 0;
for (const company of companies) {
  index += 1;
  if (done.has(company.name)) continue;
  // A board that pages through thousands of postings must not hold up the run.
  // The probe is abandoned, not cancelled, so its last requests may still finish.
  let timer;
  const report = await Promise.race([
    spain.probeCompany(company, snapshot.rules, deps),
    new Promise((resolve) => {
      timer = setTimeout(() => resolve({ name: company.name, candidates: [], kept: null, timedOut: true }), Number(values.timeout) * 1000);
    }),
  ]);
  clearTimeout(timer);
  reports.push(report);
  writeFileSync(values.report, `${JSON.stringify({ dataAsOf: snapshot.rules.dataAsOf, companies: reports }, null, 2)}\n`);
  const kept = report.timedOut ? "timed out, left as it was" : report.kept ? `${report.dormant ? "dormant" : "kept"} ${report.kept.ats}/${report.kept.board}` : "none";
  process.stderr.write(`[${index}/${companies.length}] ${company.name}: ${report.candidates.length} board(s), ${kept}\n`);
}

await browser?.close();

const preset = spain.assemblePreset(reports);
const slugOf = new Map(snapshot.companies.map((company) => [company.name, company.levelsSlug]));
const kept = new Map(preset.companies.map((entry) => [entry.name, entry]));
for (const report of reports) {
  const slug = slugOf.get(report.name);
  if (!slug || report.timedOut) continue;
  const entry = kept.get(report.name);
  if (!entry) {
    delete boards[slug];
    none[slug] = today;
    continue;
  }
  // A board another company already holds is theirs: Eventbrite's careers page
  // has led to Bending Spoons' since Bending Spoons bought it. A careers.json
  // entry marked `shared` takes it anyway: a subsidiary that posts on its
  // parent's board (Minsait on Indra's), its postings listed under both.
  const key = spain.boardKey({ ats: entry.ats, board: entry.board, region: entry.region ?? "global" });
  const shared = careers[slug]?.shared === true;
  const holder = !shared && Object.keys(boards).find((other) => other !== slug && spain.boardKey({ region: "global", ...boards[other] }) === key);
  if (holder) {
    delete boards[slug];
    none[slug] = today;
    continue;
  }
  delete none[slug];
  boards[slug] = { ats: entry.ats, board: entry.board, ...(entry.region ? { region: entry.region } : {}), ...(entry.query ? { query: entry.query } : {}), ...(entry.country ? { country: entry.country } : {}),
    ...(shared ? { shared: true } : {}), ...(careers[slug]?.title ? { title: careers[slug].title } : {}) };
}
// One company per line, sorted by slug, so the diff shows what changed.
const lines = Object.keys(boards)
  .sort()
  .map((slug) => `  ${JSON.stringify(slug)}: ${JSON.stringify(boards[slug])}`);
writeFileSync(values.boards, `{\n${lines.join(",\n")}\n}\n`);
const noneLines = Object.keys(none).sort().map((slug) => `  ${JSON.stringify(slug)}: ${JSON.stringify(none[slug])}`);
writeFileSync(values.none, `{\n${noneLines.join(",\n")}\n}\n`);
const learned = bb.learnedBrowserHosts();
if (learned.length) {
  writeFileSync(values.browser, `${JSON.stringify([...new Set([...browserHosts, ...learned])].sort(), null, 2)}\n`);
  process.stderr.write(`Hosts that needed the cloud browser, added to ${values.browser}: ${learned.join(", ")}\n`);
}
console.log(JSON.stringify({ dataAsOf: snapshot.rules.dataAsOf, probed: reports.length, boards: lines.length, ...spain.summarize(reports, preset) }, null, 2));
