import { z } from "zod";
import { AppError } from "../util/errors.js";
import { logger } from "../util/logger.js";
import { fetchJson, fetchText } from "./http.js";
import { boardVerification, locationLabel, normalizePublicJob, parseSourcePayload } from "./sourceValidation.js";
/**
 * Phenom career sites (careers.cisco.com, careers.roche.com, careers.allianz.com...).
 *
 * Phenom is a front end: the application itself happens on the employer's ATS
 * behind it (Workday for Cisco, Roche and HPE, SuccessFactors for Allianz), and
 * the posting's `applyUrl` points there. Its search widget is public JSON:
 * `POST https://{host}/widgets` with `ddoKey: "refineSearch"`, filtered to the
 * country Spain. The filter is fuzzy (a job in Zurich with a second location in
 * Madrid comes back), so every location is returned and the Spain preset judges.
 *
 * `company.board` is `host/refNum` or `host/refNum/country/lang`: the site's
 * host, the refNum every Phenom page carries in its config, and the locale path
 * its job pages live under when it has one (careers.cisco.com/global/en/job/1,
 * but careers.clarivate.com/job/1), e.g. `careers.cisco.com/CISCISGLOBAL/global/en`.
 */
const PAGE_SIZE = 50;
const MAX_POSTINGS = 1_000;
/** Each description is a ~130 KB page; past this many, the search teaser stands in. */
function maxDetails() {
    const raw = Number.parseInt(process.env.ATS_PHENOM_MAX_DETAILS ?? "", 10);
    return Number.isFinite(raw) && raw >= 0 ? raw : 100;
}
const HOST = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;
const TOKEN = /^[A-Za-z0-9_-]{1,40}$/;
export function parseBoard(board) {
    const parts = board.split("/");
    const [host, refNum, country, lang] = parts;
    const ok = (parts.length === 2 || parts.length === 4) && HOST.test(host ?? "") && TOKEN.test(refNum ?? "")
        && (parts.length === 2 || (TOKEN.test(country) && TOKEN.test(lang)));
    if (!ok) {
        throw new AppError("invalid_board", `phenom board must be "host/refNum" or "host/refNum/country/lang" (e.g. careers.cisco.com/CISCISGLOBAL/global/en), got: ${board}`, { board });
    }
    return { host, refNum, country: country ?? null, lang: lang ?? null };
}
const jobSchema = z.object({
    jobId: z.union([z.string(), z.number()]).transform(String).pipe(z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_.-]{0,99}$/)),
    title: z.string().trim().min(1),
    city: z.string().nullish(), state: z.string().nullish(), country: z.string().nullish(),
    location: z.string().nullish(), cityStateCountry: z.string().nullish(),
    multi_location: z.array(z.string()).nullish(),
    applyUrl: z.string().nullish(),
    postedDate: z.string().nullish(),
    descriptionTeaser: z.string().nullish(),
    type: z.string().nullish(),
    RemoteType: z.string().nullish(), remote: z.unknown().optional(),
}).passthrough();
const searchSchema = z.object({
    refineSearch: z.object({
        status: z.number().optional(),
        totalHits: z.number().int().nonnegative(),
        data: z.object({ jobs: z.array(z.unknown()) }),
    }).passthrough(),
}).passthrough();
function searchBody(board, from, spain = "Spain") {
    const country = board.country ?? "global";
    return {
        lang: `${board.lang ?? "en"}_${country}`, deviceType: "desktop", country, pageName: "search-results",
        ddoKey: "refineSearch", sortBy: "", subsearch: "", from, jobs: true, counts: true,
        all_fields: ["country"], size: PAGE_SIZE, clearAll: false, jdsource: "facets", isSliderEnable: false,
        pageId: "page20", siteType: "external", keywords: "", global: true,
        selected_fields: spain === null ? {} : { country: [spain] }, locationData: {}, refNum: board.refNum,
    };
}
/** Phenom writes offsets as +0000; ISO wants +00:00. */
export function isoDate(value) {
    if (!value)
        return null;
    const fixed = value.trim().replace(/([+-]\d{2})(\d{2})$/, "$1:$2");
    return Number.isNaN(Date.parse(fixed)) ? null : new Date(fixed).toISOString();
}
export function jobUrl(board, jobId) {
    const prefix = board.country && board.lang ? `/${board.country}/${board.lang}` : "";
    return `https://${board.host}${prefix}/job/${encodeURIComponent(jobId)}`;
}
/** The page config object every Phenom page embeds as `phApp.ddo = {...};`. */
export function pageData(html) {
    const match = /phApp\.ddo\s*=\s*(\{[\s\S]*?\});\s*phApp\./.exec(html);
    if (!match)
        return null;
    try {
        return JSON.parse(match[1]);
    }
    catch {
        return null;
    }
}
/** Sites name the country their own way (Spain, SPAIN, ESP); the facet says which. */
const SPAIN = /^(?:spain|espa(?:n|ñ)a|esp|es)$/i;
async function spainValue(board) {
    const payload = await fetchJson(`https://${board.host}/widgets`, {
        allowedHosts: [board.host], body: { ...searchBody(board, 0, null), size: 1 },
    });
    const aggregations = payload?.refineSearch?.data?.aggregations;
    const country = Array.isArray(aggregations) ? aggregations.find((entry) => entry?.field === "country") : null;
    const values = country && typeof country.value === "object" && country.value ? Object.keys(country.value) : [];
    return values.find((value) => SPAIN.test(value.trim())) ?? null;
}
async function search(board) {
    const spain = await spainValue(board);
    if (spain === null)
        return [];
    const jobs = [];
    for (let from = 0; from < MAX_POSTINGS; from += PAGE_SIZE) {
        const payload = parseSourcePayload(searchSchema, await fetchJson(`https://${board.host}/widgets`, {
            allowedHosts: [board.host], body: searchBody(board, from, spain),
        }), "Phenom");
        const page = payload.refineSearch.data.jobs.map((job) => parseSourcePayload(jobSchema, job, "Phenom job"));
        jobs.push(...page);
        if (page.length < PAGE_SIZE || jobs.length >= payload.refineSearch.totalHits)
            return jobs;
    }
    logger.warn("phenom posting ceiling reached", { host: board.host, max: MAX_POSTINGS });
    return jobs;
}
async function description(board, job) {
    try {
        const html = await fetchText(jobUrl(board, job.jobId), { allowedHosts: [board.host], retries: 1, maxBytes: 4 * 1024 * 1024 });
        const detail = pageData(html)?.jobDetail?.data?.job;
        return typeof detail?.description === "string" && detail.description.trim() ? detail.description : null;
    }
    catch (error) {
        logger.debug("phenom detail failed", { host: board.host, job: job.jobId, error: String(error) });
        return null;
    }
}
function workplace(job) {
    const text = `${job.RemoteType ?? ""} ${typeof job.remote === "string" ? job.remote : ""}`.toLowerCase();
    if (text.includes("hybrid"))
        return "hybrid";
    if (text.includes("remote"))
        return "remote";
    return /on.?site|office/.test(text) ? "onsite" : "unknown";
}
function normalize(board, company, job, html, capturedAt) {
    const own = locationLabel({ city: job.city ?? undefined, region: job.state ?? undefined, country: job.country ?? undefined });
    const labels = [...new Set([...(job.multi_location ?? []), job.cityStateCountry || own || job.location || ""]
        .map((value) => value.trim()).filter(Boolean))];
    const type = workplace(job);
    const url = jobUrl(board, job.jobId);
    return normalizePublicJob({
        company, externalId: job.jobId, title: job.title, locations: labels, url,
        applyUrl: job.applyUrl || url,
        descriptionHtml: html ?? job.descriptionTeaser ?? "",
        postedAt: isoDate(job.postedDate), workplaceType: type, isRemote: type === "remote",
        employmentType: job.type ?? undefined,
    }, capturedAt, [job.country ?? ""]);
}
/** A Phenom page names its site in its config; the host is the page's own. */
export function boardFromPage(pageUrl, html) {
    if (!/phApp\b/.test(html) || !/phenompeople/i.test(html))
        return null;
    const refNum = /"refNum"\s*:\s*"([A-Za-z0-9_-]{1,40})"/.exec(html)?.[1];
    let url;
    try {
        url = new URL(pageUrl);
    }
    catch {
        return null;
    }
    if (!refNum || !HOST.test(url.hostname))
        return null;
    // A locale path is the first two segments when they look like /global/en or /us/en.
    const [country, lang] = url.pathname.split("/").filter(Boolean);
    const localized = country && lang && /^[a-z]{2,8}$/i.test(country) && /^[a-z]{2}$/i.test(lang);
    return { ats: "phenom", board: [url.hostname, refNum, ...(localized ? [country, lang] : [])].join("/"), region: "global" };
}
export const phenomAdapter = {
    kind: "phenom",
    listUrl: (company) => `https://${parseBoard(company.board).host}/widgets`,
    boardUrl: (company) => {
        const board = parseBoard(company.board);
        return `https://${board.host}${board.country && board.lang ? `/${board.country}/${board.lang}` : ""}/search-results`;
    },
    async listJobs(company, capturedAt) {
        const board = parseBoard(company.board);
        const jobs = await search(board);
        const limit = maxDetails();
        const out = [];
        for (const [index, job] of jobs.entries()) {
            const html = index < limit ? await description(board, job) : null;
            out.push(normalize(board, company, job, html, capturedAt));
        }
        return out;
    },
    async verifyBoard(company) {
        const board = parseBoard(company.board);
        const payload = parseSourcePayload(searchSchema, await fetchJson(`https://${board.host}/widgets`, {
            allowedHosts: [board.host], body: { ...searchBody(board, 0, null), size: 3 }, retries: 0,
        }), "Phenom");
        const titles = payload.refineSearch.data.jobs.map((job) => String(job?.title ?? "")).filter(Boolean);
        return boardVerification(titles, payload.refineSearch.totalHits);
    },
    boardFromUrl: () => null,
    boardFromPage,
    probeUrls: () => [],
};
