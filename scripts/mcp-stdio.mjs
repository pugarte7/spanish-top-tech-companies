#!/usr/bin/env node
// The MCP server over stdio, for agents that start it themselves:
//
//     node scripts/mcp-stdio.mjs                      # _site/ if built, else the live site
//     node scripts/mcp-stdio.mjs path/or/url/of/data.json
//
// The same code as the public /mcp (api/mcp.js), so local and hosted agents get
// the same answers. Node 22 or newer, no dependencies.
import { existsSync, readFileSync } from "node:fs";
import { createInterface } from "node:readline";
import { respond } from "../api/mcp.js";

const BUILT = new URL("../_site/api/v1/data.json", import.meta.url);
const source = process.argv[2] ?? process.env.TECH_PAY_DATA
  ?? (existsSync(BUILT) ? BUILT : "https://spanishtoptechcompanies.com/api/v1/data.json");

const data = /^https?:/.test(String(source))
  ? await (await fetch(source)).json()
  : JSON.parse(readFileSync(source, "utf8"));

for await (const line of createInterface({ input: process.stdin })) {
  if (!line.trim()) continue;
  let reply;
  try {
    reply = respond(data, JSON.parse(line));
  } catch {
    reply = { jsonrpc: "2.0", id: null, error: { code: -32700, message: "parse error" } };
  }
  if (reply) process.stdout.write(JSON.stringify(reply) + "\n");
}
