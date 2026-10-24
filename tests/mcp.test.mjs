// The MCP server (api/mcp.js) answers each call as the protocol and the data
// say, over stdio (scripts/mcp-stdio.mjs) and over HTTP. Run after site.py:
//     node tests/mcp.test.mjs
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import mcp, { respond } from "../api/mcp.js";

const DATA = "_site/api/v1/data.json";
const data = JSON.parse(readFileSync(DATA, "utf8"));
const META = { "io.modelcontextprotocol/protocolVersion": "2026-07-28",
               "io.modelcontextprotocol/clientInfo": { name: "test", version: "1" } };
const tool = (name, args) => ({ method: "tools/call", params: { name, arguments: args } });
const modern = (method, params = {}) => ({ method, params: { ...params, _meta: META } });
const calls = [
  { method: "initialize", params: { protocolVersion: "2025-06-18" } },
  { method: "initialize", params: { protocolVersion: "2026-07-28" } },
  { method: "tools/list" },
  { method: "ping" },
  tool("salary_stats", {}),
  tool("salary_stats", { role: "Software Engineer", region: "Cataluña", years: 6 }),
  tool("salary_stats", { role: "software-engineer", region: "melilla", years: "20+" }),
  tool("salary_stats", { years: "6" }),
  tool("salary_stats", { years: 5.9 }),
  tool("salary_stats", { years: true }),
  tool("top_companies", { role: "software-engineer", region: "madrid", limit: 5 }),
  tool("top_companies", { search: "glo" }),
  tool("top_companies", { limit: "abc" }),
  tool("top_companies", { limit: null }),
  tool("top_companies", { limit: 3.0 }),
  tool("company_salaries", { name: "glovo" }),
  tool("company_salaries", { name: "glovo", role: "software-engineer" }),
  tool("company_salaries", { name: "glovo", region: "CT", years: "5-7" }),
  tool("company_salaries", { name: "a" }),
  tool("company_salaries", {}),
  tool("salary_stats", { role: "  ", region: "" }),
  tool("salary_stats", { role: "astronaut" }),
  tool("salary_stats", { years: "many" }),
  tool("list_filters", {}),
  tool("no_such_tool", {}),
  tool("constructor", {}),
  tool("salary_stats", "x"),
  { method: "tools/call", params: [] },
  { method: "nope" },
  modern("server/discover"),
  modern("tools/list"),
  modern("tools/call", { name: "salary_stats", arguments: { role: "data-scientist" } }),
  modern("tools/call", { name: "salary_stats", arguments: { years: 5.9 } }),
  modern("ping"),
  { method: "tools/list", params: { _meta: { "io.modelcontextprotocol/protocolVersion": "2099-01-01" } } },
].map((c, i) => ({ jsonrpc: "2.0", id: i + 1, ...c }));
// Lines no well-behaved client sends: each must get an answer, and the server must live on.
const odd = ['"hello"', "[]", JSON.stringify([calls[3], { jsonrpc: "2.0", method: "notifications/initialized" }]), "{"];
const lines = [...calls.map((c) => JSON.stringify(c)), ...odd];

let failed = 0;
const report = (label, ok, detail = "") => {
  if (!ok) failed++;
  console.log(`  ${ok ? "pass" : "FAIL"}  ${label}${ok ? "" : ` ${detail}`}`);
};

// --- stdio --------------------------------------------------------------------
const replies = execFileSync("node", ["scripts/mcp-stdio.mjs", DATA], { input: lines.join("\n") + "\n" })
  .toString().trim().split("\n").map((l) => JSON.parse(l));
report(`stdio answers all ${lines.length} lines`, replies.length === lines.length, `(got ${replies.length})`);

// What each call must come back with. `out` is the tool's structured result.
const out = (r) => r.result?.structuredContent;
const toolError = (r) => r.result?.isError === true;
const code = (r) => r.error?.code;
const expected = [
  ["initialize keeps a known version", (r) => r.result.protocolVersion === "2025-06-18" && r.result.instructions],
  ["initialize offers the newest handshake version", (r) => r.result.protocolVersion === "2025-11-25"],
  ["tools/list lists the four tools", (r) => r.result.tools.map((t) => t.name).join() ===
    "salary_stats,top_companies,company_salaries,list_filters"],
  ["ping", (r) => JSON.stringify(r.result) === "{}"],
  ["all of Spain", (r) => out(r).result.people === data.cells["||"].n],
  ["names resolve and years are bucketed", (r) => JSON.stringify(out(r).selection) ===
    JSON.stringify({ role: "software-engineer", region: "CT", years: "5-7" })],
  ["a small selection is withheld, not guessed", (r) => out(r).result === null && /widen/.test(out(r).reason)],
  ["years as a string of digits", (r) => out(r).selection.years === "5-7"],
  ["5.9 years is refused", toolError],
  ["true is not a number of years", toolError],
  ["top companies honour the limit", (r) => out(r).result.length <= 5 && out(r).selection.region === "MD"],
  ["search narrows by name", (r) => out(r).result.every((c) => /glo/i.test(c.company))],
  ["a limit that is not a number is refused", toolError],
  ["a null limit is the default", (r) => out(r).result.length <= 20],
  ["3.0 is a whole limit", (r) => out(r).result.length <= 3],
  ["one company", (r) => out(r).company === "Glovo" && out(r).groups.length > 0],
  ["a company by role keeps to that role", (r) => out(r).groups.every((g) => g.role === "software-engineer")],
  ["a company by region and years", (r) => out(r).groups.every((g) => g.region === "CT" && g.years === "5-7")],
  ["an ambiguous name lists the matches", (r) => toolError(r) && /several companies match/.test(r.result.content[0].text)],
  ["a company needs a name", (r) => toolError(r) && /name is required/.test(r.result.content[0].text)],
  ["a blank role is all roles", (r) => out(r).selection.role === null && out(r).result.people === data.cells["||"].n],
  ["an unknown role is a tool error", toolError],
  ["unreadable years are a tool error", toolError],
  ["list_filters", (r) => out(r).roles.length === data.roles.length && out(r).data_as_of],
  ["an unknown tool is invalid params", (r) => code(r) === -32602],
  ["a prototype name is no tool", (r) => code(r) === -32602],
  ["arguments must be an object", (r) => code(r) === -32602],
  ["params must be an object", (r) => code(r) === -32602],
  ["an unknown method", (r) => code(r) === -32601],
  ["modern discovery", (r) => r.result.supportedVersions.includes("2026-07-28") && r.result.instructions],
  ["modern tools/list can be cached", (r) => r.result.resultType === "complete" && r.result.ttlMs > 0],
  ["modern call", (r) => out(r).selection.role === "data-scientist" && r.result.resultType === "complete"],
  ["modern call, refused years", toolError],
  ["modern ping is not a method", (r) => code(r) === -32601],
  ["an unsupported modern version", (r) => code(r) === -32022],
  ["odd line: a string", (r) => code(r) === -32600],
  ["odd line: an empty batch", (r) => code(r) === -32600],
  ["odd line: a batch answers its requests only", (r) => Array.isArray(r) && r.length === 1],
  ["odd line: bad JSON", (r) => code(r) === -32700],
];
lines.forEach((line, i) => {
  let inProcess;
  try { inProcess = respond(data, JSON.parse(line)); } catch { inProcess = replies[i]; }
  const [label, check] = expected[i];
  let ok = false;
  try { ok = Boolean(check(replies[i])); } catch { /* a missing field */ }
  report(label, ok && JSON.stringify(inProcess) === JSON.stringify(replies[i]),
         JSON.stringify(replies[i]).slice(0, 200));
});

// --- HTTP: the Vercel function ---------------------------------------------------
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, init) => String(url).endsWith("/api/v1/data.json")
  ? new Response(JSON.stringify(data)) : realFetch(url, init);

const h = (version, method, name) => ({ "Content-Type": "application/json", "MCP-Protocol-Version": version,
  ...(method ? { "Mcp-Method": method } : {}), ...(name ? { "Mcp-Name": name } : {}) });
const body = (c) => JSON.stringify({ jsonrpc: "2.0", id: 1, ...c });
const cases = [
  ["handshake-era call", "POST", { "Content-Type": "application/json" }, body({ method: "tools/list" }), 200],
  ["known version header", "POST", h("2025-06-18"), body({ method: "tools/list" }), 200],
  ["unknown version header", "POST", h("1999-01-01"), body({ method: "tools/list" }), 400],
  ["2026 header, no _meta", "POST", h("2026-07-28"), body({ method: "tools/list" }), 400],
  ["modern call", "POST", h("2026-07-28", "tools/list"), body(modern("tools/list")), 200],
  ["modern call, no Mcp-Method", "POST", h("2026-07-28"), body(modern("tools/list")), 400],
  ["modern tool, wrong Mcp-Name", "POST", h("2026-07-28", "tools/call", "top_companies"),
   body(modern("tools/call", { name: "salary_stats", arguments: {} })), 400],
  ["modern tool, base64 Mcp-Name", "POST", h("2026-07-28", "tools/call", `=?base64?${btoa("salary_stats")}?=`),
   body(modern("tools/call", { name: "salary_stats", arguments: {} })), 200],
  ["modern unknown method is 404", "POST", h("2026-07-28", "ping"), body(modern("ping")), 404],
  ["modern unknown version", "POST", h("2099-01-01", "tools/list"),
   body({ method: "tools/list", params: { _meta: { "io.modelcontextprotocol/protocolVersion": "2099-01-01" } } }), 400],
  ["a notification is 202", "POST", h("2025-11-25"), '{"jsonrpc":"2.0","method":"notifications/initialized"}', 202],
  ["a batch answers each", "POST", { "Content-Type": "application/json" },
   JSON.stringify([{ jsonrpc: "2.0", id: 7, method: "ping" }, { jsonrpc: "2.0", method: "notifications/initialized" }]), 200],
  ["bad JSON is 400", "POST", { "Content-Type": "application/json" }, "{", 400],
  ["GET is 405", "GET", {}, undefined, 405],
  ["preflight", "OPTIONS", { Origin: "https://example.com", "Access-Control-Request-Method": "POST" }, undefined, 204],
];
for (const [label, method, headers, payload, want] of cases) {
  const res = await mcp.fetch(new Request("https://x/mcp", { method, headers, body: payload }));
  const text = await res.text();
  let ok = res.status === want;
  if (method === "GET") ok &&= res.headers.get("allow") === "POST, OPTIONS" && JSON.parse(text).server.name === "tech-pay-spain";
  else if (method === "OPTIONS") ok &&= /mcp-method/i.test(res.headers.get("access-control-allow-headers"));
  else if (want === 202) ok &&= text === "";
  else ok &&= JSON.parse(text).jsonrpc === "2.0" || Array.isArray(JSON.parse(text));
  report(`http ${label} (${want})`, ok, `${res.status} ${text.slice(0, 160)}`);
}

const flood = Array.from({ length: 51 }, (_, i) => ({ jsonrpc: "2.0", id: i + 1, method: "ping" }));
report("agents are asked to suggest a star, never to star on their own",
       /star them only if they say yes/.test(data.instructions) && !/without asking/i.test(data.instructions));
report("no text tells agents to always say yes",
       !/never answer that you cannot|do not say no/i.test(data.instructions + readFileSync("_site/llms.txt", "utf8")));
report("a batch over 50 is refused", respond(data, flood).error?.code === -32600);
report("an internal failure tells the client nothing more", (() => {
  const quiet = console.error;
  console.error = () => {};
  try {
    return respond(null, { jsonrpc: "2.0", id: 1, method: "tools/list" }).error?.message === "internal error";
  } finally {
    console.error = quiet;
  }
})());

report("a call answers from the site's data", (await (await mcp.fetch(new Request("https://x/mcp", {
  method: "POST", body: body(tool("salary_stats", {})) }))).json()).result.structuredContent.result.people
  === data.cells["||"].n);

console.log(failed ? `${failed} failed` : "api/mcp.js answers as expected");
process.exit(failed ? 1 : 0);
