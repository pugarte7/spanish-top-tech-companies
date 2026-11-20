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
 *   epam-es         EPAM's career search, Spain only (its own country id)
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
const epamPage = z.object({
    data: z.object({
        total: z.number().int().nonnegative(),
        jobs: z.array(z.object({
            uid: nonEmptyText, name: nonEmptyText, vacancy_type: optionalText, description: optionalText,
            created_at: optionalText,
            seo: z.object({ url: nonEmptyText }).passthrough(),
            city: z.array(z.object({ name: optionalText, country: z.object({ name: optionalText }).passthrough().nullish() }).passthrough()).nullish(),
            country: z.array(z.object({ name: optionalText }).passthrough()).nullish(),
            category: z.object({
                responsibilities: z.array(z.string()).nullish(), requirements: z.array(z.string()).nullish(),
                nice_to_have: z.array(z.string()).nullish(),
            }).passthrough().nullish(),
        }).passthrough()),
    }).passthrough(),
}).passthrough();
// EPAM's own id for Spain, from the country facet its search returns.
const EPAM_SPAIN = "4060741400034895894";
const list = (title, items) => items?.length ? `<h3>${title}</h3><ul>${items.map((item) => `<li>${item}</li>`).join("")}</ul>` : "";
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
    "epam-es": {
        host: "careers.epam.com",
        boardUrl: "https://careers.epam.com/en/jobs?country=Spain",
        async postings() {
            const out = [];
            for (let page = 0; page < MAX_PAGES; page += 1) {
                const params = new URLSearchParams({ facets: `country=${EPAM_SPAIN}`, from: String(page * 50), lang: "en", size: "50",
                    sortBy: "relevance", websiteLocale: "en-us" });
                const url = `https://${this.host}/api/jobs/v2/search/careers-i18n?${params}`;
                const body = parseSourcePayload(epamPage, await fetchJson(url, { allowedHosts: [this.host] }), "EPAM");
                out.push(...body.data.jobs);
                if (body.data.jobs.length === 0 || out.length >= body.data.total)
                    break;
            }
            return out.map((job) => {
                const remote = /remote/i.test(job.vacancy_type ?? "");
                const cities = (job.city ?? []).filter((city) => city.country?.name === "Spain").map((city) => place(city.name, "Spain"));
                const url = new URL(job.seo.url, `https://${this.host}/`).href;
                return {
                    externalId: job.uid, title: job.name, locations: cities.length && !remote ? cities : [...cities, "Remote, Spain"],
                    countries: ["ES"], url, applyUrl: url, postedAt: publishedDate(job.created_at),
                    descriptionHtml: [job.description ?? "", list("Responsibilities", job.category?.responsibilities),
                        list("Requirements", job.category?.requirements), list("Nice to have", job.category?.nice_to_have)].join("\n"),
                };
            });
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
