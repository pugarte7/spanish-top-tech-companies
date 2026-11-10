// The repo's star count for the topbar. The build writes the count into the
// page, but the site is built once a day, so a reader who starred it saw the
// old number until the next morning. The CDN keeps the answer ten minutes,
// which keeps GitHub's limit of 60 calls an hour without a token far away.
const REPO = "https://api.github.com/repos/pugarte7/spanish-top-tech-companies";

export default {
  async fetch() {
    const headers = { Accept: "application/vnd.github+json", "User-Agent": "spanish-top-tech-companies" };
    if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
    try {
      const r = await fetch(REPO, { headers, signal: AbortSignal.timeout(4000) });
      if (!r.ok) throw new Error(`GitHub answered ${r.status}`);
      const stars = (await r.json()).stargazers_count;
      if (!Number.isInteger(stars)) throw new Error("no stargazers_count");
      return Response.json({ stars }, {
        headers: { "Cache-Control": "public, max-age=60, s-maxage=600, stale-while-revalidate=3600" },
      });
    } catch (e) {
      console.error("stars:", e?.message ?? e);
      // The page keeps the count it was built with.
      return Response.json({ stars: null }, { status: 502, headers: { "Cache-Control": "no-store" } });
    }
  },
};
