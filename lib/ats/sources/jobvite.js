import { AppError } from "../util/errors.js";
import { decodeEntitiesOnce } from "../text/html.js";
import { fetchText } from "./http.js";
import { boardVerification, normalizePublicJob, publishedDate } from "./sourceValidation.js";
/**
 * Jobvite career sites, `jobs.jobvite.com/<site>` (nutanix, drillinginfo for
 * Enverus, telemedicine-clinic).
 *
 * Board: the site name in the path. Query: the site's keyword search, "Spain"
 * unless set (it matches the location text, other locations of a posting
 * included); "-" reads `/jobs`, every posting on one page.
 *
 * Both pages are server-rendered: a link to `/<site>/job/<id>` per posting in
 * `.jv-job-list-name`, then `.jv-job-list-location` with "City, Country", or
 * "N Locations" for a posting with several. Search pages hold 50 and follow the
 * "next" link. The posting page's `p.jv-job-detail-meta` names every location,
 * after the department and before the requisition number, and
 * `.jv-job-detail-description` holds the text; few sites add JSON-LD. Posting
 * pages are read for the first ATS_JOBVITE_MAX_DETAILS postings, the ones that
 * hide their locations first.
 */
const HOST = "jobs.jobvite.com";
const DEFAULT_QUERY = "Spain";
const MAX_PAGES = 20;
function maxDetails() {
    const raw = Number.parseInt(process.env.ATS_JOBVITE_MAX_DETAILS ?? "", 10);
    return Number.isFinite(raw) && raw >= 0 ? raw : 60;
}
function site(company) {
    const value = String(company.board).trim().replace(/^https?:\/\/jobs\.jobvite\.com\//i, "").replace(/\/.*$/, "");
    if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,99}$/.test(value))
        throw new AppError("invalid_board", `jobvite board must be the career site's name (jobs.jobvite.com/<site>), got: ${company.board}`, { board: company.board });
    return value;
}
const keyword = (company) => company.query === "-" ? "" : (company.query || DEFAULT_QUERY);
function listUrl(company, page = 0) {
    if (!keyword(company))
        return `https://${HOST}/${site(company)}/jobs`;
    return `https://${HOST}/${site(company)}/search?${new URLSearchParams({ q: keyword(company), p: String(page) })}`;
}
const text = (html) => decodeEntitiesOnce(String(html).replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
/** The postings on one list or search page; `count` is set when the row only says "N Locations". */
export function parseJobviteList(html, siteName) {
    const found = new Map();
    const pattern = /class="jv-job-list-name"[^>]*>\s*<a\b[^>]*href="([^"]*\/job\/([A-Za-z0-9]+))"[^>]*>([\s\S]*?)<\/a>[\s\S]*?class="jv-job-list-location"[^>]*>([\s\S]*?)<\/(?:td|div)>/gi;
    for (const row of String(html).matchAll(pattern)) {
        const id = row[2];
        const title = text(row[3]);
        if (!title || found.has(id))
            continue;
        const location = text(row[4]);
        const count = /^(\d+)\s+locations?$/i.exec(location)?.[1];
        found.set(id, {
            id, title, url: `https://${HOST}/${siteName}/job/${id}`,
            locations: count ? [] : [location].filter(Boolean), count: count ? Number(count) : 0,
        });
    }
    return [...found.values()];
}
const nextPage = (html) => /class="jv-pagination-next"/.test(html);
/** The posting page's locations, description and date. */
export function parseJobviteDetail(html, count) {
    const meta = /<p class="jv-job-detail-meta">([\s\S]*?)<\/p>/i.exec(html)?.[1] ?? "";
    // Department, then each location, then "Req.Num.: ..." or another labelled field.
    const segments = meta.split(/<span class=['"]jv-inline-separator['"]><\/span>/i).map(text).filter((part) => part && !part.includes(":"));
    const locations = count > 0 ? segments.slice(-count) : [];
    const start = html.search(/<div class="jv-job-detail-description"/i);
    const end = start < 0 ? -1 : html.slice(start).search(/<div class="jv-job-detail-bottom-actions"|<\/article>/i);
    const descriptionHtml = start < 0 ? "" : html.slice(start, end < 0 ? undefined : start + end).replace(/^<div[^>]*>/i, "").replace(/<\/div>\s*$/i, "");
    let postedAt = null;
    for (const block of html.matchAll(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)) {
        try {
            const data = JSON.parse(block[1]);
            if (data?.["@type"] === "JobPosting" && typeof data.datePosted === "string")
                postedAt = publishedDate(data.datePosted);
        }
        catch {
            // Malformed JSON-LD is common; the page's markup still stands.
        }
    }
    return { locations, descriptionHtml: descriptionHtml.trim(), postedAt };
}
async function readList(company) {
    const name = site(company);
    const postings = new Map();
    for (let page = 0; page < MAX_PAGES; page += 1) {
        const html = await fetchText(listUrl(company, page), { allowedHosts: [HOST] });
        const before = postings.size;
        for (const posting of parseJobviteList(html, name))
            postings.set(posting.id, posting);
        if (!keyword(company) || !nextPage(html) || postings.size === before)
            break;
    }
    return [...postings.values()];
}
export const jobviteAdapter = {
    kind: "jobvite",
    listUrl: (company) => listUrl(company),
    boardUrl: (company) => `https://${HOST}/${site(company)}/jobs`,
    async listJobs(company, capturedAt) {
        const postings = await readList(company);
        // Postings that only say "N Locations" are read first: without their page they have no place.
        const order = [...postings].sort((a, b) => Number(b.count > 0) - Number(a.count > 0));
        const details = new Map();
        for (const posting of order.slice(0, maxDetails())) {
            try {
                details.set(posting.id, parseJobviteDetail(await fetchText(posting.url, { allowedHosts: [HOST], retries: 1 }), posting.count));
            }
            catch {
                // The list's own fields still stand.
            }
        }
        return postings.map((posting) => {
            const detail = details.get(posting.id);
            const locations = posting.count > 0 ? detail?.locations ?? [] : posting.locations;
            const remote = locations.length > 0 && locations.every((place) => /\bremote\b/i.test(place));
            return normalizePublicJob({
                company, externalId: posting.id, title: posting.title, locations,
                url: posting.url, applyUrl: `${posting.url}/apply`,
                descriptionHtml: detail?.descriptionHtml ?? "", postedAt: detail?.postedAt ?? null,
                workplaceType: remote ? "remote" : "unknown", isRemote: remote,
            }, capturedAt, []);
        });
    },
    async verifyBoard(company) {
        return boardVerification((await readList(company)).map((posting) => posting.title));
    },
    probeUrls: () => [],
    /** `https://jobs.jobvite.com/<site>/jobs|search|job/...` */
    boardFromUrl(raw) {
        try {
            const url = new URL(raw);
            const name = /^\/([A-Za-z0-9][A-Za-z0-9_-]{0,99})(?:\/|$)/.exec(url.pathname)?.[1];
            return url.hostname.toLowerCase() === HOST && name ? { ats: "jobvite", board: name, region: "global" } : null;
        }
        catch {
            return null;
        }
    },
};
