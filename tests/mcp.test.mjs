// api/mcp.js and scripts/mcp_server.py must answer alike. Run after site.py:
//     node tests/mcp.test.mjs
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import mcp, { handle } from "../api/mcp.js";

const DATA = "_site/api/v1/data.json";
const data = JSON.parse(readFileSync(DATA, "utf8"));
const calls = [
  { method: "initialize", params: { protocolVersion: "2025-06-18" } },
  { method: "tools/list" },
  ["salary_stats", {}],
  ["salary_stats", { role: "Software Engineer", region: "Cataluña", years: 6 }],
  ["salary_stats", { role: "software-engineer", region: "melilla", years: "20+" }],
  ["top_companies", { role: "software-engineer", region: "madrid", limit: 5 }],
  ["top_companies", { search: "glo" }],
  ["company_salaries", { name: "glovo" }],
  ["company_salaries", { name: "a" }],
  ["salary_stats", { role: "astronaut" }],
  ["salary_stats", { years: "many" }],
  ["list_filters", {}],
  ["no_such_tool", {}],
  { method: "nope" },
].map((c, i) => ({ jsonrpc: "2.0", id: i + 1,
  ...(Array.isArray(c) ? { method: "tools/call", params: { name: c[0], arguments: c[1] } } : c) }));

const py = execFileSync("python3", ["scripts/mcp_server.py", "--data", DATA],
  { input: calls.map((c) => JSON.stringify(c)).join("\n") + "\n" })
  .toString().trim().split("\n").map((l) => JSON.parse(l));

// Text content is the JSON of structuredContent; compare it parsed, not as spacing.
const canon = (r) => {
  for (const c of r.result?.content ?? []) {
    try { c.text = JSON.parse(c.text); } catch { /* an error message */ }
  }
  return JSON.stringify(r);
};
let failed = 0;
calls.forEach((c, i) => {
  const same = canon(handle(data, c)) === canon(py[i]);
  if (!same) failed++;
  console.log(`  ${same ? "pass" : "FAIL"}  ${c.method} ${c.params?.name ?? ""}`);
});

globalThis.fetch = async () => new Response(JSON.stringify(data));
const post = (body) => mcp.fetch(new Request("https://x/mcp", { method: "POST", body }));
const checks = [
  ["GET /mcp is 405", (await mcp.fetch(new Request("https://x/mcp"))).status, 405],
  ["a notification is 202", (await post('{"jsonrpc":"2.0","method":"notifications/initialized"}')).status, 202],
  ["bad JSON is 400", (await post("{")).status, 400],
  ["a call answers", (await (await post(JSON.stringify(calls[2]))).json()).result.structuredContent.result.people,
   data.cells["||"].n],
];
for (const [label, got, want] of checks) {
  if (got !== want) failed++;
  console.log(`  ${got === want ? "pass" : "FAIL"}  ${label}${got === want ? "" : ` (got ${got}, want ${want})`}`);
}
console.log(failed ? `${failed} failed` : "api/mcp.js matches mcp_server.py");
process.exit(failed ? 1 : 0);
