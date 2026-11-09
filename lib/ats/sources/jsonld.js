import { htmlToText } from "../text/html.js";
import { AppError } from "../util/errors.js";
import { shortHash } from "../util/hash.js";
import { fetchText } from "./http.js";
import { boardVerification, locationLabel, normalizePublicJob, publishedDate, publishedSalary } from "./sourceValidation.js";
/**
 * Career sites of the employer's own making that publish each posting's
 * schema.org JobPosting as JSON-LD, the markup Google for Jobs reads. They
 * have no listing API, so a board is two steps: a listing that names the
 * posting pages, then one request per posting for its JSON-LD.
 *
 * Board: the listing's URL without the scheme, e.g. `adevinta.com/careers/jobs/`.
 * The company's `query` says how to read it, as `;`-separated options:
 *   (none)               the listing is an HTML page; its same-host links to postings
 *   `sitemap`            the listing is an XML sitemap; its <loc> entries
 *   `match=<regex>`      which link paths are postings (default: a path with a job-like
 *                        segment followed by one more segment)
 * Only the board's own host is ever requested, over plain HTTPS with the
 * polite client: a site that refuses a plain client is not a jsonld board.
 * Posting reads stop at ATS_JSONLD_MAX_POSTINGS (150) per board.
 */
const JOB_PATH = /\/(?:jobs?|careers?\/jobs?|positions?|vacanc(?:y|ies)|openings?|ofertas?|empleo|vacantes?)\/[^/?#]+/i;
function maxPostings() {
    const raw = Number.parseInt(process.env.ATS_JSONLD_MAX_POSTINGS ?? "", 10);
    return Number.isFinite(raw) && raw > 0 ? raw : 150;
}
/** Board string and options, validated: the listing must be one HTTPS URL. */
export function parseJsonldBoard(company) {
    const listing = new URL(`https://${company.board.replace(/^https?:\/\//i, "")}`);
    if (!listing.hostname.includes(".") || listing.username || listing.password) {
        throw new AppError("invalid_board", `jsonld board must be a listing URL without scheme, got: ${company.board}`);
    }
    const options = { mode: "html", match: JOB_PATH };
    for (const part of (company.query ?? "").split(";").map((value) => value.trim()).filter(Boolean)) {
        if (part === "sitemap")
            options.mode = "sitemap";
        else if (part.startsWith("match="))
            options.match = new RegExp(part.slice("match=".length), "i");
        else
            throw new AppError("invalid_board", `unknown jsonld option: ${part}`);
    }
    return { listing, host: listing.hostname, options };
}
const read = (url, host, extra = {}) => fetchText(url, { allowedHosts: [host], retries: 1, ...extra });
function decodeEntities(value) {
    return value.replace(/&amp;/g, "&").replace(/\\\//g, "/");
}
/** Same-host posting URLs named in a piece of HTML or XML, in order, once each. */
export function postingLinks(markup, base, options) {
    const found = new Map();
    const pattern = options.mode === "sitemap" ? /<loc>\s*([^<\s]+)\s*<\/loc>/gi : /href\s*=\s*["']([^"'#]+)["']/gi;
    for (const match of decodeEntities(markup).matchAll(pattern)) {
        let url;
        try {
            url = new URL(match[1], base);
        }
        catch {
            continue;
        }
        if (url.protocol !== "https:" || url.hostname !== base.hostname)
            continue;
        // Client-side templates leave placeholders such as <%- url %> in the markup.
        if (/%3C|%3E|%7B|%7D|%25|%20|%(?![0-9A-F]{2})/i.test(url.pathname))
            continue;
        if (!options.match.test(url.pathname) || url.pathname.replace(/\/$/, "") === base.pathname.replace(/\/$/, ""))
            continue;
        url.hash = "";
        found.set(url.href, url.href);
    }
    return [...found.values()];
}
const MAX_PAGES = 10;
/** The listing's other pages it links to: WordPress `page/N/` paths or a `page=N` query on the same path. */
export function pageLinks(markup, listing) {
    const base = listing.pathname.replace(/\/$/, "");
    const pages = new Map();
    for (const match of decodeEntities(markup).matchAll(/href\s*=\s*["']([^"'#]+)["']/gi)) {
        let url;
        try {
            url = new URL(match[1], listing);
        }
        catch {
            continue;
        }
        if (url.hostname !== listing.hostname)
            continue;
        const path = url.pathname.replace(/\/$/, "");
        const wordpress = new RegExp(`^${base.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/page/(\\d+)$`).exec(path);
        const query = path === base && /^\d+$/.test(url.searchParams.get("page") ?? "") ? url.searchParams.get("page") : null;
        const n = Number(wordpress?.[1] ?? query ?? 0);
        if (n > 1 && n <= MAX_PAGES)
            pages.set(n, url.href);
    }
    return [...pages.entries()].sort((a, b) => a[0] - b[0]).map(([, href]) => href);
}
async function postingUrls(board) {
    const { listing, host, options } = board;
    if (options.mode === "sitemap")
        return postingLinks(await read(listing.href, host, { accept: "application/xml, text/xml" }), listing, options);
    const first = await read(listing.href, host);
    const pages = [first];
    // Each page may link further ones (1 2 3 ... next), so keep reading what is new.
    const seen = new Set([listing.href]);
    for (let i = 0; i < pages.length && seen.size <= MAX_PAGES; i += 1) {
        for (const href of pageLinks(pages[i], listing)) {
            if (seen.has(href) || seen.size > MAX_PAGES)
                continue;
            seen.add(href);
            pages.push(await read(href, host));
        }
    }
    return postingLinks(pages.join("\n"), listing, options);
}
/** Every JobPosting object in a page's JSON-LD blocks. */
export function jobPostings(html) {
    const found = [];
    const visit = (node) => {
        if (Array.isArray(node))
            return node.forEach(visit);
        if (!node || typeof node !== "object")
            return;
        const type = node["@type"];
        if (type === "JobPosting" || (Array.isArray(type) && type.includes("JobPosting")))
            found.push(node);
        if (Array.isArray(node["@graph"]))
            node["@graph"].forEach(visit);
    };
    for (const block of html.matchAll(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)) {
        const text = block[1].trim();
        try {
            visit(JSON.parse(text));
        }
        catch {
            // Raw line breaks inside strings are the usual fault of hand-made JSON-LD.
            try {
                visit(JSON.parse(text.replace(/[\u0000-\u001f]+/g, " ")));
            }
            catch {
                continue;
            }
        }
    }
    return found;
}
// Sites put HTML entities in JSON-LD strings, sometimes escaped twice (eDreams: "&amp;#8211;").
const text = (value) => htmlToText(typeof value === "string" ? value : typeof value?.name === "string" ? value.name : "");
const list = (value) => Array.isArray(value) ? value : value === undefined || value === null ? [] : [value];
function places(posting) {
    const labels = [];
    const countries = [];
    for (const place of list(posting.jobLocation)) {
        const address = place?.address ?? place;
        if (typeof address === "string") {
            labels.push(address.trim());
            continue;
        }
        const country = text(address?.addressCountry);
        countries.push(country);
        labels.push(locationLabel({ city: text(address?.addressLocality), region: text(address?.addressRegion), country }));
    }
    const remote = list(posting.jobLocationType).some((value) => /telecommute|remote/i.test(String(value)));
    for (const requirement of list(posting.applicantLocationRequirements)) {
        const name = text(requirement);
        if (name) {
            countries.push(name);
            if (remote)
                labels.push(`Remote, ${countryLabel(name)}`);
        }
    }
    if (remote && !labels.some((label) => /remote/i.test(label)))
        labels.push("Remote");
    return { labels: [...new Set(labels.filter(Boolean))], countries, remote };
}
const countryLabel = (name) => locationLabel({ country: name });
function workplace(posting, remote) {
    if (remote)
        return "remote";
    const declared = list(posting.jobLocationType).map(String).join(" ");
    return /hybrid/i.test(declared) ? "hybrid" : /on-?site/i.test(declared) ? "onsite" : "unknown";
}
function salary(posting) {
    const base = posting.baseSalary;
    if (!base || typeof base !== "object")
        return null;
    const value = base.value && typeof base.value === "object" ? base.value : { value: base.value };
    const min = Number(value.minValue ?? value.value);
    const max = Number(value.maxValue ?? value.value);
    return publishedSalary({
        min: Number.isFinite(min) ? min : null, max: Number.isFinite(max) ? max : null,
        currency: String(base.currency ?? ""), period: String(value.unitText ?? base.unitText ?? "").toLowerCase(),
    });
}
function identifier(posting, url) {
    const raw = text(posting.identifier?.value !== undefined ? String(posting.identifier.value) : posting.identifier);
    return /^[A-Za-z0-9][A-Za-z0-9_-]{0,199}$/.test(raw) ? raw : shortHash(url, 12);
}
/** One normalized Job from a posting page, or null when the page carries no open JobPosting. */
export function jobFromPage(html, url, company, capturedAt) {
    const posting = jobPostings(html)[0];
    if (!posting || !text(posting.title))
        return null;
    const closes = publishedDate(typeof posting.validThrough === "string" ? posting.validThrough : "");
    if (closes && Date.parse(closes) < Date.parse(capturedAt))
        return null;
    const { labels, countries, remote } = places(posting);
    const own = typeof posting.url === "string" && posting.url.startsWith("https://") ? posting.url : url;
    return normalizePublicJob({
        company, externalId: identifier(posting, own), title: text(posting.title), locations: labels,
        url: own, applyUrl: own,
        descriptionHtml: typeof posting.description === "string" ? posting.description : "",
        postedAt: publishedDate(typeof posting.datePosted === "string" ? posting.datePosted : ""),
        workplaceType: workplace(posting, remote), isRemote: remote,
        employmentType: list(posting.employmentType).map(String)[0],
        structuredCompensation: salary(posting),
    }, capturedAt, countries);
}
async function readBoard(company, capturedAt, limit) {
    const board = parseJsonldBoard(company);
    const urls = (await postingUrls(board)).slice(0, limit);
    const jobs = [];
    for (const url of urls) {
        let html;
        try {
            html = await read(url, board.host);
        }
        catch (error) {
            // A posting that closed between the listing and its read is gone, not a board failure.
            if (error instanceof AppError && error.code === "not_found")
                continue;
            throw error;
        }
        const job = jobFromPage(html, url, company, capturedAt);
        if (job)
            jobs.push(job);
    }
    return jobs;
}
export const jsonldAdapter = {
    kind: "jsonld",
    listUrl: (company) => parseJsonldBoard(company).listing.href,
    boardUrl: (company) => parseJsonldBoard(company).listing.href,
    listJobs: (company, capturedAt) => readBoard(company, capturedAt, maxPostings()),
    async verifyBoard(company) {
        const jobs = await readBoard(company, new Date().toISOString(), 3);
        return boardVerification(jobs.map((job) => job.title));
    },
    probeUrls: () => [],
    // Telling a JSON-LD site apart costs a read of one of its postings, so such
    // boards are written by hand (data/careers.json and data/boards.json).
    boardFromUrl: () => null,
    boardFromPage: () => null,
};
