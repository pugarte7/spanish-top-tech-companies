import { AppError } from "../util/errors.js";
import { decodeEntitiesOnce } from "../text/html.js";
import { logger } from "../util/logger.js";
import { fetchText, userAgent } from "./http.js";
import { jobPostings } from "./jsonld.js";
import { boardVerification, normalizePublicJob, publishedDate } from "./sourceValidation.js";
import { fetchSourceResponse } from "./sourceRedirects.js";
/**
 * Njoyn job searches (cgi.njoyn.com), the employer's `xweb.asp` listing.
 *
 * Board: `<host>/<instance>/<clid>`, e.g. `cgi.njoyn.com/CORP/21001`, read off
 * the listing URL (`https://cgi.njoyn.com/CORP/xweb/xweb.asp?clid=21001&Page=JobListing`).
 * Query: the ISO country code the search is narrowed to, "ES" unless set.
 *
 * The listing filters only on a form-encoded POST (`Inp_country=ES`); the
 * same fields in a GET are ignored and every country comes back, 50 rows a
 * page over thousands. The shared client sends JSON bodies only, so the POST
 * goes through the redirect-checked fetch with the same User-Agent, the host
 * pinned and its own pause between pages. The answer is a table: one row per
 * posting with its id (linked to the posting page), title, category, city and
 * country, paged by `pn` until the "Search Results (N)" count. The filter is
 * loose (a remote posting from another country can appear), so each row keeps
 * its own country. Posting pages carry a schema.org JobPosting: the first
 * ATS_NJOYN_MAX_DETAILS are read for the description and the date posted.
 */
const DEFAULT_COUNTRY = "ES";
const PAGE_SIZE = 50;
const MAX_PAGES = 40;
const PAUSE_MS = 700;
function maxDetails() {
    const raw = Number.parseInt(process.env.ATS_NJOYN_MAX_DETAILS ?? "", 10);
    return Number.isFinite(raw) && raw >= 0 ? raw : 150;
}
function parseBoard(board) {
    const [host, instance, clid, ...rest] = String(board).trim().replace(/^https?:\/\//i, "").replace(/\/+$/, "").split("/");
    if (rest.length || !/^[a-z0-9-]+\.njoyn\.com$/i.test(host ?? "") || !/^[A-Za-z0-9_]+$/.test(instance ?? "") || !/^\d+$/.test(clid ?? "")) {
        throw new AppError("invalid_board", `njoyn board must be "<host>/<instance>/<clid>", got: ${board}`, { board });
    }
    return { host: host.toLowerCase(), base: `https://${host.toLowerCase()}/${instance}/xweb/`, clid };
}
function country(company) {
    const value = (company.query || DEFAULT_COUNTRY).trim().toUpperCase();
    if (!/^[A-Z]{2}$/.test(value))
        throw new AppError("invalid_board", `njoyn query must be an ISO country code, got: ${company.query}`);
    return value;
}
function listingUrl(company) {
    const { base, clid } = parseBoard(company.board);
    return `${base}xweb.asp?NTKN=c&clid=${clid}&Page=JobListing&lang=1`;
}
const text = (html) => decodeEntitiesOnce(html.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
/** The postings in one page of a Njoyn listing, with its total. */
export function parseNjoynListing(html, base) {
    const rows = [];
    for (const row of String(html).matchAll(/<tr\b([^>]*)>\s*<td><a href='([^']*Page=JobDetails[^']*)'>([^<]+)<\/a><\/td>\s*<td>([\s\S]*?)<\/td>\s*<td>[\s\S]*?<\/td>\s*<td>([\s\S]*?)<\/td>\s*<td name='CountryCell'>([\s\S]*?)<\/td>/gi)) {
        const id = text(row[3]);
        const title = text(row[4]);
        if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,199}$/.test(id) || !title)
            continue;
        const city = text(row[5]);
        rows.push({
            id, title,
            url: new URL(decodeEntitiesOnce(row[2]), base).href,
            city: /^(?:n\/?a|-)$/i.test(city) ? "" : city,
            country: text(row[6]),
            remote: /\bRemoteWork='True'/i.test(row[1]),
        });
    }
    const total = Number.parseInt(/Search Results \((\d+)\)/i.exec(html)?.[1] ?? "", 10);
    return { rows, total: Number.isFinite(total) ? total : null };
}
async function postListing(company, page) {
    const { host } = parseBoard(company.board);
    const body = new URLSearchParams({ s: " EnterDate Desc ", pn: String(page), Inp_country: country(company) });
    const response = await fetchSourceResponse(listingUrl(company), {
        method: "POST",
        headers: { "user-agent": userAgent(), accept: "text/html", "content-type": "application/x-www-form-urlencoded" },
        body: body.toString(),
        signal: AbortSignal.timeout(30_000),
    }, [host]);
    if (!response.ok)
        throw new AppError(response.status === 429 || response.status >= 500 ? "retryable_http" : "http_error", `HTTP ${response.status} from ${host}`, { status: response.status });
    return response.text();
}
async function readListing(company) {
    const { base } = parseBoard(company.board);
    const postings = new Map();
    for (let page = 1; page <= MAX_PAGES; page += 1) {
        if (page > 1)
            await new Promise((resolve) => setTimeout(resolve, PAUSE_MS));
        const { rows, total } = parseNjoynListing(await postListing(company, page), base);
        const before = postings.size;
        for (const row of rows)
            postings.set(row.id, row);
        if (rows.length < PAGE_SIZE || postings.size === before || (total !== null && page * PAGE_SIZE >= total))
            break;
    }
    return [...postings.values()];
}
/** A posting page's description and dates, from its JSON-LD. */
export function parseNjoynPosting(html) {
    const posting = jobPostings(String(html))[0];
    const date = (value) => publishedDate(typeof value === "string" ? value : "");
    return {
        descriptionHtml: typeof posting?.description === "string" ? posting.description : "",
        postedAt: date(posting?.datePosted),
        validThrough: date(posting?.validThrough),
    };
}
async function readPosting(company, row) {
    try {
        return parseNjoynPosting(await fetchText(row.url, { allowedHosts: [parseBoard(company.board).host], retries: 1 }));
    }
    catch (error) {
        logger.warn("njoyn posting page unreadable; keeping the listing row", { id: row.id, error: String(error) });
        return null;
    }
}
export const njoynAdapter = {
    kind: "njoyn",
    listUrl: listingUrl,
    boardUrl: listingUrl,
    async listJobs(company, capturedAt) {
        const jobs = [];
        for (const [index, row] of (await readListing(company)).entries()) {
            const detail = index < maxDetails() ? await readPosting(company, row) : null;
            if (detail?.validThrough && Date.parse(detail.validThrough) < Date.parse(capturedAt))
                continue;
            const place = [row.city, row.country].filter(Boolean).join(", ");
            jobs.push(normalizePublicJob({
                company, externalId: row.id, title: row.title,
                locations: place ? [row.remote ? `Remote, ${place}` : place] : row.remote ? ["Remote"] : [],
                url: row.url, applyUrl: row.url,
                descriptionHtml: detail?.descriptionHtml ?? "", postedAt: detail?.postedAt ?? null,
                workplaceType: row.remote ? "remote" : "unknown", isRemote: row.remote,
            }, capturedAt, []));
        }
        return jobs;
    },
    async verifyBoard(company) {
        return boardVerification((await readListing(company)).map((row) => row.title));
    },
    probeUrls: () => [],
    /** `https://<tenant>.njoyn.com/<instance>/xweb/xweb.asp?clid=<n>...` */
    boardFromUrl(raw) {
        try {
            const url = new URL(raw);
            const instance = /^\/([A-Za-z0-9_]+)\/xweb\//i.exec(url.pathname)?.[1];
            const clid = [...url.searchParams].find(([key]) => key.toLowerCase() === "clid")?.[1];
            if (!/^[a-z0-9-]+\.njoyn\.com$/i.test(url.hostname) || !instance || !/^\d+$/.test(clid ?? ""))
                return null;
            return { ats: "njoyn", board: `${url.hostname.toLowerCase()}/${instance}/${clid}`, region: "global" };
        }
        catch {
            return null;
        }
    },
};
