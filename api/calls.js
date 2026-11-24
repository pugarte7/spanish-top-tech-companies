// How many times agents have called the MCP's tools, for the home page's first
// figure: PostHog's count of `$mcp_tool_call` (api/mcp.js sends one per call)
// since the server went up, without the site's own and the maintainer's calls
// (`internal`). Reading PostHog means no counter of our own to run; an event
// takes up to a minute to reach it, so this is the real total a moment ago.
//
// The page asks once a minute. The CDN keeps an answer 30 s and serves it while
// it fetches the next, so PostHog is asked at most twice a minute per region
// however many readers there are. `refresh: force_blocking` matters: without it
// PostHog answers from its own cache and the count stands still for hours.
//
// It needs POSTHOG_PERSONAL_API_KEY on the deployment, a personal key with the
// `query:read` scope on this project only. Without it, or when PostHog fails or
// its hourly budget runs out, the answer is { calls: null } and the page keeps
// the figure it has, or leaves it out.
const HOST = "https://eu.posthog.com", PROJECT = 331969;
const QUERY = "SELECT count() FROM events WHERE event = '$mcp_tool_call' " +
              "AND timestamp >= toDateTime('2026-11-01 00:00:00') " +
              "AND ifNull(toString(properties.internal), '') != 'true'";

export default {
  async fetch() {
    // 200 with no count: an error status would put a failed request in every reader's console.
    const none = () => Response.json({ calls: null }, { headers: { "Cache-Control": "no-store" } });
    const key = process.env.POSTHOG_PERSONAL_API_KEY;
    if (!key) return none();
    try {
      const r = await fetch(`${HOST}/api/projects/${PROJECT}/query/`, {
        method: "POST",
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify({ query: { kind: "HogQLQuery", query: QUERY }, refresh: "force_blocking", name: "mcp calls total" }),
        signal: AbortSignal.timeout(8000),
      });
      if (!r.ok) throw new Error(`PostHog answered ${r.status}`);
      const calls = (await r.json()).results?.[0]?.[0];
      if (!Number.isInteger(calls)) throw new Error("no count");
      return Response.json({ calls }, {
        headers: { "Cache-Control": "public, max-age=30, s-maxage=30, stale-while-revalidate=600" },
      });
    } catch (e) {
      console.error("calls:", e?.message ?? e);
      return none();
    }
  },
};
