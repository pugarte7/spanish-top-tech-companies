// api/mcp.js and scripts/mcp_server.py must answer alike, over stdio and over
// HTTP, for both eras of the protocol. Run after site.py:
//     node tests/mcp.test.mjs
import { execFileSync, spawn } from "node:child_process";
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
  tool("salary_stats", { role: "astronaut" }),
  tool("salary_stats", { years: "many" }),
  tool("list_filters", {}),
  tool("no_such_tool", {}),
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

// Text content is the JSON of structuredContent; compare it parsed, not as spacing.
const canon = (r) => {
  for (const one of [r].flat()) {
    for (const c of one?.result?.content ?? []) {
      try { c.text = JSON.parse(c.text); } catch { /* an error message */ }
    }
  }
  return JSON.stringify(r);
};
let failed = 0;
const report = (label, ok, detail = "") => {
  if (!ok) failed++;
  console.log(`  ${ok ? "pass" : "FAIL"}  ${label}${ok ? "" : ` ${detail}`}`);
};

const py = execFileSync("python3", ["scripts/mcp_server.py", "--data", DATA], { input: lines.join("\n") + "\n" })
  .toString().trim().split("\n").map((l) => JSON.parse(l));
report(`stdio answers all ${lines.length} lines`, py.length === lines.length, `(got ${py.length})`);
lines.forEach((line, i) => {
  let js;
  try { js = respond(data, JSON.parse(line)); } catch { js = { jsonrpc: "2.0", id: null, error: { code: -32700, message: "parse error" } }; }
  const label = i < calls.length ? `stdio ${calls[i].method} ${calls[i].params?.name ?? ""}` : `stdio odd line ${line.slice(0, 24)}`;
  report(label, canon(js) === canon(py[i]), `\n      js ${canon(js).slice(0, 200)}\n      py ${canon(py[i]).slice(0, 200)}`);
});

// --- HTTP: the Vercel function against `mcp_server.py --http` -----------------------
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, init) => String(url).endsWith("/api/v1/data.json")
  ? new Response(JSON.stringify(data)) : realFetch(url, init);
const port = 20000 + Math.floor(Math.random() * 30000);
const server = spawn("python3", ["scripts/mcp_server.py", "--http", "--port", String(port), "--data", DATA]);
await new Promise((ok, fail) => {
  server.stderr.on("data", (d) => String(d).includes("MCP on") && ok());
  server.on("exit", (code) => fail(new Error(`mcp_server.py --http exited ${code}`)));
});

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
  const js = await mcp.fetch(new Request("https://x/mcp", { method, headers, body: payload }));
  const pyr = await realFetch(`http://127.0.0.1:${port}/mcp`, { method, headers, body: payload });
  const [jt, pt] = [await js.text(), await pyr.text()];
  let same = js.status === want && pyr.status === want;
  if (method === "GET") {
    same &&= js.headers.get("allow") === "POST, OPTIONS" && pyr.headers.get("allow") === "POST, OPTIONS"
      && JSON.parse(jt).server.name === JSON.parse(pt).server.name;
  } else if (method === "OPTIONS") {
    same &&= /mcp-method/i.test(js.headers.get("access-control-allow-headers"))
      && js.headers.get("access-control-allow-headers") === pyr.headers.get("access-control-allow-headers");
  } else {
    same &&= (jt === "" && pt === "") || canon(JSON.parse(jt)) === canon(JSON.parse(pt));
  }
  report(`http ${label} (${want})`, same, `\n      js ${js.status} ${jt.slice(0, 160)}\n      py ${pyr.status} ${pt.slice(0, 160)}`);
}
server.kill();

const modernList = await (await mcp.fetch(new Request("https://x/mcp", { method: "POST",
  headers: h("2026-07-28", "tools/list"), body: body(modern("tools/list")) }))).json();
report("a modern result says it is complete and how long to cache",
       modernList.result.resultType === "complete" && modernList.result.ttlMs > 0);
report("a call answers from the site's data", (await (await mcp.fetch(new Request("https://x/mcp", {
  method: "POST", body: body(tool("salary_stats", {})) }))).json()).result.structuredContent.result.people
  === data.cells["||"].n);

console.log(failed ? `${failed} failed` : "api/mcp.js matches mcp_server.py");
process.exit(failed ? 1 : 0);
