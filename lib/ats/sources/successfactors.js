import { AppError } from "../util/errors.js";
import { fetchJson, fetchText } from "./http.js";
import { boardVerification, locationLabel, normalizePublicJob } from "./sourceValidation.js";
/**
 * SAP SuccessFactors Recruiting Marketing ("RMK") career sites, the ones
 * served on the employer's own host with assets from rmkcdn.successfactors.com
 * (careers.swissre.com, jobs.telefonica.com, careers.indragroup.com).
 *
 * Board: the career site's host, e.g. `careers.swissre.com`. The company's
 * `query` is the location search (default "Spain"), which the site matches
 * against each posting's city and country.
 *
 * Two generations of site. The classic one renders the search server-side:
 * `/search/?locationsearch=…` is a table (or tiles) of postings, 10 to 25 a
 * page, each with its title, link and location ("Madrid, M, ES"). The newer
 * one renders the same page empty and fills it from
 * `POST /services/recruiting/v1/jobs`, which answers anyone who sends the
 * CSRF token the page itself carries; no session or sign-in. Posting pages
 * carry schema.org microdata (place, date posted, description); the first
 * ATS_SUCCESSFACTORS_MAX_DETAILS of them are read for it, the rest keep what
 * the search says.
 */
const DEFAULT_QUERY = "Spain";
const MAX_PAGES = 60;
function maxDetails() {
    const raw = Number.parseInt(process.env.ATS_SUCCESSFACTORS_MAX_DETAILS ?? "", 10);
    return Number.isFinite(raw) && raw >= 0 ? raw : 100;
}
const HOST = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;
function host(company) {
    const value = company.board.trim().toLowerCase();
    if (!HOST.test(value))
        throw new AppError("invalid_board", `successfactors board must be the career site's host (e.g. careers.swissre.com), got: ${company.board}`, { board: company.board });
    return value;
}
export function searchUrl(company, startrow = 0) {
    const params = new URLSearchParams({ q: "", locationsearch: company.query?.trim() || DEFAULT_QUERY });
    if (startrow > 0)
        params.set("startrow", String(startrow));
    return `https://${host(company)}/search/?${params}`;
}
const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: "\"", apos: "'", nbsp: " " };
function decode(value) {
    return value.replace(/&(#x[\da-f]+|#\d+|[a-z]+);/gi, (whole, code) => {
        if (code[0] === "#")
            return String.fromCodePoint(code[1].toLowerCase() === "x" ? Number.parseInt(code.slice(2), 16) : Number.parseInt(code.slice(1), 10));
        return ENTITIES[code.toLowerCase()] ?? whole;
    });
}
const text = (html) => decode(html.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
// The newer sites spell countries in ISO alpha-3 ("ESP").
const ALPHA3 = { ESP: "ES", PRT: "PT", FRA: "FR", DEU: "DE", ITA: "IT", GBR: "GB", IRL: "IE", NLD: "NL", BEL: "BE",
    LUX: "LU", CHE: "CH", AUT: "AT", POL: "PL", CZE: "CZ", SVK: "SK", HUN: "HU", ROU: "RO", BGR: "BG", GRC: "GR",
    HRV: "HR", SVN: "SI", SRB: "RS", DNK: "DK", SWE: "SE", NOR: "NO", FIN: "FI", EST: "EE", LVA: "LV", LTU: "LT",
    UKR: "UA", TUR: "TR", MAR: "MA", TUN: "TN", EGY: "EG", ZAF: "ZA", ARE: "AE", SAU: "SA", ISR: "IL", IND: "IN",
    CHN: "CN", JPN: "JP", KOR: "KR", SGP: "SG", AUS: "AU", NZL: "NZ", USA: "US", CAN: "CA", MEX: "MX", BRA: "BR",
    ARG: "AR", CHL: "CL", COL: "CO", PER: "PE" };
const countryCode = (part) => /^[A-Z]{2}$/.test(part) ? part : ALPHA3[part] ?? null;
/** "Madrid, M, ES" -> a label with the country spelled out, and the country code. */
function splitLocation(value) {
    // Postal codes ("MADRID, ES, 28046") say nothing the city does not.
    const parts = value.split(",").map((part) => part.trim()).filter((part) => part && !/^\d[\d -]*$/.test(part));
    const at = parts.findLastIndex((part) => countryCode(part) !== null);
    if (at > 0 || (at === 0 && parts.length === 1)) {
        const rest = parts.filter((_, i) => i !== at);
        const code = countryCode(parts[at]);
        return { label: locationLabel({ city: rest[0] ?? "", region: rest.length > 1 ? rest[1] : "", countryCode: code }), country: code };
    }
    return { label: parts.join(", ") || value.trim(), country: "" };
}
/** The postings on one search page, and the total the page reports (null when it does not). */
export function parseSearchPage(html, pageHost) {
    const rows = [];
    for (const match of html.matchAll(/<tr class="data-row[^"]*"[^>]*>([\s\S]*?)<\/tr>/g)) {
        const row = match[1];
        const link = /<a[^>]+href="([^"]+)"[^>]*class="jobTitle-link"[^>]*>([\s\S]*?)<\/a>|<a[^>]+class="jobTitle-link"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/.exec(row);
        if (!link)
            continue;
        const href = decode(link[1] ?? link[3]);
        const id = /\/(\d{5,})\/?(?:[?#].*)?$/.exec(href)?.[1];
        if (!id)
            continue;
        const cell = (name) => /<td class="col(\w+)/.test(row)
            ? [...row.matchAll(new RegExp(`<td class="col${name}[^"]*"[^>]*>([\\s\\S]*?)<\\/td>`, "g"))].map((m) => text(m[1])).filter(Boolean)
            : [];
        // Most sites have a location column; some split it into country (Shifttype) and city (Facility).
        let places = cell("Location");
        if (places.length === 0) {
            const city = cell("Facility")[0] ?? "";
            const country = cell("Shifttype")[0] ?? "";
            if (city || country)
                places = [[city, country].filter(Boolean).join(", ")];
        }
        rows.push({
            id, title: text(link[2] ?? link[4]),
            url: new URL(href, `https://${pageHost}/`).href,
            places: places.flatMap((place) => place.split(/\s*;\s*/)).filter(Boolean),
            date: cell("Date")[0] ?? "",
        });
    }
    // The tile layout: one <li class="job-tile job-id-…"> per posting.
    for (const match of html.matchAll(/<li class="job-tile job-id-(\d+)[^"]*"[^>]*data-url="([^"]+)"[^>]*>([\s\S]*?)(?=<li class="job-tile |<\/ul>)/g)) {
        const [, id, href, tile] = match;
        if (rows.some((row) => row.id === id))
            continue;
        const title = /class="jobTitle-link[^"]*"[^>]*>([\s\S]*?)<\/a>/.exec(tile);
        const place = new RegExp(`id="job-${id}-desktop-section-location-value"[^>]*>([\\s\\S]*?)<\\/`).exec(tile);
        if (!title)
            continue;
        rows.push({ id, title: text(title[1]), url: new URL(decode(href), `https://${pageHost}/`).href,
            places: place ? [text(place[1])].filter(Boolean) : [], date: "" });
    }
    const label = /<b>\s*[\d.,]+\s*[–-]\s*[\d.,]+\s*<\/b>[^<]*<b>\s*([\d.,]+)\s*<\/b>/.exec(html)
        ?? /id="tile-search-results-label"[^>]*>[^<\d]*[\d.,]+[^<\d]+[\d.,]+[^<\d]+([\d.,]+)/.exec(html);
    const total = label ? Number.parseInt(label[1].replace(/[.,]/g, ""), 10) : null;
    return { rows, total };
}
function isoDate(value) {
    const time = Date.parse(value.replace(/\bUTC\b/, "GMT"));
    return Number.isNaN(time) ? null : new Date(time).toISOString();
}
/** The element that starts at `start`, up to its own closing tag. */
function elementAt(html, start) {
    const tag = /^<(\w+)/.exec(html.slice(html.lastIndexOf("<", start)))?.[1] ?? "span";
    const open = html.indexOf(">", start) + 1;
    let depth = 1;
    const tags = new RegExp(`<(\\/?)${tag}\\b[^>]*>`, "gi");
    tags.lastIndex = open;
    for (let found = tags.exec(html); found; found = tags.exec(html)) {
        depth += found[1] ? -1 : 1;
        if (depth === 0)
            return html.slice(open, found.index);
    }
    return html.slice(open, open + 20_000);
}
/** The description: the longest element marked as one (newer sites mark an empty one first). */
function descriptionHtml(html) {
    let best = "";
    for (const match of html.matchAll(/class="jobdescription"|itemprop="description"/g)) {
        const body = elementAt(html, match.index);
        if (text(body).length > text(best).length)
            best = body;
    }
    return best;
}
/** What a posting page's schema.org microdata says. */
export function parsePostingPage(html) {
    const prop = (name) => [...html.matchAll(new RegExp(`itemprop="${name}"[^>]*content="([^"]*)"`, "g"))].map((m) => decode(m[1]).trim());
    const cities = prop("addressLocality");
    const regions = prop("addressRegion");
    const countries = prop("addressCountry");
    const places = countries.map((country, i) => splitLocation([cities[i], regions[i], country].filter(Boolean).join(", ")));
    return { places, postedAt: prop("datePosted")[0] ? isoDate(prop("datePosted")[0]) : null, descriptionHtml: descriptionHtml(html) };
}
/** "10/15/26", the newer sites' posting date, as ISO. */
function usDate(value) {
    const m = /^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/.exec(String(value ?? "").trim());
    return m ? `${m[3].length === 2 ? `20${m[3]}` : m[3]}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}` : "";
}
/** The newer sites' search API: what the page's own script asks for. */
export function parseApiPage(payload, pageHost) {
    const rows = [];
    for (const item of Array.isArray(payload?.jobSearchResult) ? payload.jobSearchResult : []) {
        const job = item?.response;
        const id = job?.id === undefined ? "" : String(job.id);
        const title = String(job?.unifiedStandardTitle ?? "").trim();
        if (!/^\d+$/.test(id) || !title)
            continue;
        const slug = String(job.unifiedUrlTitle ?? job.urlTitle ?? "job").replace(/[^\w-]/g, "") || "job";
        const locale = Array.isArray(job.supportedLocales) && job.supportedLocales[0] ? String(job.supportedLocales[0]) : "en_US";
        rows.push({ id, title, url: `https://${pageHost}/job/${slug}/${id}-${locale}/`,
            places: (Array.isArray(job.jobLocationShort) ? job.jobLocationShort : []).map((v) => String(v).replace(/[,\s]+$/, "")).filter(Boolean),
            date: usDate(job.unifiedStandardStart) });
    }
    return { rows, total: Number.isInteger(payload?.totalJobs) ? payload.totalJobs : null };
}
async function readApi(company, token) {
    const site = host(company);
    const rows = new Map();
    let total = null;
    for (let page = 0; page < MAX_PAGES; page += 1) {
        const payload = await fetchJson(`https://${site}/services/recruiting/v1/jobs`, {
            allowedHosts: [site], headers: { "X-CSRF-Token": token },
            body: { locale: "en_US", pageNumber: page, sortBy: "", keywords: "", location: company.query?.trim() || DEFAULT_QUERY,
                facetFilters: {}, brand: "", skills: [], categoryId: 0, alertId: "", rcmCandidateId: "" },
        });
        const parsed = parseApiPage(payload, site);
        total ??= parsed.total;
        const before = rows.size;
        for (const row of parsed.rows)
            rows.set(row.id, row);
        if (parsed.rows.length === 0 || rows.size === before || (total !== null && rows.size >= total))
            break;
    }
    // Their posting pages are filled by script too: nothing to read there.
    return { rows: [...rows.values()], total, details: false };
}
async function readTable(company) {
    const site = host(company);
    const rows = new Map();
    let total = null;
    for (let page = 0, startrow = 0; page < MAX_PAGES; page += 1) {
        const html = await fetchText(searchUrl(company, startrow), { allowedHosts: [site], accept: "text/html" });
        const parsed = parseSearchPage(html, site);
        // A page with no postings and the newer sites' token is filled by script.
        const token = page === 0 && parsed.rows.length === 0 ? /CSRFToken\s*=\s*"([\w-]{8,})"/.exec(html)?.[1] : null;
        if (token)
            return readApi(company, token);
        total ??= parsed.total;
        const before = rows.size;
        for (const row of parsed.rows)
            rows.set(row.id, row);
        // A page with nothing new is the end, whatever the total said.
        if (parsed.rows.length === 0 || rows.size === before || (total !== null && rows.size >= total))
            break;
        startrow += parsed.rows.length;
    }
    return { rows: [...rows.values()], total, details: true };
}
export const successfactorsAdapter = {
    kind: "successfactors",
    listUrl: (company) => searchUrl(company),
    boardUrl: (company) => `https://${host(company)}/`,
    async listJobs(company, capturedAt) {
        const site = host(company);
        const table = await readTable(company);
        const { rows } = table;
        const details = table.details ? maxDetails() : 0;
        const jobs = [];
        for (const [index, row] of rows.entries()) {
            let detail = null;
            if (index < details) {
                try {
                    detail = parsePostingPage(await fetchText(row.url, { allowedHosts: [site], accept: "text/html" }));
                }
                catch (error) {
                    // A posting that closed between the search and its page is left out.
                    if (error instanceof AppError && error.code === "not_found")
                        continue;
                    throw error;
                }
            }
            const places = detail?.places.length ? detail.places : row.places.map(splitLocation);
            jobs.push(normalizePublicJob({
                company, externalId: row.id, title: row.title,
                locations: [...new Set(places.map((place) => place.label).filter(Boolean))],
                url: row.url, applyUrl: row.url,
                descriptionHtml: detail?.descriptionHtml ?? "",
                postedAt: detail?.postedAt ?? (row.date ? isoDate(row.date) : null),
                workplaceType: "unknown", isRemote: false,
            }, capturedAt, places.map((place) => place.country)));
        }
        return jobs;
    },
    async verifyBoard(company) {
        const { rows, total } = await readTable(company);
        return boardVerification(rows.map((row) => row.title), total ?? rows.length);
    },
    probeUrls: () => [],
    /** RMK sites live on the employer's own domain, so a URL alone does not say it is one. */
    boardFromUrl: () => null,
    /** An RMK career site loads its assets from rmkcdn.successfactors.com. */
    boardFromPage(pageUrl, html) {
        if (!/rmkcdn\.successfactors\.com/i.test(html) || !/jobTitle-link|\/search\/\?|\/go\/[^"/]+\/\d+/i.test(html))
            return null;
        try {
            const site = new URL(pageUrl).hostname.toLowerCase();
            return HOST.test(site) ? { ats: "successfactors", board: site, region: "global" } : null;
        }
        catch {
            return null;
        }
    },
};
