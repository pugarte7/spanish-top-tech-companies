// /star and /star/<via> (rewrites in vercel.json): the link the MCP's star ask
// carries (api/mcp.js STAR_LINK), so a click is counted before GitHub takes
// over. A star came from one in ten visitors of the repo page, but GitHub's
// traffic names only the site a visitor came from, and a link an agent shows
// has none: whether a note was ever followed was unknown. Counts the click and
// where the link was shown (`star_link`, `via`), like every server-side event:
// no cookie, no IP. The legal page says so.
import { after, capture, event, origin } from "./_track.js";

const REPO = "https://github.com/pugarte7/spanish-top-tech-companies";
// mcp-search and mcp-sent were the notes on find_jobs and report_application
// (2026-11-14 to 2026-11-18); mcp-weekly is application_guide's weekly ask.
const VIA = ["mcp-search", "mcp-sent", "mcp-weekly"];
// Link previews, crawlers and scripts fetch the link without anyone opening it.
const NOT_A_PERSON = /bot|crawl|spider|preview|slack|whatsapp|telegram|discord|facebookexternalhit|curl|python|node|go-http|undici|axios/i;

export default {
  async fetch(request) {
    const given = new URL(request.url).searchParams.get("via") ?? "";
    const headers = Object.fromEntries(request.headers);
    const agent = String(headers["user-agent"] ?? "");
    if (request.method === "GET" && agent && !NOT_A_PERSON.test(agent))
      await after(capture([event("star_link", { ...origin(headers), via: VIA.includes(given) ? given : "other" })]));
    return new Response(null, { status: 302, headers: { Location: REPO, "Cache-Control": "no-store" } });
  },
};
