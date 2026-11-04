// autoapply-mcp was archived on 2026-11-04; this endpoint stays so copies
// already installed keep working. Nothing in this repo calls it.
// Vercel Function: /api/v1/telemetry (vercel.json rewrites it here). autoapply-mcp
// posts anonymous technical usage data here unless the person running it said no:
// which tool ran, whether it worked, how long it took, an error code, versions,
// the operating system and the MCP client (autoapply-mcp src/telemetry.ts). The
// id is random per run and never stored on their machine.
//
// Only the fields below pass, each checked against what autoapply sends, and
// anything else in the request is dropped; free text never gets through except
// an unexpected exception's message, redacted again here. Like the rest of
// api/_track.js: no IP, no person profile, the country from Vercel's header.

import { after, capture, cut, event, origin, redact } from "./_track.js";

const MAX_BYTES = 16_384;
const MAX_EVENTS = 20;
const SESSION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NAME = /^[a-z][a-z0-9_]{0,63}$/;
const CODE = /^[A-Za-z][A-Za-z0-9_.-]{0,63}$/;
const VERSION = /^[0-9A-Za-z.+-]{1,32}$/;
const PLATFORM = /^[a-z0-9_]{1,16}$/;
const ISSUE = /^[a-z0-9_-]{1,24}:[A-Za-z0-9_.-]{1,40}$/;

const matching = (pattern) => (v) => (typeof v === "string" && pattern.test(v) ? v : undefined);
const count = (v) => (Number.isInteger(v) && v >= 0 && v <= 1_000_000 ? v : undefined);

const FIELDS = {
  tool: matching(NAME),
  ok: (v) => (typeof v === "boolean" ? v : undefined),
  duration_ms: (v) => (typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 86_400_000 ? Math.round(v) : undefined),
  error_code: matching(CODE),
  error_message: (v) => (typeof v === "string" && v ? redact(v, 200) : undefined),
  version: matching(VERSION),
  node: matching(VERSION),
  os: matching(PLATFORM),
  arch: matching(PLATFORM),
  client: (v) => (typeof v === "string" && v ? redact(v, 64) : undefined),
  client_version: matching(VERSION),
  boards: count,
  boards_failed: count,
  postings: count,
  accepted: count,
  board_issues: (v) => {
    if (!v || typeof v !== "object" || Array.isArray(v)) return undefined;
    const kept = Object.entries(v).filter(([k, n]) => ISSUE.test(k) && count(n) !== undefined).slice(0, 20);
    return kept.length ? Object.fromEntries(kept) : undefined;
  },
};

// The PostHog events a request body becomes: the ones autoapply could have sent,
// with only the fields it sends.
export function clean(body, headers) {
  const events = Array.isArray(body?.events) ? body.events.slice(0, MAX_EVENTS) : [];
  return events
    .filter((e) => e?.event === "autoapply_tool" && SESSION_ID.test(e.session_id ?? "") && e.properties
      && typeof e.properties === "object" && FIELDS.tool(e.properties.tool))
    .map((e) => event("autoapply_tool", {
      ...Object.fromEntries(Object.entries(FIELDS).map(([k, check]) => [k, check(e.properties[k])])),
      user_agent: cut(headers["user-agent"], 128),
      ...origin(headers),
    }, e.session_id.toLowerCase()));
}

export default {
  async fetch(request) {
    if (request.method !== "POST") {
      return new Response(null, { status: 405, headers: { Allow: "POST" } });
    }
    const text = await request.text();
    if (text.length > MAX_BYTES) return new Response(null, { status: 413 });
    let body;
    try {
      body = JSON.parse(text);
    } catch {
      return new Response(null, { status: 400 });
    }
    const events = clean(body, Object.fromEntries(request.headers));
    await after(capture(events));
    return new Response(null, { status: events.length ? 204 : 400 });
  },
};
