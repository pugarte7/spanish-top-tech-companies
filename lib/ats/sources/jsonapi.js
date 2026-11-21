import { z } from "zod";
import { AppError } from "../util/errors.js";
import { decodeEntitiesOnce } from "../text/html.js";
import { fetchJson, fetchText } from "./http.js";
import { boardVerification, nonEmptyText, normalizePublicJob, optionalText, parseSourcePayload, publishedDate, } from "./sourceValidation.js";
/**
 * Employers whose careers site reads its postings from a public JSON API of
 * their own. Each one is a tiny mapping here, named by the board:
 *
 *   capgemini-es    Capgemini's job stream, Spain only (country_code=es-es)
 *   sage            Sage's career search (every country; one call)
 *   schwarz-digits  Schwarz Digits' job search, its Spanish offices only
 *   epam-es         EPAM's career search, Spain only (its own country id)
 *   revolut         Revolut's careers page, every position in its __NEXT_DATA__, the Spanish ones kept
 *   bnp-paribas-es  BNP Paribas Spain's WordPress job list (bnpparibas.es), paged
 *   hiberus-es      hiberus' job offers (Drupal view), Spain only (field_country_target_id=183)
 *   management-solutions-es  Management Solutions' offers (ASP.NET page, every country), the Spanish ones kept
 *   caixabank-tech-es  CaixaBank Tech's WordPress job_locations pages (Barcelona, Madrid, Sevilla), paged
 *   ibm-es          IBM's career search (its Elasticsearch proxy), Spain only (country keyword)
 *   bsc-es          Barcelona Supercomputing Center's vacancies table (Drupal), all in Barcelona
 *   hitachi-energy-es  Hitachi Energy's own job list (AEM), Spain only (location=Spain)
 *
 * A mapping reads HTML with fetchText when the employer's site is
 * server-rendered and has no JSON of its own.
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
const revolutPage = z.object({
    props: z.object({
        pageProps: z.object({
            positions: z.array(z.object({
                id: nonEmptyText, text: nonEmptyText, description: optionalText,
                locations: z.array(z.object({ name: optionalText, type: optionalText, country: optionalText }).passthrough()),
            }).passthrough()),
        }).passthrough(),
    }).passthrough(),
}).passthrough();
const hitachiPage = z.object({
    totalNumber: z.number().int().nonnegative(),
    items: z.array(z.object({
        title: nonEmptyText, url: nonEmptyText, applyNowUrl: optionalText, location: optionalText,
        primaryLocation: optionalText, publicationDate: optionalText, remoteType: optionalText, jobType: optionalText,
    }).passthrough()),
}).passthrough();
const ibmPage = z.object({
    hits: z.object({
        total: z.object({ value: z.number().int().nonnegative() }).passthrough(),
        hits: z.array(z.object({
            _source: z.object({
                title: nonEmptyText, url: nonEmptyText, description: optionalText, dcdate: optionalText,
                field_text_01: z.union([z.number(), z.string()]).nullish(), field_keyword_17: optionalText, field_keyword_19: optionalText,
            }).passthrough(),
        }).passthrough()),
    }).passthrough(),
}).passthrough();
const list = (title, items) => items?.length ? `<h3>${title}</h3><ul>${items.map((item) => `<li>${item}</li>`).join("")}</ul>` : "";
/** A work-mode label ("Remote", "Hybrid", "On-site", "Presencial"...) as the normalizer's workplace type. */
function workplace(label) {
    if (/remot|teletrabajo/i.test(label ?? ""))
        return "remote";
    if (/hybrid|h[ií]brido|flexible/i.test(label ?? ""))
        return "hybrid";
    return /on-?site|office|presencial/i.test(label ?? "") ? "onsite" : "unknown";
}
const place = (city, country) => [city?.trim(), country].filter(Boolean).join(", ");
/** Plain text of an HTML fragment, entities decoded once. */
const text = (html) => decodeEntitiesOnce(String(html ?? "").replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
/** The JSON a Next.js page embeds in script#__NEXT_DATA__. */
function nextData(html, source) {
    const json = /<script id="__NEXT_DATA__" type="application\/json"[^>]*>([\s\S]*?)<\/script>/.exec(html)?.[1];
    if (!json)
        throw new AppError("invalid_source_payload", `${source} page has no __NEXT_DATA__`);
    return JSON.parse(json);
}
/** Revolut's posting URL: the title lowercased, runs of anything else turned into "-", then the id. */
const revolutSlug = (title) => title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
/** BNP Paribas Spain's cards: a.crd__link (title, URL), p.crd__type, p.crd__location ("ES-Madrid-Madrid"). */
export function parseBnpParibasCards(html) {
    const cards = [];
    for (const card of String(html).matchAll(/<li class="block-job">([\s\S]*?)<\/li>/gi)) {
        const link = /<a class="crd__link" href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i.exec(card[1]);
        const url = link ? decodeEntitiesOnce(link[1]) : "";
        const id = /\/jobs\/([^/?#]+)/.exec(url)?.[1];
        if (!id)
            continue;
        const [country, ...parts] = text(/<p class="crd__location">([\s\S]*?)<\/p>/i.exec(card[1])?.[1]).split("-").map((part) => part.trim());
        cards.push({ id, url, title: text(link[2]), type: text(/<p class="crd__type">([\s\S]*?)<\/p>/i.exec(card[1])?.[1]),
            city: [...new Set(parts.filter(Boolean))].join(", "), country: country ?? "" });
    }
    return cards;
}
/** BSC's table rows: the reference links to the posting, the next cell holds the title. */
export function parseBscRows(html) {
    const rows = [];
    for (const row of String(html).matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
        const link = /<td class="views-field views-field-title"\s*>\s*<a href="(\/join-us\/job-opportunities\/[^"]+)">([\s\S]*?)<\/a>/i.exec(row[1]);
        const title = text(/<td class="views-field views-field-field-jobref"\s*>([\s\S]*?)<\/td>/i.exec(row[1])?.[1]);
        if (link && title)
            rows.push({ path: decodeEntitiesOnce(link[1]), reference: text(link[2]), title });
    }
    return rows;
}
/** hiberus' teasers: article.node__job-offer with the node id, the title field, location and work-mode fields and a link. */
export function parseHiberusOffers(html) {
    const offers = [];
    for (const card of String(html).matchAll(/<article\s+data-history-node-id="(\d+)" class="node node__job-offer[^"]*"[^>]*>([\s\S]*?)<\/article>/gi)) {
        const item = (name) => text(new RegExp(`field--name-${name}[\\s\\S]*?<div class="field__item">([\\s\\S]*?)</div>`, "i").exec(card[2])?.[1]);
        const path = /href="(\/unete\/ofertas-de-empleo\/[^"]+)"/i.exec(card[2])?.[1];
        const title = text(/field--name-title[^>]*>([\s\S]*?)<\/div>/i.exec(card[2])?.[1]);
        if (path && title)
            offers.push({ id: card[1], title, path: decodeEntitiesOnce(path), location: item("field-location"), mode: item("field-work-modality") });
    }
    return offers;
}
/**
 * Management Solutions' offers, one block between <hr /> each: span#MainContent_paisN (country), the
 * VerOfertas.aspx?num= link (title in capitals, city appended), span#MainContent_provinciaN ("Madrid &nbsp;/"),
 * span#MainContent_tipoN (Graduate, Internship, Experienced).
 */
export function parseManagementSolutionsOffers(html) {
    const offers = [];
    for (const block of String(html).split(/<hr\s*\/?>/i)) {
        const link = /<a id="MainContent_\d+" href="VerOfertas\.aspx\?num=(\d+)">([\s\S]*?)<\/a>/i.exec(block);
        if (!link)
            continue;
        const span = (name) => text(new RegExp(`<span id="MainContent_${name}\\d+"[^>]*>([\\s\\S]*?)</span>`, "i").exec(block)?.[1])
            .replace(/[\s\u00a0]*\/[\s\u00a0]*$/, "").trim();
        offers.push({ id: link[1], title: text(link[2]), country: span("pais"), city: span("provincia"), type: span("tipo") });
    }
    return offers;
}
/** CaixaBank Tech's cards: a.join-us-cards__card-taglink (URL, h3 title), then one icon-map link per city. */
export function parseCaixaBankTechCards(html) {
    const cards = [];
    for (const card of String(html).split(/<div class="join-us-cards__card">/i).slice(1)) {
        const link = /<a href="(\/es\/job\/[^"]+)" class="join-us-cards__card-taglink">\s*<h3[^>]*>([\s\S]*?)<\/h3>/i.exec(card);
        if (!link)
            continue;
        // The cities are printed twice (desktop and mobile): read the desktop row only.
        const row = /<div class="d-none d-md-flex">([\s\S]*?)<\/div>/i.exec(card)?.[1] ?? "";
        const cities = [...row.matchAll(/<i class="icon-map[^"]*"><\/i>([\s\S]*?)<\/a>/gi)].map((city) => text(city[1])).filter(Boolean);
        cards.push({ path: decodeEntitiesOnce(link[1]), title: text(link[2].replace(/&nbsp(?!;)/g, " ")), cities });
    }
    return cards;
}
const MAPPINGS = {
    revolut: {
        host: "www.revolut.com",
        boardUrl: "https://www.revolut.com/careers/",
        async postings() {
            // robots.txt disallows queries, so the page is read bare; it embeds every position.
            const html = await fetchText(this.boardUrl, { allowedHosts: [this.host] });
            const positions = parseSourcePayload(revolutPage, nextData(html, "Revolut"), "Revolut").props.pageProps.positions;
            return positions.filter((job) => job.locations.some((location) => location.country === "Spain")).map((job) => {
                const url = `https://${this.host}/careers/position/${revolutSlug(job.text)}-${job.id}/`;
                return {
                    externalId: job.id, title: job.text, url, applyUrl: url, descriptionHtml: job.description ?? "",
                    countries: ["ES"],
                    locations: job.locations.filter((location) => location.country === "Spain")
                        .map((location) => location.type === "remote" ? "Remote, Spain" : place(location.name, "Spain")),
                };
            });
        },
    },
    "hitachi-energy-es": {
        host: "www.hitachienergy.com",
        boardUrl: "https://www.hitachienergy.com/careers/open-jobs?location=Spain",
        async postings() {
            const out = [];
            for (let page = 0; page < MAX_PAGES; page += 1) {
                const offset = String(out.length);
                const params = new URLSearchParams({ location: "Spain", offset, calculatedOffset: offset });
                const url = `https://${this.host}/careers/open-jobs/_jcr_content/root/container/content_1/content/grid_0/joblist.listsearchresults.json?${params}`;
                const body = parseSourcePayload(hitachiPage, await fetchJson(url, { allowedHosts: [this.host] }), "Hitachi Energy");
                out.push(...body.items);
                if (body.items.length === 0 || out.length >= body.totalNumber)
                    break;
            }
            return out.map((job) => {
                const id = /\/details\/([^/?#]+)/.exec(job.url)?.[1] ?? job.url;
                const locations = (job.location || job.primaryLocation || "").split(";").map((value) => value.trim());
                return {
                    externalId: id, title: job.title, locations, countries: [], url: job.url, applyUrl: job.applyNowUrl || job.url,
                    descriptionHtml: "", postedAt: publishedDate(job.publicationDate), employmentType: job.jobType ?? undefined,
                    workplaceType: workplace(job.remoteType),
                };
            });
        },
    },
    "hiberus-es": {
        host: "www.hiberus.com",
        boardUrl: "https://www.hiberus.com/unete/ofertas-de-empleo?field_country_target_id=183",
        async postings() {
            // 183 is the view's term for Spain; every offer is on one page.
            const html = await fetchText(this.boardUrl, { allowedHosts: [this.host] });
            return parseHiberusOffers(html).map((offer) => {
                const url = `https://${this.host}${offer.path}`;
                // The location field says "Varias localizaciones": the filter is what places them in Spain.
                const city = /varias/i.test(offer.location) ? "" : offer.location;
                return { externalId: offer.id, title: offer.title, locations: [place(city, "Spain")], countries: ["ES"], url,
                    applyUrl: url, descriptionHtml: "", workplaceType: workplace(offer.mode) };
            });
        },
    },
    "management-solutions-es": {
        host: "recruiting.managementsolutions.com",
        boardUrl: "https://recruiting.managementsolutions.com/",
        async postings() {
            // The country filter is an ASP.NET postback; the page itself lists every country.
            const html = await fetchText(this.boardUrl, { allowedHosts: [this.host] });
            return parseManagementSolutionsOffers(html).filter((offer) => offer.country === "Spain").map((offer) => {
                const url = `https://${this.host}/VerOfertas.aspx?num=${offer.id}`;
                return { externalId: offer.id, title: offer.title, locations: [place(offer.city, "Spain")], countries: ["ES"], url,
                    applyUrl: url, descriptionHtml: "", employmentType: /intern/i.test(offer.type) ? "internship" : undefined };
            });
        },
    },
    "caixabank-tech-es": {
        host: "www.caixabanktech.com",
        boardUrl: "https://www.caixabanktech.com/es/join-us-es/",
        async postings() {
            // The join-us page shows a few; each city's taxonomy page lists its jobs four at a time.
            const html = await fetchText(this.boardUrl, { allowedHosts: [this.host] });
            const cityPaths = [...new Set([...html.matchAll(/href="(\/es\/job_locations\/[a-z0-9-]+\/)"/gi)].map((match) => match[1]))];
            const cards = new Map(parseCaixaBankTechCards(html).map((card) => [card.path, card]));
            for (const path of cityPaths) {
                for (let page = 1; page <= MAX_PAGES; page += 1) {
                    const url = `https://${this.host}${path}${page === 1 ? "" : `page/${page}/`}`;
                    // Past the last page WordPress answers 404.
                    const listing = await fetchText(url, { allowedHosts: [this.host] }).catch((error) => {
                        if (page > 1 && error instanceof AppError && error.code === "not_found")
                            return "";
                        throw error;
                    });
                    const found = parseCaixaBankTechCards(listing);
                    if (found.length === 0)
                        break;
                    for (const card of found)
                        cards.set(card.path, card);
                }
            }
            return [...cards.values()].map((card) => {
                const url = `https://${this.host}${card.path}`;
                return { externalId: card.path.split("/").filter(Boolean).pop(), title: card.title, countries: ["ES"], url, applyUrl: url,
                    locations: card.cities.length ? card.cities.map((city) => place(city, "Spain")) : ["Spain"], descriptionHtml: "" };
            });
        },
    },
    "ibm-es": {
        host: "www-api.ibm.com",
        boardUrl: "https://www.ibm.com/careers/search?field_keyword_05[0]=Spain",
        async postings() {
            const out = [];
            for (let page = 0; page < MAX_PAGES; page += 1) {
                // field_keyword_05 is the country; without _source the hits come back empty.
                const body = parseSourcePayload(ibmPage, await fetchJson(`https://${this.host}/search/api/v2`, {
                    allowedHosts: [this.host],
                    body: { appId: "careers", scopes: ["careers2"], query: { bool: { must: [] } },
                        post_filter: { term: { field_keyword_05: "Spain" } }, size: 50, from: out.length,
                        _source: ["title", "url", "description", "dcdate", "field_text_01", "field_keyword_17", "field_keyword_19"] },
                }), "IBM");
                out.push(...body.hits.hits.map((hit) => hit._source));
                if (body.hits.hits.length === 0 || out.length >= body.hits.total.value)
                    break;
            }
            return out.map((job) => {
                // "Madrid, ES"
                const city = (job.field_keyword_19 ?? "").replace(/,\s*ES$/i, "");
                return { externalId: String(job.field_text_01 ?? job.url.split("=").pop()), title: job.title,
                    locations: [place(city, "Spain")], countries: ["ES"], url: job.url, applyUrl: job.url,
                    descriptionHtml: job.description ?? "", postedAt: publishedDate(job.dcdate), workplaceType: workplace(job.field_keyword_17) };
            });
        },
    },
    "bsc-es": {
        host: "www.bsc.es",
        boardUrl: "https://www.bsc.es/about-bsc/employment/vacancies",
        async postings() {
            // One table, no pager. BSC is one site in Barcelona, so the rows name no place.
            const html = await fetchText(this.boardUrl, { allowedHosts: [this.host] });
            return parseBscRows(html).map((row) => {
                const url = `https://${this.host}${row.path}`;
                return { externalId: row.reference || row.path.split("/").pop(), title: row.title, locations: ["Barcelona, Spain"],
                    countries: ["ES"], url, applyUrl: url, descriptionHtml: "" };
            });
        },
    },
    "bnp-paribas-es": {
        host: "www.bnpparibas.es",
        boardUrl: "https://www.bnpparibas.es/es/trabaja-con-nosotros-2/ofertas-de-trabajo/",
        async postings() {
            const cards = new Map();
            for (let page = 1; page <= MAX_PAGES; page += 1) {
                const html = await fetchText(page === 1 ? this.boardUrl : `${this.boardUrl}page/${page}/`, { allowedHosts: [this.host] });
                const found = parseBnpParibasCards(html).filter((card) => !cards.has(card.id));
                // Past the last page WordPress answers an empty list (or repeats one).
                if (found.length === 0)
                    break;
                for (const card of found)
                    cards.set(card.id, card);
            }
            return [...cards.values()].map((card) => ({
                externalId: card.id, title: card.title, url: card.url, applyUrl: card.url, descriptionHtml: "",
                locations: [place(card.city, card.country === "ES" ? "Spain" : card.country)], countries: card.country === "ES" ? ["ES"] : [],
                employmentType: /beca/i.test(card.type) ? "internship" : undefined,
            }));
        },
    },
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
        workplaceType: row.workplaceType ?? "unknown", isRemote: row.workplaceType === "remote", employmentType: row.employmentType,
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
