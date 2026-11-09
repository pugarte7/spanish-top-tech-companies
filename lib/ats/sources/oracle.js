import { AppError } from "../util/errors.js";
import { logger } from "../util/logger.js";
import { fetchJson } from "./http.js";
import { asString } from "./normalize.js";
import { boardVerification, locationLabel, normalizePublicJob, publishedDate } from "./sourceValidation.js";
/**
 * Oracle Recruiting Cloud (Oracle HCM "Candidate Experience") career sites.
 *
 * A site is a pod host plus a site number, both read off the employer's
 * career-site URL (`https://<host>/hcmUI/CandidateExperience/en/sites/<site>`),
 * so `company.board` carries them as `host/site`, e.g.
 * `jpmc.fa.oraclecloud.com/CX_1001`.
 *
 * The public REST resource lists requisitions 25 at a time with a short
 * summary; the description costs one more request per posting. Its `location`
 * filter is fuzzy (a Spain search returns some Indian postings), so it only
 * narrows the crawl and each posting keeps its own locations and country.
 */
const DEFAULT_LOCATION = "Spain";
const PAGE_SIZE = 25;
const HOST = /^[a-z0-9-]+(?:\.[a-z0-9-]+)*\.oraclecloud\.com$/;
const SITE = /^[A-Za-z0-9_-]{1,80}$/;
const RESOURCE = "hcmRestApi/resources/latest";
function capFrom(name, fallback) {
    const raw = Number.parseInt(process.env[name] ?? "", 10);
    return Number.isFinite(raw) && raw > 0 ? raw : fallback;
}
export function parseBoard(board) {
    const [host, site, ...rest] = board.split("/");
    if (rest.length || !HOST.test((host ?? "").toLowerCase()) || !SITE.test(site ?? "")) {
        throw new AppError("invalid_board", `oracle board must be "host/site" (e.g. jpmc.fa.oraclecloud.com/CX_1001), got: ${board}`, { board });
    }
    return { host: host.toLowerCase(), site };
}
// The finder's values are separated by commas, so a location cannot hold one.
const location = (company) => (company.query || DEFAULT_LOCATION).replace(/[,;"]/g, " ").trim();
function listUrl(site, company, offset, limit = PAGE_SIZE) {
    const finder = `findReqs;siteNumber=${site.site},location=${location(company)},limit=${limit},offset=${offset},sortBy=POSTING_DATES_DESC`;
    return `https://${site.host}/${RESOURCE}/recruitingCEJobRequisitions?onlyData=true&expand=requisitionList.secondaryLocations&finder=${encodeURIComponent(finder)}`;
}
function detailUrl(site, id) {
    const finder = `ById;Id="${id}",siteNumber=${site.site}`;
    return `https://${site.host}/${RESOURCE}/recruitingCEJobRequisitionDetails?expand=all&onlyData=true&finder=${encodeURIComponent(finder)}`;
}
const jobUrl = (site, id) => `https://${site.host}/hcmUI/CandidateExperience/en/sites/${site.site}/job/${id}`;
const get = (site, url, retries) => fetchJson(url, { allowedHosts: [site.host], ...(retries === undefined ? {} : { retries }) });
async function search(site, company, offset, limit, retries) {
    const payload = await get(site, listUrl(site, company, offset, limit), retries);
    const item = Array.isArray(payload?.items) ? payload.items[0] : undefined;
    if (!item || !Array.isArray(item.requisitionList)) {
        throw new AppError("invalid_source_payload", "Oracle answered without a requisitionList; the site number may be wrong");
    }
    return { list: item.requisitionList, total: typeof item.TotalJobsCount === "number" ? item.TotalJobsCount : null };
}
async function listRequisitions(company, site) {
    const cap = capFrom("ATS_ORACLE_MAX_POSTINGS", 300);
    const all = [];
    for (let offset = 0; all.length < cap; offset += PAGE_SIZE) {
        const { list, total } = await search(site, company, offset);
        all.push(...list.slice(0, cap - all.length));
        if (list.length < PAGE_SIZE || (total !== null && offset + PAGE_SIZE >= total))
            break;
    }
    return all;
}
async function detail(site, id) {
    try {
        const payload = await get(site, detailUrl(site, id));
        return Array.isArray(payload?.items) ? payload.items[0] ?? null : null;
    }
    catch (error) {
        // A requisition closed between the two calls must not lose the rest.
        logger.warn("oracle detail failed", { host: site.host, id, error: String(error) });
        return null;
    }
}
function workplace(value) {
    const text = asString(value).toLowerCase();
    if (text.includes("hybrid"))
        return "hybrid";
    if (text.includes("remote"))
        return "remote";
    return text.includes("site") || text.includes("office") ? "onsite" : "unknown";
}
function locations(req) {
    const secondary = Array.isArray(req.secondaryLocations) ? req.secondaryLocations : [];
    const labels = [asString(req.PrimaryLocation), ...secondary.map((loc) => asString(loc?.Name))]
        .map((value) => value.trim()).filter(Boolean);
    const countries = [asString(req.PrimaryLocationCountry), ...secondary.map((loc) => asString(loc?.CountryCode))].filter(Boolean);
    // A bare "Spain" posting still reads as Spain with its country attached.
    if (labels.length === 0 && countries.length)
        labels.push(locationLabel({ countryCode: countries[0] }));
    return { labels: [...new Set(labels)], countries };
}
function toJob(company, site, req, info, capturedAt) {
    const id = asString(req.Id);
    const where = locations(req);
    const type = workplace(info?.WorkplaceType || req.WorkplaceType || req.WorkplaceTypeCode);
    const url = jobUrl(site, id);
    const body = info
        ? [info.ExternalDescriptionStr, info.ExternalResponsibilitiesStr, info.ExternalQualificationsStr]
        : [req.ShortDescriptionStr, req.ExternalResponsibilitiesStr, req.ExternalQualificationsStr];
    return normalizePublicJob({
        company, externalId: id, title: asString(req.Title), locations: where.labels, url, applyUrl: url,
        descriptionHtml: body.map((part) => asString(part)).filter(Boolean).join("\n"),
        postedAt: publishedDate(asString(info?.ExternalPostedStartDate)) ?? publishedDate(asString(req.PostedDate)),
        workplaceType: type, isRemote: type === "remote",
        employmentType: asString(info?.JobSchedule) || undefined,
    }, capturedAt, where.countries);
}
export const oracleAdapter = {
    kind: "oracle",
    listUrl: (company) => listUrl(parseBoard(company.board), company, 0),
    boardUrl(company) {
        const site = parseBoard(company.board);
        return `https://${site.host}/hcmUI/CandidateExperience/en/sites/${site.site}`;
    },
    async listJobs(company, capturedAt) {
        const site = parseBoard(company.board);
        const reqs = await listRequisitions(company, site);
        let details = capFrom("ATS_ORACLE_MAX_DETAILS", 150);
        const jobs = [];
        for (const req of reqs) {
            const id = asString(req?.Id);
            if (!/^[A-Za-z0-9_-]{1,64}$/.test(id))
                continue;
            const info = details-- > 0 ? await detail(site, id) : null;
            jobs.push(toJob(company, site, req, info, capturedAt));
        }
        return jobs;
    },
    async verifyBoard(company) {
        const site = parseBoard(company.board);
        const { list, total } = await search(site, company, 0, 5, 0);
        return boardVerification(list.map((req) => asString(req.Title)).filter(Boolean), total ?? list.length);
    },
    probeUrls: () => [],
    /** `https://<host>.oraclecloud.com/hcmUI/CandidateExperience/<lang>/sites/<site>/...` */
    boardFromUrl(raw) {
        let url;
        try {
            url = new URL(raw);
        }
        catch {
            return null;
        }
        const host = url.hostname.toLowerCase();
        const match = /^\/hcmUI\/CandidateExperience\/[A-Za-z_-]+\/sites\/([A-Za-z0-9_-]+)/.exec(url.pathname);
        return HOST.test(host) && match && SITE.test(match[1])
            ? { ats: "oracle", board: `${host}/${match[1]}`, region: "global" } : null;
    },
    /** A careers page linking its Oracle site. */
    boardFromPage(_pageUrl, html) {
        const links = html.replace(/&amp;/g, "&")
            .matchAll(/https?:\/\/[a-z0-9.-]+\.oraclecloud\.com\/hcmUI\/CandidateExperience\/[^\s"'<>)\\]*/gi);
        for (const match of links) {
            const board = oracleAdapter.boardFromUrl(match[0]);
            if (board)
                return board;
        }
        return null;
    },
};
