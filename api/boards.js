// autoapply-mcp was archived on 2026-11-04; this endpoint stays so copies
// already installed keep working. Nothing in this repo calls it.
// Vercel Function: /api/v1/boards.json (vercel.json rewrites it here), the list
// autoapply-mcp's load_preset spain downloads. The list itself is the static
// /api/v1/boards-list.json that scripts/site.py writes; this serves it and counts
// the download, the one signal of autoapply-mcp being used, since it runs on each
// person's machine and sends nothing else unless the person allows technical data
// (api/telemetry.js). The version comes from its User-Agent: "autoapply-mcp/0.1"
// is every release up to 0.3.2, which all said 0.1. From 0.3.4 `?run=` says
// whether it is a first setup or the daily refresh: installs and installs in use.

import { after, capture, cut, event, origin } from "./_track.js";

const CLIENT = /^autoapply-mcp\/([0-9A-Za-z.+-]{1,32})/;
const RUNS = new Set(["setup", "refresh"]);

export default {
  async fetch(request) {
    const url = new URL(request.url);
    const list = await fetch(new URL("/api/v1/boards-list.json", url));
    if (request.method === "GET") {
      const headers = Object.fromEntries(request.headers);
      const agent = headers["user-agent"] ?? "";
      const found = CLIENT.exec(agent);
      await after(capture([event("boards_download", {
        client: found ? "autoapply-mcp" : "other",
        autoapply_version: found?.[1],
        run: RUNS.has(url.searchParams.get("run")) ? url.searchParams.get("run") : undefined,
        user_agent: cut(agent),
        ok: list.ok,
        ...origin(headers),
      })]));
    }
    // No cache anywhere: with "public, max-age=300" Vercel's CDN answered for five
    // minutes without running this, and the downloads went uncounted.
    return new Response(request.method === "HEAD" ? null : list.body, {
      status: list.status,
      headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store",
                 "Access-Control-Allow-Origin": "*" },
    });
  },
};
