import { z } from "zod";
import { AppError } from "../util/errors.js";
import { htmlToText } from "../text/html.js";
import { fetchJson } from "./http.js";
import { boardVerification, nonEmptyText, normalizePublicJob, optionalText, parseSourcePayload, postingIdentifier, publishedDate, } from "./sourceValidation.js";
/**
 * BeeSite job search APIs by Milch & Zucker, behind employers' own career
 * sites: `api-<tenant>.beesite.de` (Deutsche Bank) or a host of the
 * employer's (`api-apply.lufthansagroup.careers`, `jobs.api.mercedes-benz.com`).
 *
 * Board: the API's host. Query: `;`-separated options, all optional:
 *   `country=<id>`   the tenant's id for the country searched, 193 unless set
 *                    (Spain at Deutsche Bank and Lufthansa; Mercedes-Benz numbers
 *                    it 508). Each tenant lists its ids at `/lookup/country/lang/EN`.
 *   `job=<url>`      the public posting URL with `{id}` for the posting's id, for a
 *                    tenant whose PositionURI is a path on no public host (Deutsche
 *                    Bank's `/index.php?ac=jobad&id=…`).
 *
 * `GET /search/?data=<JSON>` takes the search as URL-encoded JSON: the
 * fields wanted (MatchedObjectDescriptor), a page (FirstItem, 1-based, and
 * CountItem) and criteria (PositionLocation.Country). Each item has its id,
 * title, places (city, country name and ISO code) and publication date. Some
 * tenants also serve each posting's text at `/jobhtml/<id>` (Deutsche Bank);
 * the first posting is tried, and the rest are read only when it answers.
 */
const DEFAULT_COUNTRY = "193";
const PAGE_SIZE = 100;
const MAX_PAGES = 30;
const FIELDS = ["ID", "PositionID", "PositionTitle", "PositionURI", "PositionLocation.CityName", "PositionLocation.CountryName",
    "PositionLocation.CountryCode", "PublicationStartDate"];
function maxDetails() {
    const raw = Number.parseInt(process.env.ATS_BEESITE_MAX_DETAILS ?? "", 10);
    return Number.isFinite(raw) && raw >= 0 ? raw : 150;
}
const itemSchema = z.object({
    ID: optionalText, PositionID: optionalText, PositionTitle: nonEmptyText, PositionURI: optionalText, PublicationStartDate: optionalText,
    PositionLocation: z.array(z.object({ CityName: optionalText, CountryName: optionalText, CountryCode: optionalText }).passthrough()).nullish(),
}).passthrough();
const searchSchema = z.object({
    SearchResult: z.object({
        SearchResultCount: z.number().int().nonnegative(),
        SearchResultCountAll: z.number().int().nonnegative().nullish(),
        SearchResultItems: z.array(z.object({ MatchedObjectDescriptor: itemSchema }).passthrough()),
    }).passthrough(),
}).passthrough();
const jobHtmlSchema = z.object({ html: z.string() }).passthrough();
function host(company) {
    const value = String(company.board).trim().replace(/^https?:\/\//i, "").replace(/\/+(?:search\/?)?$/i, "").toLowerCase();
    if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(value))
        throw new AppError("invalid_board", `beesite board must be the API's host, got: ${company.board}`, { board: company.board });
    return value;
}
function options(company) {
    const found = { country: DEFAULT_COUNTRY, job: null };
    for (const part of (company.query ?? "").split(";").map((value) => value.trim()).filter(Boolean)) {
        const [key, ...rest] = part.split("=");
        const value = rest.join("=");
        if (key === "country" && /^\d+$/.test(value))
            found.country = value;
        else if (key === "job" && /^https:\/\/[^\s]+\{id\}/.test(value))
            found.job = value;
        else
            throw new AppError("invalid_board", `unknown beesite option: ${part}`);
    }
    return found;
}
function searchUrl(company, first) {
    const data = {
        LanguageCode: "EN",
        SearchParameters: { FirstItem: first, CountItem: PAGE_SIZE, MatchedObjectDescriptor: FIELDS,
            Sort: [{ Criterion: "PublicationStartDate", Direction: "DESC" }] },
        SearchCriteria: [{ CriterionName: "PositionLocation.Country", CriterionValue: [options(company).country] }],
    };
    return `https://${host(company)}/search/?data=${encodeURIComponent(JSON.stringify(data))}`;
}
async function readItems(company) {
    const items = new Map();
    for (let page = 0, first = 1; page < MAX_PAGES; page += 1, first += PAGE_SIZE) {
        const payload = parseSourcePayload(searchSchema, await fetchJson(searchUrl(company, first), { allowedHosts: [host(company)] }), "BeeSite search");
        const result = payload.SearchResult;
        const before = items.size;
        for (const { MatchedObjectDescriptor: item } of result.SearchResultItems) {
            const id = postingIdentifier.safeParse(item.ID ?? item.PositionID ?? "");
            if (id.success)
                items.set(id.data, { ...item, id: id.data });
        }
        const total = result.SearchResultCountAll ?? result.SearchResultCount;
        if (result.SearchResultItems.length < PAGE_SIZE || items.size === before || first + PAGE_SIZE > total)
            break;
    }
    return [...items.values()];
}
/** The public posting URL: the item's own when absolute, else the `job` option's. */
export function beesitePostingUrl(item, company) {
    const own = item.PositionURI ?? "";
    if (/^https:\/\//i.test(own))
        return own;
    const template = options(company).job;
    return template ? template.replace("{id}", encodeURIComponent(item.id)) : null;
}
async function readDescription(company, id) {
    const payload = await fetchJson(`https://${host(company)}/jobhtml/${encodeURIComponent(id)}`, { allowedHosts: [host(company)], retries: 0 });
    return parseSourcePayload(jobHtmlSchema, payload, "BeeSite job html").html;
}
export const beesiteAdapter = {
    kind: "beesite",
    listUrl: (company) => searchUrl(company, 1),
    boardUrl: (company) => `https://${host(company)}/search/`,
    async listJobs(company, capturedAt) {
        const jobs = [];
        let describes = true;
        for (const [index, item] of (await readItems(company)).entries()) {
            const url = beesitePostingUrl(item, company);
            if (!url)
                continue;
            let descriptionHtml = "";
            if (describes && index < maxDetails()) {
                try {
                    descriptionHtml = await readDescription(company, item.id);
                }
                catch {
                    // A tenant without the endpoint answers the first posting with an error; stop asking.
                    // A later posting's failure costs only its own text.
                    describes = index > 0;
                }
            }
            const places = (item.PositionLocation ?? []).map((place) => ({
                label: [htmlToText(place.CityName ?? ""), place.CountryCode ? new Intl.DisplayNames(["en"], { type: "region" }).of(place.CountryCode.toUpperCase()) : htmlToText(place.CountryName ?? "")]
                    .filter(Boolean).join(", "),
                code: (place.CountryCode ?? "").toUpperCase(),
            })).filter((place) => place.label);
            jobs.push(normalizePublicJob({
                company, externalId: item.id, title: htmlToText(item.PositionTitle),
                locations: [...new Set(places.map((place) => place.label))],
                url, applyUrl: url, descriptionHtml,
                postedAt: publishedDate(item.PublicationStartDate ?? undefined),
                workplaceType: "unknown", isRemote: false,
            }, capturedAt, places.map((place) => place.code)));
        }
        return jobs;
    },
    async verifyBoard(company) {
        const items = await readItems(company);
        return boardVerification(items.map((item) => htmlToText(item.PositionTitle)));
    },
    probeUrls: () => [],
    boardFromUrl: () => null,
};
