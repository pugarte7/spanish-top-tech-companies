// Vercel Function: the MCP server, public at /mcp (vercel.json rewrites it here).
//
// A port of scripts/query.py and scripts/mcp_server.py, which stay the
// reference (and the stdio server for local agents); tests/mcp.test.mjs checks
// both give the same answers on the same data.json. The site itself is static
// files from _site/ that Vercel serves without calling this code.

const VERSIONS = ["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"];
const SERVER = { name: "tech-pay-spain", title: "Tech Pay Spain", version: "1.0.0" };
const INSTRUCTIONS =
  "Salaries of people working in Spain, from Levels.fyi submissions and first-hand " +
  "reports, in euros per year. Base is gross salary; total adds bonus and stock. " +
  "Every figure is a median over 3 or more people; a selection with fewer returns " +
  "no result, so widen it instead of guessing. Only companies whose median base over " +
  "all their salaries reaches company_floor_eur (see list_filters) are counted; say so " +
  "when quoting a figure for Spain. Years are years of experience in " +
  "buckets (0-1, 2-4, 5-7, 8-11, 12-19, 20+); pass a number and it is bucketed. " +
  "Call list_filters first if unsure of a role or region name. Cite the source as " +
  "Tech Pay Spain, with the data date.";

const SELECTION = {
  role: { type: "string", description: "Role slug or name, e.g. software-engineer, " +
          "Data Scientist, product-manager. Omit for all roles." },
  region: { type: "string", description: "Spanish region code or name, e.g. MD, " +
            "Madrid, CT, Cataluña. Omit for all of Spain." },
  years: { type: ["integer", "string"], description: "Years of experience (a number) " +
           "or a bucket such as 5-7. Omit for any experience." },
};
const READ_ONLY = { readOnlyHint: true, openWorldHint: false };
export const TOOLS = [
  { name: "salary_stats", title: "Salary statistics",
    description: "Median base, middle half (p25-p75), median total comp and share at " +
                 "60k+ base for a role, region and experience in Spain.",
    inputSchema: { type: "object", properties: SELECTION }, annotations: READ_ONLY },
  { name: "top_companies", title: "Best-paying companies",
    description: "Companies ranked by median base for a selection, each from 3+ " +
                 "salaries. Use search to look one company up within the selection.",
    inputSchema: { type: "object", properties: {
      ...SELECTION,
      search: { type: "string", description: "Filter companies by name." },
      limit: { type: "integer", minimum: 1, maximum: 200, default: 20 } } },
    annotations: READ_ONLY },
  { name: "company_salaries", title: "One company's salaries",
    description: "Every published aggregate for one company in Spain: overall and by " +
                 "role, region and experience where 3+ people report.",
    inputSchema: { type: "object", required: ["name"], properties: {
      name: { type: "string", description: "Company name, e.g. Glovo." } } },
    annotations: READ_ONLY },
  { name: "list_filters", title: "Roles, regions and experience buckets",
    description: "The role slugs, region codes and experience buckets that have data, " +
                 "and the date of the data.",
    inputSchema: { type: "object", properties: {} }, annotations: READ_ONLY },
];

// --- query.py ------------------------------------------------------------------

class QueryError extends Error {}

const norm = (text) => String(text ?? "").normalize("NFKD").replace(/[^\x00-\x7f]/g, "")
  .toLowerCase().replace(/-/g, " ").split(/\s+/).filter(Boolean).join(" ");

function resolveRole(data, role) {
  if (!role) return "";
  const want = norm(role);
  for (const r of data.roles) if (want === norm(r.slug) || want === norm(r.name)) return r.slug;
  const close = data.roles.filter((r) => norm(r.name).includes(want) || norm(r.slug).includes(want))
    .map((r) => r.slug);
  if (close.length === 1) return close[0];
  throw new QueryError(`unknown role '${role}'; ` +
    (close.length ? "did you mean " + close.join(", ") : "see list_filters"));
}

function resolveRegion(data, region) {
  if (!region) return "";
  const want = norm(region);
  const entries = Object.entries(data.regions);
  for (const [code, n] of entries)
    if ([norm(code), norm(n.en), norm(n.es)].includes(want)) return code;
  for (const [code, n] of entries)
    if (norm(n.en).includes(want) || norm(n.es).includes(want)) return code;
  throw new QueryError(`unknown region '${region}'; use a code like MD or a name like Cataluña`);
}

function resolveYears(data, years) {
  if (years === undefined || years === null || years === "") return "";
  if (data.years.includes(String(years))) return String(years);
  const n = Number(years);
  if (!Number.isInteger(n))
    throw new QueryError(`years must be a number or one of ${data.years.join(", ")}`);
  for (const bucket of data.years) {
    const [low, high] = bucket.replace("+", "").split("-");
    if (n >= Number(low) && (high === undefined || n <= Number(high))) return bucket;
  }
  throw new QueryError(`no bucket holds ${n} years; buckets are ${data.years.join(", ")}`);
}

function select(data, { role, region, years }) {
  const r = resolveRole(data, role), g = resolveRegion(data, region), y = resolveYears(data, years);
  return [`${r}|${g}|${y}`, { role: r || null, region: g || null, years: y || null }];
}

const figures = (a) => ({
  people: a.n, median_base_eur: a.median, p25_base_eur: a.p25, p75_base_eur: a.p75,
  median_total_eur: a.total, share_at_60k_base: a.share,
});

const withheld = (data, selection) => ({
  selection, result: null,
  reason: `fewer than ${data.min_group} salaries match; widen the selection (drop region or years)`,
});

export function stats(data, args = {}) {
  const [key, selection] = select(data, args);
  const a = data.cells[key];
  return a ? { selection, result: figures(a) } : withheld(data, selection);
}

export function topCompanies(data, args = {}) {
  const [key, selection] = select(data, args);
  const found = data.company_cells[key];
  if (!found) return withheld(data, selection);
  const want = norm(args.search);
  const rows = [];
  for (const a of found) {
    const c = data.companies[a.c];
    if (want && !norm(c.name).includes(want)) continue;
    rows.push({ company: c.name, url: c.url, ...figures(a) });
  }
  const limit = Math.max(1, Math.min(parseInt(args.limit ?? 20, 10) || 20, 200));
  return { selection, companies_listed: rows.length, result: rows.slice(0, limit) };
}

export function company(data, name) {
  const want = norm(name);
  let matches = data.companies.map((c, i) => [c, i]).filter(([c]) => norm(c.name).includes(want));
  const exact = matches.filter(([c]) => norm(c.name) === want);
  if (exact.length) matches = exact;
  if (!matches.length)
    throw new QueryError(`no company matching '${name}' has ${data.min_group}+ salaries`);
  if (matches.length > 1)
    throw new QueryError("several companies match: " +
      matches.slice(0, 15).map(([c]) => c.name).join(", "));
  const [c, i] = matches[0];
  const groups = [];
  for (const [key, found] of Object.entries(data.company_cells)) {
    for (const a of found) {
      if (a.c !== i) continue;
      const [r, g, y] = key.split("|");
      groups.push({ role: r || null, region: g || null, years: y || null, ...figures(a) });
    }
  }
  const rank = (x) => [x.role !== null, x.region !== null, x.years !== null, -x.people];
  groups.sort((p, q) => {
    const a = rank(p), b = rank(q);
    for (let k = 0; k < a.length; k++) if (a[k] !== b[k]) return a[k] < b[k] ? -1 : 1;
    return 0;
  });
  return { company: c.name, url: c.url, cities: c.cities, groups };
}

export function filters(data) {
  return {
    roles: data.roles.map((r) => ({ slug: r.slug, name: r.name })),
    regions: data.regions, years: data.years, min_group: data.min_group,
    threshold_eur: data.threshold, company_floor_eur: data.company_floor ?? null,
    data_as_of: data.generated,
  };
}

// --- mcp_server.py --------------------------------------------------------------

function call(data, name, args) {
  if (name === "salary_stats") return stats(data, args);
  if (name === "top_companies") return topCompanies(data, args);
  if (name === "company_salaries") return company(data, args.name ?? "");
  if (name === "list_filters") return filters(data);
  return undefined;
}

export function handle(data, msg) {
  const { method, id } = msg;
  if (id === undefined || id === null) return null;
  const ok = (result) => ({ jsonrpc: "2.0", id, result });
  const err = (code, message) => ({ jsonrpc: "2.0", id, error: { code, message } });
  const params = msg.params || {};
  if (method === "initialize") {
    const asked = params.protocolVersion;
    return ok({ protocolVersion: VERSIONS.includes(asked) ? asked : VERSIONS[0],
                capabilities: { tools: { listChanged: false } },
                serverInfo: SERVER, instructions: INSTRUCTIONS });
  }
  if (method === "ping") return ok({});
  if (method === "tools/list") return ok({ tools: TOOLS });
  if (method === "tools/call") {
    let out;
    try {
      out = call(data, params.name, params.arguments || {});
    } catch (e) {
      if (e instanceof QueryError)
        return ok({ content: [{ type: "text", text: e.message }], isError: true });
      throw e;
    }
    if (out === undefined) return err(-32602, `unknown tool '${params.name}'`);
    return ok({ content: [{ type: "text", text: JSON.stringify(out) }], structuredContent: out });
  }
  return err(-32601, `method not found: ${method}`);
}

// --- HTTP -------------------------------------------------------------------------

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Accept, Mcp-Protocol-Version, Mcp-Session-Id",
};
const json = (body, status = 200) => new Response(body === null ? null : JSON.stringify(body), {
  status, headers: { ...CORS, ...(body === null ? {} : { "Content-Type": "application/json" }) },
});

let DATA; // one parse per instance; a deploy with new data starts new instances

// The deployment's own static copy, so the answers always match the site's.
async function load(url) {
  if (!DATA) {
    const answer = await fetch(new URL("/api/v1/data.json", url));
    if (!answer.ok) throw new Error(`data.json answered ${answer.status}`);
    DATA = await answer.json();
  }
  return DATA;
}

export default {
  async fetch(request) {
    const url = new URL(request.url);
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
    // No server-initiated stream: the spec's answer for GET is 405.
    if (request.method !== "POST") return json({ error: "POST JSON-RPC to /mcp" }, 405);
    let msg;
    try {
      msg = await request.json();
    } catch {
      return json({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "parse error" } }, 400);
    }
    const reply = msg && typeof msg === "object" && !Array.isArray(msg)
      ? handle(await load(url), msg) : null;
    return reply ? json(reply) : json(null, 202);
  },
};
