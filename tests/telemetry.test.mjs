// What autoapply-mcp reports reaches PostHog with only the fields it may carry:
// api/telemetry.js (technical data the person allowed) and api/boards.js (the
// Spain list download). No network: fetch is replaced, and PostHog's batch
// endpoint only records what would have been sent.
//     node tests/telemetry.test.mjs

process.env.VERCEL_ENV = "production"; // _track.js only sends in production
const posted = [];
globalThis.fetch = async (url, init) => {
  const href = String(url);
  if (href.endsWith("/batch/")) {
    posted.push(...JSON.parse(init.body).batch);
    return new Response("{}");
  }
  if (href.endsWith("/api/v1/boards-list.json")) return new Response('{"companies":[]}');
  throw new Error(`unexpected fetch ${href}`);
};
const { clean, default: telemetry } = await import("../api/telemetry.js");
const { default: boards } = await import("../api/boards.js");

let failed = 0;
const report = (label, ok, detail = "") => {
  if (!ok) failed++;
  console.log(`  ${ok ? "pass" : "FAIL"}  ${label}${ok ? "" : ` ${JSON.stringify(detail)}`}`);
};

const ID = "0f8fad5b-d9cb-469f-a165-70867728950e";
const HEADERS = { "user-agent": "autoapply-mcp/0.3.4 (+https://github.com/pugarte7/autoapply-mcp)", "x-vercel-ip-country": "ES" };
const sent = (properties, extra = {}) => ({ event: "autoapply_tool", install_id: ID, properties, ...extra });
const post = (body, headers = HEADERS) => telemetry.fetch(new Request("https://x.test/api/telemetry", {
  method: "POST", headers, body: typeof body === "string" ? body : JSON.stringify(body),
}));

console.log("telemetry");
{
  const [e] = clean({ events: [sent({
    tool: "discover_jobs", ok: false, duration_ms: 1234.6, error_code: "TypeError",
    error_message: "fetch failed for alex@example.com token=abc123", version: "0.3.4", node: "22.5.1",
    os: "darwin", arch: "arm64", client: "claude-code", client_version: "2.1.0",
    boards: 89, boards_failed: 2, postings: 1200, accepted: 40,
    board_issues: { "greenhouse:not_found": 2, "Bad Key": 3, "lever:http_500": -1 },
    cv: "Alex Candidate, 10 years", email: "alex@example.com",
  })] }, HEADERS);
  report("keeps the technical fields", e?.event === "autoapply_tool" && e.distinct_id === ID
    && e.properties.tool === "discover_jobs" && e.properties.ok === false && e.properties.duration_ms === 1235
    && e.properties.os === "darwin" && e.properties.client === "claude-code" && e.properties.boards === 89, e);
  report("drops every field autoapply does not send", !("cv" in e.properties) && !("email" in e.properties), e.properties);
  report("redacts an error message again", e.properties.error_message === "fetch failed for [redacted] token=[redacted]",
    e.properties.error_message);
  report("board issues keep only ATS:code counts", JSON.stringify(e.properties.board_issues) === '{"greenhouse:not_found":2}',
    e.properties.board_issues);
  report("no IP, no person, the country from Vercel", e.properties.$process_person_profile === false
    && e.properties.$geoip_disable === true && e.properties.$geoip_country_code === "ES", e.properties);
}
{
  const events = clean({ events: [
    sent({ tool: "list_queue", ok: true }),
    sent({ tool: "list_queue" }, { event: "$pageview" }),
    sent({ tool: "list_queue" }, { install_id: "alex@example.com" }),
    sent({ tool: "Drop Table" }),
    sent(null),
    ...Array.from({ length: 30 }, () => sent({ tool: "list_queue" })),
  ] }, HEADERS);
  report("refuses other events, ids and tool names, at most 20 a request", events.length === 16, events.length);
}
{
  const before = posted.length;
  const accepted = await post({ events: [sent({ tool: "list_queue", ok: true, version: "0.3.4" })] });
  report("a valid batch answers 204 and reaches PostHog", accepted.status === 204 && posted.length === before + 1
    && posted.at(-1).properties.tool === "list_queue", accepted.status);
  report("nothing valid answers 400", (await post({ events: [] })).status === 400);
  report("broken JSON answers 400", (await post("{")).status === 400);
  report("an oversized body answers 413", (await post("x".repeat(20_000))).status === 413);
  report("GET answers 405", (await telemetry.fetch(new Request("https://x.test/api/telemetry"))).status === 405);
}

console.log("boards download");
for (const [query, expected] of [["?run=setup", "setup"], ["?run=refresh", "refresh"], ["?run=alex", undefined], ["", undefined]]) {
  const before = posted.length;
  const answer = await boards.fetch(new Request(`https://x.test/api/boards${query}`, { headers: HEADERS }));
  const e = posted.at(-1);
  report(`run ${query || "(none)"} is counted as ${expected}`, answer.status === 200 && posted.length === before + 1
    && e.event === "boards_download" && e.properties.run === expected && e.properties.autoapply_version === "0.3.4", e?.properties);
}

process.exit(failed ? 1 : 0);
