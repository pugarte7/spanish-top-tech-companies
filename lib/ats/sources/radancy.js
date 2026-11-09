import { AppError } from "../util/errors.js";
import { decodeEntitiesOnce } from "../text/html.js";
import { fetchJson, fetchText } from "./http.js";
import { boardVerification, normalizePublicJob, publishedDate } from "./sourceValidation.js";
/**
 * Radancy (TalentBrew) career sites, on the employer's own domain
 * (careers.ing.com, jobs.sanofi.com, careers.loreal.com).
 *
 * Board: the site's host and, when the site is localised, its language
 * segment: `careers.ing.com/en`, `careers.webfleet.com`.
 *
 * The site's own search page asks `/search-jobs/results` for its list, a JSON
 * envelope around the results' HTML. The Spain country facet (GeoNames id
 * 2510769) narrows it on the server, unlike the free-text location box, which
 * the sites ignore. Every posting page carries JobPosting JSON-LD, read for the
 * description and the date on the first ATS_RADANCY_MAX_DETAILS postings.
 */
const SPAIN_GEONAME = "2510769";
const PAGE_SIZE = 100;
const MAX_PAGES = 20;
function maxDetails() {
    const raw = Number.parseInt(process.env.ATS_RADANCY_MAX_DETAILS ?? "", 10);
    return Number.isFinite(raw) && raw >= 0 ? raw : 60;
}
function parseBoard(board) {
    const [host, ...rest] = String(board).trim().replace(/^https?:\/\//i, "").replace(/\/+$/, "").split("/");
    if (!/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(host ?? "") || rest.some((part) => !/^[A-Za-z0-9_-]+$/.test(part))) {
        throw new AppError("invalid_board", `radancy board must be "<host>[/<lang>]", got: ${board}`, { board });
    }
    return { host: host.toLowerCase(), base: `https://${[host.toLowerCase(), ...rest].join("/")}` };
}
function resultsUrl(base, page) {
    const params = new URLSearchParams({
        ActiveFacetID: SPAIN_GEONAME, CurrentPage: String(page), RecordsPerPage: String(PAGE_SIZE),
        Distance: "50", RadiusUnitType: "0", Keywords: "", Location: "", ShowRadius: "False",
        IsPagination: page > 1 ? "True" : "False", FacetType: "0",
        "FacetFilters[0].ID": SPAIN_GEONAME, "FacetFilters[0].FacetType": "2", "FacetFilters[0].Count": "0",
        "FacetFilters[0].Display": "Spain", "FacetFilters[0].IsApplied": "true", "FacetFilters[0].FieldName": "",
        SearchResultsModuleName: "Search Results", SearchFiltersModuleName: "Search Filters",
        SortCriteria: "0", SortDirection: "0", SearchType: "6", ResultsType: "0",
    });
    return `${base}/search-jobs/results?${params}`;
}
const text = (html) => decodeEntitiesOnce(html.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
/** The postings in one results page: links to /job/... carrying data-job-id. */
export function parseResults(html, origin) {
    const found = new Map();
    for (const match of html.matchAll(/<a\b([^>]*\bhref="([^"]*\/job\/[^"]+)"[^>]*)>([\s\S]*?)<\/a>/gi)) {
        const id = /data-job-id="(\d+)"/.exec(match[1])?.[1];
        if (!id || found.has(id))
            continue;
        const inner = match[3];
        const title = text(/<h[1-6][^>]*>([\s\S]*?)<\/h[1-6]>/i.exec(inner)?.[1] ?? "");
        const place = text(/<span[^>]*job-location[^>]*>([\s\S]*?)<\/span>/i.exec(inner)?.[1] ?? "")
            .replace(/^(?:location|ubicaci[oó]n)\s*:\s*/i, "");
        if (title)
            found.set(id, { id, title, location: place, url: new URL(decodeEntitiesOnce(match[2]), origin).href });
    }
    return [...found.values()];
}
function totalPages(html) {
    const pages = Number.parseInt(/data-total-pages="(\d+)"/.exec(html)?.[1] ?? "1", 10);
    return Number.isFinite(pages) && pages > 0 ? Math.min(pages, MAX_PAGES) : 1;
}
/** The search was for Spain: a place the site writes without its country is in Spain. */
function spainLabel(place) {
    const label = place && !/^multiple locations$/i.test(place) ? place : "";
    return /\b(spain|españa|espana)\b/i.test(label) ? label : [label, "Spain"].filter(Boolean).join(", ");
}
function jobPosting(html) {
    for (const block of html.matchAll(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)) {
        try {
            const data = JSON.parse(block[1]);
            const items = Array.isArray(data) ? data : data["@graph"] ?? [data];
            const posting = items.find((item) => item && item["@type"] === "JobPosting");
            if (posting)
                return posting;
        }
        catch {
            // Malformed JSON-LD is common; the list's own fields still stand.
        }
    }
    return null;
}
async function readList(board) {
    const { host, base } = parseBoard(board);
    const options = { allowedHosts: [host], headers: { "x-requested-with": "XMLHttpRequest" } };
    const first = await fetchJson(resultsUrl(base, 1), options);
    if (typeof first?.results !== "string")
        throw new AppError("invalid_source_payload", "Radancy search returned no results HTML");
    const postings = parseResults(first.results, `https://${host}`);
    for (let page = 2; page <= totalPages(first.results); page += 1) {
        const next = await fetchJson(resultsUrl(base, page), options);
        postings.push(...parseResults(String(next?.results ?? ""), `https://${host}`));
    }
    return { host, postings: [...new Map(postings.map((p) => [p.id, p])).values()] };
}
export const radancyAdapter = {
    kind: "radancy",
    listUrl: (company) => resultsUrl(parseBoard(company.board).base, 1),
    boardUrl: (company) => `${parseBoard(company.board).base}/search-jobs`,
    async listJobs(company, capturedAt) {
        const { host, postings } = await readList(company.board);
        const limit = maxDetails();
        const jobs = [];
        for (const [index, posting] of postings.entries()) {
            let detail = null;
            if (index < limit) {
                try {
                    detail = jobPosting(await fetchText(posting.url, { allowedHosts: [host], retries: 1 }));
                }
                catch {
                    detail = null;
                }
            }
            jobs.push(normalizePublicJob({
                company, externalId: posting.id, title: posting.title,
                locations: [spainLabel(posting.location)], url: posting.url, applyUrl: posting.url,
                descriptionHtml: typeof detail?.description === "string" ? detail.description : "",
                postedAt: publishedDate(typeof detail?.datePosted === "string" ? detail.datePosted : undefined),
                workplaceType: "unknown", isRemote: false,
            }, capturedAt, ["ES"]));
        }
        return jobs;
    },
    async verifyBoard(company) {
        const { postings } = await readList(company.board);
        return boardVerification(postings.map((p) => p.title));
    },
    probeUrls: () => [],
    boardFromUrl: () => null,
    /** A TalentBrew site loads its assets from tbcdn.talentbrew.com and searches at /search-jobs. */
    boardFromPage(pageUrl, html) {
        if (!/tbcdn\.talentbrew\.com|cdn\.radancy\.eu/i.test(html) || !/search-jobs/i.test(html))
            return null;
        let url;
        try {
            url = new URL(pageUrl);
        }
        catch {
            return null;
        }
        const lang = url.pathname.split("/").filter(Boolean)[0] ?? "";
        const board = /^[a-z]{2}(?:-[a-z]{2})?$/i.test(lang) ? `${url.hostname}/${lang}` : url.hostname;
        return { ats: "radancy", board: board.toLowerCase(), region: "global" };
    },
};
