import { z } from "zod";
import { AppError } from "../util/errors.js";
import { logger } from "../util/logger.js";
import { fetchJson } from "./http.js";
import { boardVerification, locationLabel, normalizePublicJob, parseSourcePayload } from "./sourceValidation.js";
/**
 * iCIMS career sites built on Jibe, the "careers-home" sites (careers.keysight.com,
 * www.github.careers). Their search is public JSON at
 * `GET https://{host}/api/jobs?country=Spain&page=N&limit=100`, with the full
 * description in each posting. The country filter also returns postings whose
 * second or third location is in Spain, so every location is kept and the Spain
 * preset judges. Applications happen on the employer's iCIMS portal behind a
 * sign-in (`apply_url`).
 *
 * Classic `*.icims.com/jobs` portals only serve HTML and are not covered.
 *
 * `company.board` is the site's host, e.g. `careers.keysight.com`.
 */
const PAGE_SIZE = 100;
const MAX_POSTINGS = 2_000;
const HOST = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;
export function parseBoard(board) {
    const host = board.trim().toLowerCase();
    if (!HOST.test(host))
        throw new AppError("invalid_board", `icims board must be the career site's host (e.g. careers.keysight.com), got: ${board}`, { board });
    return host;
}
const text = z.string().nullish();
const placeSchema = z.object({ city: text, state: text, country: text, country_code: text }).passthrough();
const jobSchema = z.object({
    slug: z.union([z.string(), z.number()]).transform(String).pipe(z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_.-]{0,99}$/)),
    title: z.string().trim().min(1),
    description: text, responsibilities: text, qualifications: text,
    city: text, state: text, country: text, country_code: text, full_location: text,
    additional_locations: z.array(placeSchema).nullish(),
    language: text, apply_url: text, posted_date: text, employment_type: text, location_type: text,
    tags1: z.unknown().optional(), tags2: z.unknown().optional(), tags3: z.unknown().optional(),
}).passthrough();
const pageSchema = z.object({
    jobs: z.array(z.object({ data: z.unknown() })),
    totalCount: z.number().int().nonnegative(),
}).passthrough();
function listUrl(host, page, limit = PAGE_SIZE) {
    return `https://${host}/api/jobs?${new URLSearchParams({ country: "Spain", page: String(page), limit: String(limit) })}`;
}
/** Jibe writes offsets as +0000; ISO wants +00:00. */
function isoDate(value) {
    if (!value)
        return null;
    const fixed = value.trim().replace(/([+-]\d{2})(\d{2})$/, "$1:$2");
    return Number.isNaN(Date.parse(fixed)) ? null : new Date(fixed).toISOString();
}
async function readJobs(host) {
    const jobs = [];
    for (let page = 1; jobs.length < MAX_POSTINGS; page += 1) {
        const payload = parseSourcePayload(pageSchema, await fetchJson(listUrl(host, page), { allowedHosts: [host] }), "iCIMS");
        const batch = payload.jobs.map((job) => parseSourcePayload(jobSchema, job.data, "iCIMS job"));
        jobs.push(...batch);
        if (batch.length < PAGE_SIZE || jobs.length >= payload.totalCount)
            return jobs;
    }
    logger.warn("icims posting ceiling reached", { host, max: MAX_POSTINGS });
    return jobs;
}
/** Remote shows up as a tag on some sites ("Remote", "Hybrid"); anything else is unknown. */
function workplace(job) {
    const tags = [job.tags1, job.tags2, job.tags3, job.location_type].flat().filter((v) => typeof v === "string").join(" ").toLowerCase();
    if (/\bhybrid\b/.test(tags))
        return "hybrid";
    if (/\bremote\b|\bfully remote\b/.test(tags))
        return "remote";
    return "unknown";
}
function normalize(host, company, job, capturedAt) {
    const places = [job, ...(job.additional_locations ?? [])];
    const labels = [...new Set(places.map((place) => locationLabel({
            city: place.city ?? undefined, region: place.state ?? undefined, country: place.country ?? undefined,
        })).filter(Boolean))];
    const type = workplace(job);
    // A posting's page exists only in its own language: without ?lang= it is a 404 on some sites.
    const lang = /^[a-z]{2}(?:-[a-z]{2})?$/i.test(job.language ?? "") ? `?lang=${job.language.toLowerCase()}` : "";
    const url = `https://${host}/jobs/${encodeURIComponent(job.slug)}${lang}`;
    return normalizePublicJob({
        company, externalId: job.slug, title: job.title,
        locations: labels.length ? labels : [job.full_location ?? ""], url, applyUrl: job.apply_url || url,
        descriptionHtml: [job.description, job.responsibilities, job.qualifications].filter(Boolean).join("\n"),
        postedAt: isoDate(job.posted_date), workplaceType: type, isRemote: type === "remote",
        employmentType: job.employment_type ?? undefined,
    }, capturedAt, places.map((place) => place.country_code || place.country || ""));
}
/** A careers-home page carries Jibe's markup; its host is the board. */
export function boardFromPage(pageUrl, html) {
    if (!/\bJIBE_INPUT|jibeapply|\bjibe\b/i.test(html))
        return null;
    try {
        const host = new URL(pageUrl).hostname.toLowerCase();
        return HOST.test(host) ? { ats: "icims", board: host, region: "global" } : null;
    }
    catch {
        return null;
    }
}
export const icimsAdapter = {
    kind: "icims",
    listUrl: (company) => listUrl(parseBoard(company.board), 1),
    boardUrl: (company) => `https://${parseBoard(company.board)}/jobs`,
    async listJobs(company, capturedAt) {
        const host = parseBoard(company.board);
        return (await readJobs(host)).map((job) => normalize(host, company, job, capturedAt));
    },
    async verifyBoard(company) {
        const host = parseBoard(company.board);
        const payload = parseSourcePayload(pageSchema, await fetchJson(listUrl(host, 1, 3), { allowedHosts: [host], retries: 0 }), "iCIMS");
        const titles = payload.jobs.map((job) => String(job.data?.title ?? "")).filter(Boolean);
        return boardVerification(titles, payload.totalCount);
    },
    boardFromUrl: () => null,
    boardFromPage,
    probeUrls: () => [],
};
