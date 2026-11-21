// The repo's star count for the home page's GitHub button. The build writes
// the count into the page, but the site is built once a day; the page asks
// here once a minute. The CDN keeps the answer two minutes, so GitHub is asked
// at most 30 times an hour per region, under its limit of 60 without a token.
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
        headers: { "Cache-Control": "public, max-age=30, s-maxage=120, stale-while-revalidate=3600" },
      });
    } catch (e) {
      console.error("stars:", e?.message ?? e);
      // The page keeps the count it shows. 200, since an error status would put a
      // failed request in every reader's console each minute, and kept a minute
      // so a GitHub that refuses is not asked again by every reader.
      return Response.json({ stars: null }, { headers: { "Cache-Control": "public, max-age=30, s-maxage=60" } });
    }
  },
};
