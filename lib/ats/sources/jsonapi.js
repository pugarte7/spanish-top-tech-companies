import { z } from "zod";
import { AppError } from "../util/errors.js";
import { fetchJson } from "./http.js";
import { boardVerification, nonEmptyText, normalizePublicJob, optionalText, parseSourcePayload, publishedDate, } from "./sourceValidation.js";
/**
 * Employers whose careers site reads its postings from a public JSON API of
 * their own. Each one is a tiny mapping here, named by the board:
 *
 *   capgemini-es    Capgemini's job stream, Spain only (country_code=es-es)
 *   sage            Sage's career search (every country; one call)
 *   schwarz-digits  Schwarz Digits' job search, its Spanish offices only
 *
 * Nothing on a page gives these away, so their boards are written out in
 * data/careers.json, and a board this file has no mapping for is an error.
 */
const MAX_PAGES = 40;
const capgeminiPage = z.object({
    count: z.number().int().nonnegative(),
    data: z.array(z.object({
        id: nonEmptyText, title: nonEmptyText, location: optionalText, country_code: optionalText,
        description: optionalText, apply_job_url: nonEmptyText, indexed_at: optionalText,
        contract_type: optionalText,
    }).passthrough()),
}).passthrough();
const sagePayload = z.object({
    vacancies: z.object({
        Records: z.array(z.object({
            Id: nonEmptyText, Name: nonEmptyText, Url: nonEmptyText, OfficeLocation: optionalText,
            Country: optionalText, ActiveDate: optionalText, Description: optionalText,
        }).passthrough()),
    }).passthrough(),
}).passthrough();
const schwarzPage = z.object({
    jobs: z.array(z.object({
        id: nonEmptyText, title: nonEmptyText, location: optionalText, url: nonEmptyText,
    }).passthrough()),
    pagination: z.object({ totalCount: z.number().int().nonnegative() }).passthrough(),
    filters: z.object({
        groups: z.array(z.object({
            identifier: z.string(),
            values: z.array(z.object({ identifier: z.string() }).passthrough()),
        }).passthrough()),
    }).passthrough().optional(),
}).passthrough();
const place = (city, country) => [city?.trim(), country].filter(Boolean).join(", ");
const MAPPINGS = {
    "capgemini-es": {
        host: "cg-jobstream-api.azurewebsites.net",
        boardUrl: "https://www.capgemini.com/es-es/careers/",
        async postings() {
            const out = [];
            for (let page = 1; page <= MAX_PAGES; page += 1) {
                const url = `https://${this.host}/api/job-search?page=${page}&size=100&country_code=es-es`;
                const body = parseSourcePayload(capgeminiPage, await fetchJson(url, { allowedHosts: [this.host] }), "Capgemini");
                out.push(...body.data);
                if (body.data.length === 0 || out.length >= body.count)
                    break;
            }
            return out.map((job) => ({
                externalId: job.id, title: job.title, locations: [place(job.location, "Spain")], countries: ["ES"],
                url: job.apply_job_url, applyUrl: job.apply_job_url, descriptionHtml: job.description ?? "",
                postedAt: publishedDate(job.indexed_at), employmentType: job.contract_type ?? undefined,
            }));
        },
    },
    sage: {
        host: "www.sage.com",
        boardUrl: "https://www.sage.com/en-gb/company/careers/career-search/",
        async postings() {
            const url = `https://${this.host}/api/sagedotcom/careersearch/getcareersearchdata/`;
            const body = parseSourcePayload(sagePayload, await fetchJson(url, { allowedHosts: [this.host] }), "Sage");
            return body.vacancies.Records.map((job) => ({
                externalId: job.Id, title: job.Name, locations: [place(job.OfficeLocation, job.Country)],
                countries: [job.Country ?? ""], url: job.Url, applyUrl: job.Url, descriptionHtml: job.Description ?? "",
                postedAt: publishedDate(job.ActiveDate),
            }));
        },
    },
    "schwarz-digits": {
        host: "schwarz-digits.de",
        boardUrl: "https://schwarz-digits.de/en/jobsearch",
        async postings() {
            const url = `https://${this.host}/en/api/v1/job/search`;
            const search = (page, perPage, cities) => fetchJson(url, {
                allowedHosts: [this.host],
                body: { page, perPage, includeAllLanguages: true, filters: { employment_area: [], entry_level: [], location_city: cities } },
            });
            // The city filter's identifiers name the country: location_SIT-ES_Barcelona.
            const first = parseSourcePayload(schwarzPage, await search(1, 1, []), "Schwarz Digits");
            const cities = (first.filters?.groups ?? []).find((group) => group.identifier === "location_city")?.values
                .map((value) => value.identifier).filter((id) => /-ES_/.test(id)) ?? [];
            if (cities.length === 0)
                return [];
            const out = [];
            for (let page = 1; page <= MAX_PAGES; page += 1) {
                const body = parseSourcePayload(schwarzPage, await search(page, 50, cities), "Schwarz Digits");
                out.push(...body.jobs);
                if (body.jobs.length === 0 || out.length >= body.pagination.totalCount)
                    break;
            }
            return out.map((job) => ({
                externalId: job.id, title: job.title, locations: [place(job.location, "Spain")], countries: ["ES"],
                url: job.url, applyUrl: job.url, descriptionHtml: "",
            }));
        },
    },
};
function mapping(company) {
    const found = MAPPINGS[company.board];
    if (!found)
        throw new AppError("invalid_board", `no jsonapi mapping named "${company.board}"`, { board: company.board });
    return found;
}
async function listJobs(company, capturedAt) {
    const rows = await mapping(company).postings();
    return rows.map((row) => normalizePublicJob({
        company, externalId: row.externalId, title: row.title, locations: row.locations.filter(Boolean),
        url: row.url, applyUrl: row.applyUrl, descriptionHtml: row.descriptionHtml, postedAt: row.postedAt ?? null,
        workplaceType: "unknown", isRemote: false, employmentType: row.employmentType,
    }, capturedAt, row.countries));
}
export const jsonapiAdapter = {
    kind: "jsonapi",
    listUrl: (company) => mapping(company).boardUrl,
    boardUrl: (company) => mapping(company).boardUrl,
    listJobs,
    async verifyBoard(company) {
        return boardVerification((await mapping(company).postings()).map((row) => row.title));
    },
    probeUrls: () => [],
};
export const JSONAPI_BOARDS = Object.keys(MAPPINGS);
