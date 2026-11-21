import { XMLParser, XMLValidator } from "fast-xml-parser";
import { z } from "zod";
import { AppError } from "../util/errors.js";
import { decodeEntitiesOnce } from "../text/html.js";
import { fetchText } from "./http.js";
import { boardVerification, nonEmptyText, normalizePublicJob, optionalText, parseSourcePayload, postingIdentifier, publishedDate } from "./sourceValidation.js";
/**
 * Classic SAP SuccessFactors career sites, on SAP's own hosts
 * (career2.successfactors.eu/career?company=seidorcons), the ones that came
 * before the RMK sites `successfactors.js` reads. An RMK site that blocks this
 * client (jobs.sap.com) is often fed by one of these.
 *
 * Board: `<host>/<company id>`, e.g. `career2.successfactors.eu/seidorcons`
 * or `career5.successfactors.eu/SAP`. Query: the country of the postings whose
 * feed names none (seidorcons lists only Spanish provinces: "Spain").
 *
 * `career_ns=job_listing_summary&resultType=XML` is the public feed of every
 * posting the site lists, with its description, so one request reads the
 * whole board. Each posting carries the tenant's own filters as
 * `<filterN><label>…</label><value>…</value></filterN>`: which N holds the
 * country or the city differs per tenant, so they are told apart by label.
 * "Virtual - Germany" in a place is SAP's remote.
 */
const HOST = /^career[a-z0-9-]*\.successfactors\.(?:eu|com)$/;
const COMPANY = /^[A-Za-z0-9_-]{1,64}$/;
const COUNTRY_LABEL = /^(?:country|pa[ií]s|land|pays|paese)$/i;
const EXTRA_LABEL = /\b(?:additional|adicional(?:es)?|weitere)\b/i;
const PLACE_LABEL = /locat|ubicaci|provinc|city|ciudad|stadt|standort|^ort$|\bsite\b|office|oficina|sede/i;
const REMOTE = /^(?:virtual|remote|remoto)\s*[-–:]\s*/i;
function parseBoard(board) {
    const [rawHost, id, ...rest] = String(board).trim().replace(/^https?:\/\//i, "").replace(/\/+$/, "").split("/");
    const host = (rawHost ?? "").toLowerCase();
    if (!HOST.test(host) || !COMPANY.test(id ?? "") || rest.length > 0)
        throw new AppError("invalid_board", `sfclassic board must be "<careerN.successfactors.eu|com>/<company id>", got: ${board}`, { board });
    return { host, id };
}
const pageUrl = (company, params) => {
    const { host, id } = parseBoard(company.board);
    return `https://${host}/career?${new URLSearchParams({ company: id, ...params })}`;
};
const listUrl = (company) => pageUrl(company, { career_ns: "job_listing_summary", resultType: "XML" });
const postingUrl = (company, reqId) => pageUrl(company, { career_ns: "job_listing", navBarLevel: "JOB_SEARCH", career_job_req_id: reqId });
const filterSchema = z.object({ label: optionalText, value: optionalText }).passthrough();
const jobSchema = z.object({
    JobTitle: nonEmptyText, ReqId: postingIdentifier,
    "Job-Description": optionalText, "Posted-Date": optionalText, Division: optionalText,
}).catchall(z.unknown());
const feedSchema = z.object({
    "Job-Listing": z.union([z.literal(""), z.object({ Job: z.array(jobSchema) })]),
}).strict();
export function parseSfClassicFeed(xml) {
    const markup = xml.replace(/<!\[CDATA\[[\s\S]*?\]\]>|<!--[\s\S]*?-->/g, "");
    if (/<!\s*(?:DOCTYPE|ENTITY)\b/i.test(markup))
        throw new AppError("unsafe_xml", "SuccessFactors XML must not contain DOCTYPE or entity declarations");
    if (/&(?!(?:amp|lt|gt|quot|apos|#\d+|#x[\da-fA-F]+);)/.test(markup))
        throw new AppError("unsafe_xml", "SuccessFactors XML contains an undeclared entity");
    if (XMLValidator.validate(xml) !== true)
        throw new AppError("invalid_source_payload", "SuccessFactors returned malformed XML");
    const parser = new XMLParser({
        ignoreAttributes: true, ignoreDeclaration: true, parseTagValue: false,
        processEntities: true, trimValues: true,
        isArray: (_name, path) => path === "Job-Listing.Job",
    });
    const feed = parseSourcePayload(feedSchema, parser.parse(xml), "SuccessFactors XML");
    const jobs = feed["Job-Listing"] === "" ? [] : feed["Job-Listing"].Job;
    return jobs.map((job) => {
        const filters = Object.entries(job).filter(([key]) => /^filter\d+$/.test(key))
            .map(([, value]) => filterSchema.safeParse(value).data).filter(Boolean)
            .map((filter) => ({ label: (filter.label ?? "").trim(), value: decodeEntitiesOnce(filter.value ?? "").trim() }));
        const values = (test) => filters.filter((filter) => test(filter.label) && filter.value).map((filter) => filter.value);
        return {
            id: job.ReqId,
            // Titles come in CDATA with their entities still escaped ("AI &amp; Mobile").
            title: decodeEntitiesOnce(job.JobTitle).replace(/\s+/g, " ").trim(),
            descriptionHtml: job["Job-Description"] ?? "",
            postedAt: usDate(job["Posted-Date"]),
            country: values((label) => COUNTRY_LABEL.test(label))[0] ?? "",
            places: values((label) => PLACE_LABEL.test(label) && !EXTRA_LABEL.test(label) && !COUNTRY_LABEL.test(label)),
            extra: values((label) => EXTRA_LABEL.test(label)).flatMap((value) => value.split(/\s*[;|]\s*/)).filter(Boolean),
        };
    });
}
/** "01/21/2026", the feed's posting date, as an ISO date. */
function usDate(value) {
    const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(String(value ?? "").trim());
    return m ? publishedDate(`${m[3]}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`) : null;
}
/** The posting's places as location strings, the country appended when the place lacks it. */
export function sfClassicLocations(job, fallbackCountry = "") {
    const country = job.country || fallbackCountry;
    const own = (job.places.length ? job.places : [""]).map((place) => {
        const label = REMOTE.test(place) ? `Remote, ${place.replace(REMOTE, "")}` : place;
        return label && country && !label.toLowerCase().includes(country.toLowerCase()) ? `${label}, ${country}` : label || country;
    });
    // "Virtual - Global" is remote anywhere; "Virtual - Germany" names its country.
    const extra = job.extra.map((place) => REMOTE.test(place) ? `Remote, ${place.replace(REMOTE, "").replace(/^global$/i, "").trim()}`.replace(/, $/, "") : place);
    return [...new Set([...own, ...extra].filter(Boolean))];
}
async function readJobs(company) {
    const { host } = parseBoard(company.board);
    const xml = await fetchText(listUrl(company), { allowedHosts: [host], accept: "application/xml, text/xml" });
    return parseSfClassicFeed(xml);
}
export const sfclassicAdapter = {
    kind: "sfclassic",
    listUrl,
    boardUrl: (company) => pageUrl(company, { career_ns: "job_listing_summary", navBarLevel: "JOB_SEARCH" }),
    async listJobs(company, capturedAt) {
        const fallback = company.query?.trim() ?? "";
        return (await readJobs(company)).map((job) => {
            const locations = sfClassicLocations(job, fallback);
            const remote = locations.length > 0 && locations.every((label) => /^Remote\b/.test(label));
            const url = postingUrl(company, job.id);
            return normalizePublicJob({
                company, externalId: job.id, title: job.title, locations,
                url, applyUrl: url, descriptionHtml: job.descriptionHtml,
                postedAt: job.postedAt, workplaceType: remote ? "remote" : "unknown", isRemote: remote,
            }, capturedAt, [job.country || fallback].filter(Boolean));
        });
    },
    async verifyBoard(company) {
        return boardVerification((await readJobs(company)).map((job) => job.title));
    },
    probeUrls: () => [],
    /** `https://career2.successfactors.eu/career?company=seidorcons&…` -> `career2.successfactors.eu/seidorcons`. */
    boardFromUrl(raw) {
        try {
            const url = new URL(raw);
            const host = url.hostname.toLowerCase();
            const id = url.searchParams.get("company") ?? "";
            if (!HOST.test(host) || !COMPANY.test(id) || !/^\/(?:career|sfcareer\/)/i.test(url.pathname))
                return null;
            return { ats: "sfclassic", board: `${host}/${id}`, region: "global" };
        }
        catch {
            return null;
        }
    },
};
