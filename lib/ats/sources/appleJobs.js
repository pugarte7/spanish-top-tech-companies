import { logger } from "../util/logger.js";
import { fetchText } from "./http.js";
import { asString, normalizeJob } from "./normalize.js";
/**
 * Apple Jobs (jobs.apple.com).
 *
 * Search and posting pages are server-rendered with their data embedded as
 * `window.__staticRouterHydrationData`. Search results are a summary; each
 * posting's page adds the qualifications and the internal level range
 * ("Software Development Engineer - Security ICT4" to "... ICT5"), which is
 * kept in the description because it is the only seniority signal Apple
 * publishes.
 *
 * Board: the location filter slug (e.g. `united-states-USA`; Spain is
 * `spain-ESPC`, while `spain-ESP` matches nothing); the company's
 * `query` is the search text.
 */
const ORIGIN = "https://jobs.apple.com";
/** The search for Spain, which is what a link to Apple's careers means here. */
export const APPLE_SPAIN = "spain-ESPC";
const PAGE_SIZE = 20;
export function appleSearchUrl(location, query, page) {
    const params = new URLSearchParams();
    if (query.trim())
        params.set("search", query.trim());
    params.set("sort", "relevance");
    if (location.trim())
        params.set("location", location.trim());
    if (page > 1)
        params.set("page", String(page));
    return `${ORIGIN}/en-us/search?${params.toString()}`;
}
export function appleJobUrl(id, slug) {
    return `${ORIGIN}/en-us/details/${encodeURIComponent(id)}${slug ? `/${encodeURIComponent(slug)}` : ""}`;
}
export function appleApplyUrl(id) {
    return `${ORIGIN}/app/en-us/apply/${encodeURIComponent(id)}`;
}
/** Decodes the page's `window.__staticRouterHydrationData = JSON.parse("...")` payload. */
export function appleHydrationData(html) {
    const match = /window\.__staticRouterHydrationData\s*=\s*JSON\.parse\("([\s\S]*?)"\);/.exec(html);
    if (!match?.[1])
        return null;
    try {
        const decoded = JSON.parse(`"${match[1]}"`);
        return JSON.parse(decoded);
    }
    catch {
        return null;
    }
}
function loader(html, name) {
    const data = appleHydrationData(html);
    const loaders = data?.loaderData;
    const value = loaders?.[name];
    return value && typeof value === "object" ? value : null;
}
export function appleLocationNames(locations) {
    return (locations ?? [])
        .map((place) => [asString(place.name), asString(place.stateProvince), asString(place.countryName)].filter(Boolean).join(", "))
        .filter((name) => name.length > 0);
}
export function parseAppleSearch(html) {
    const search = loader(html, "search");
    const results = Array.isArray(search?.searchResults) ? search.searchResults : [];
    return { results, total: typeof search?.totalRecords === "number" ? search.totalRecords : null };
}
export function parseAppleDetail(html) {
    const details = loader(html, "jobDetails");
    const data = details?.jobsData;
    return data && typeof data === "object" ? data : null;
}
/** Description HTML built from a posting, with its level range stated up front. */
export function appleDescriptionHtml(summary, detail) {
    const text = (value) => asString(value).trim();
    const block = (heading, value) => text(value) ? `<h3>${heading}</h3><p>${text(value).replace(/\n/g, "<br>")}</p>` : "";
    const levels = [text(detail?.lowJobTitle), text(detail?.highJobTitle)].filter(Boolean);
    return [
        levels.length ? `<p>Apple job level: ${[...new Set(levels)].join(" to ")}</p>` : "",
        block("Summary", detail?.jobSummary ?? summary),
        block("Description", detail?.description),
        block("Minimum qualifications", detail?.minimumQualifications),
        block("Preferred qualifications", detail?.preferredQualifications),
    ].join("\n");
}
function maxPages() {
    const raw = Number.parseInt(process.env.ATS_CAREERS_MAX_PAGES ?? "", 10);
    return Number.isFinite(raw) && raw > 0 ? raw : 10;
}
export const appleJobsAdapter = {
    kind: "apple",
    listUrl(company) {
        return appleSearchUrl(company.board, company.query, 1);
    },
    boardUrl(company) {
        return appleSearchUrl(company.board, company.query, 1);
    },
    async listJobs(company, capturedAt) {
        const results = [];
        const seen = new Set();
        for (let page = 1; page <= maxPages(); page += 1) {
            const { results: found, total } = parseAppleSearch(await fetchText(appleSearchUrl(company.board, company.query, page)));
            const fresh = found.filter((result) => {
                const id = asString(result.id);
                if (!id || seen.has(id))
                    return false;
                seen.add(id);
                return true;
            });
            results.push(...fresh);
            if (fresh.length < PAGE_SIZE || (total !== null && results.length >= total))
                break;
        }
        const jobs = [];
        for (const result of results) {
            const id = asString(result.id);
            const slug = asString(result.transformedPostingTitle);
            let detail = null;
            try {
                detail = parseAppleDetail(await fetchText(appleJobUrl(id, slug)));
            }
            catch (error) {
                logger.warn("apple posting page unreadable; keeping the search summary", { id, error: String(error) });
            }
            const locations = appleLocationNames(detail?.locations?.length ? detail.locations : result.locations);
            jobs.push(normalizeJob({
                company,
                externalId: id,
                title: asString(result.postingTitle),
                locations,
                url: appleJobUrl(id, slug),
                applyUrl: appleApplyUrl(id),
                descriptionHtml: appleDescriptionHtml(asString(result.jobSummary), detail),
                postedAt: asString(result.postDateInGMT) || null,
            }, capturedAt));
        }
        return jobs;
    },
    /** jobs.apple.com, or apple.com/careers, is Apple's own board: read as its search for Spain. */
    boardFromUrl(raw) {
        try {
            const url = new URL(raw);
            const host = url.hostname.toLowerCase();
            const own = host === "jobs.apple.com" || ((host === "www.apple.com" || host === "apple.com") && /^\/(?:[a-z]{2}(?:-[a-z]{2})?\/)?careers(?:\/|$)/i.test(url.pathname));
            return own ? { ats: "apple", board: APPLE_SPAIN, region: "global" } : null;
        }
        catch {
            return null;
        }
    },
    probeUrls() {
        return [];
    },
    async verifyBoard(company) {
        const { results, total } = parseAppleSearch(await fetchText(appleSearchUrl(company.board, company.query, 1)));
        return {
            ok: results.length > 0,
            postings: total ?? results.length,
            sampleTitles: results.slice(0, 3).map((result) => asString(result.postingTitle)),
            detail: results.length > 0 ? "search returned postings" : "search matched no postings",
        };
    },
};
