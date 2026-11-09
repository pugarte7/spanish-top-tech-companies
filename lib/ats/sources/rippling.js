import { z } from "zod";
import { fetchJson } from "./http.js";
import { boardToken, boardVerification, locationLabel, nonEmptyText, normalizePublicJob, optionalText, parseSourcePayload, } from "./sourceValidation.js";
/**
 * Rippling ATS public job boards. Board: the board slug in
 * ats.rippling.com/<slug>/jobs (Chess.com's is `chess`). The list carries
 * every posting's locations; descriptions take one request each, so only the
 * first ATS_RIPPLING_MAX_DETAILS postings (default 50) get one.
 */
const API = "api.rippling.com";
const PAGE_SIZE = 100;
const MAX_PAGES = 20;
const locationSchema = z.object({
    name: optionalText, country: optionalText, countryCode: optionalText, state: optionalText,
    stateCode: optionalText, city: optionalText, workplaceType: optionalText,
}).passthrough();
const pageSchema = z.object({
    items: z.array(z.object({
        id: nonEmptyText, name: nonEmptyText, url: nonEmptyText,
        department: z.object({ name: optionalText }).passthrough().nullish(),
        locations: z.array(locationSchema).default([]),
    }).passthrough()),
    totalPages: z.number().int().nonnegative(),
}).passthrough();
const detailSchema = z.object({
    description: z.record(z.string(), z.string().nullish()).nullish(),
    createdOn: optionalText,
}).passthrough();
const board = (company) => boardToken(company.board);
const listUrl = (company, page = 0) =>
    `https://${API}/platform/api/ats/v2/board/${encodeURIComponent(board(company))}/jobs?page=${page}&pageSize=${PAGE_SIZE}`;
function maxDetails() {
    const raw = Number.parseInt(process.env.ATS_RIPPLING_MAX_DETAILS ?? "", 10);
    return Number.isFinite(raw) && raw >= 0 ? raw : 50;
}
async function readItems(company) {
    const items = [];
    for (let page = 0; page < MAX_PAGES; page += 1) {
        const body = parseSourcePayload(pageSchema, await fetchJson(listUrl(company, page), { allowedHosts: [API] }), "Rippling");
        items.push(...body.items);
        if (page + 1 >= body.totalPages)
            break;
    }
    return items;
}
function workplace(locations) {
    const types = new Set(locations.map((location) => (location.workplaceType ?? "").toUpperCase()));
    if (types.has("HYBRID"))
        return "hybrid";
    if (types.size === 1 && types.has("REMOTE"))
        return "remote";
    return types.has("ON_SITE") || types.has("ONSITE") ? "onsite" : "unknown";
}
async function description(company, id) {
    try {
        const url = `https://${API}/platform/api/ats/v2/board/${encodeURIComponent(board(company))}/jobs/${encodeURIComponent(id)}`;
        const detail = parseSourcePayload(detailSchema, await fetchJson(url, { allowedHosts: [API] }), "Rippling");
        return Object.values(detail.description ?? {}).filter(Boolean).join("\n");
    }
    catch {
        return "";
    }
}
const HOSTED = /^https?:\/\/ats\.rippling\.com\/([A-Za-z0-9][A-Za-z0-9_-]*)\/jobs\b/i;
export const ripplingAdapter = {
    kind: "rippling",
    listUrl,
    boardUrl: (company) => `https://ats.rippling.com/${encodeURIComponent(board(company))}/jobs`,
    async listJobs(company, capturedAt) {
        const items = await readItems(company);
        const cap = maxDetails();
        const jobs = [];
        for (const [index, item] of items.entries()) {
            const type = workplace(item.locations);
            jobs.push(normalizePublicJob({
                company, externalId: item.id, title: item.name.trim(),
                locations: [...new Set(item.locations.map((location) => locationLabel({
                    city: location.city, region: location.state, country: location.country, countryCode: location.countryCode,
                }) || (location.name ?? "").trim()).filter(Boolean))],
                url: item.url, applyUrl: item.url,
                descriptionHtml: index < cap ? await description(company, item.id) : "",
                postedAt: null, workplaceType: type, isRemote: type === "remote",
            }, capturedAt, item.locations.map((location) => location.countryCode || location.country || "")));
        }
        return jobs;
    },
    async verifyBoard(company) {
        return boardVerification((await readItems(company)).map((item) => item.name.trim()));
    },
    probeUrls: () => [],
    boardFromUrl(url) {
        const hosted = HOSTED.exec(url);
        if (hosted)
            return { ats: "rippling", board: hosted[1], region: "global" };
        const api = /^https?:\/\/api\.rippling\.com\/platform\/api\/ats\/v\d+\/board\/([A-Za-z0-9][A-Za-z0-9_-]*)\//i.exec(url);
        return api ? { ats: "rippling", board: api[1], region: "global" } : null;
    },
    boardFromPage(_pageUrl, html) {
        const match = /https?:\/\/(?:ats\.rippling\.com\/([A-Za-z0-9][A-Za-z0-9_-]*)\/jobs|api\.rippling\.com\/platform\/api\/ats\/v\d+\/board\/([A-Za-z0-9][A-Za-z0-9_-]*)\/)/i.exec(html);
        const slug = match?.[1] ?? match?.[2];
        return slug ? { ats: "rippling", board: slug, region: "global" } : null;
    },
};
