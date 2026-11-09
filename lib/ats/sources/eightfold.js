import { AppError } from "../util/errors.js";
import { logger } from "../util/logger.js";
import { fetchJson } from "./http.js";
import { asString, asStringArray, epochToIso } from "./normalize.js";
import { boardVerification, normalizePublicJob } from "./sourceValidation.js";
/**
 * Eightfold career sites.
 *
 * A site is a tenant host plus the employer's domain, which every API call
 * names, so `company.board` carries both as `host/domain`, e.g.
 * `astrazeneca.eightfold.ai/astrazeneca.com`. Neither can be derived from the
 * other (Deutsche Telekom is `telekom-growthhub.eightfold.ai/telekom.com`).
 *
 * Two APIs serve postings. Newer tenants answer `/api/pcsx/search` (ten per
 * page, no description) and refuse the older `/api/apply/v2/jobs` with 403;
 * older tenants answer only the latter, which carries the description. The
 * adapter tries the new one first. Both take a `location` filter that is
 * fuzzy, so it only narrows the crawl: each posting keeps its own locations
 * and the caller still decides what is in Spain.
 */
const DEFAULT_LOCATION = "Spain";
const PAGE_SIZE = 10;
const HOST = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/;
function capFrom(name, fallback) {
    const raw = Number.parseInt(process.env[name] ?? "", 10);
    return Number.isFinite(raw) && raw > 0 ? raw : fallback;
}
export function parseBoard(board) {
    const [host, domain, ...rest] = board.split("/");
    if (rest.length || !HOST.test(host ?? "") || !HOST.test(domain ?? "")) {
        throw new AppError("invalid_board", `eightfold board must be "host/domain" (e.g. astrazeneca.eightfold.ai/astrazeneca.com), got: ${board}`, { board });
    }
    return { host: host.toLowerCase(), domain: domain.toLowerCase() };
}
const location = (company) => company.query || DEFAULT_LOCATION;
function pcsxUrl(site, company, start) {
    const query = new URLSearchParams({ domain: site.domain, query: "", location: location(company), start: String(start) });
    return `https://${site.host}/api/pcsx/search?${query}`;
}
function v2Url(site, company, start) {
    const query = new URLSearchParams({ domain: site.domain, location: location(company), start: String(start), num: String(PAGE_SIZE) });
    return `https://${site.host}/api/apply/v2/jobs?${query}`;
}
const get = (site, url, retries) => fetchJson(url, { allowedHosts: [site.host], ...(retries === undefined ? {} : { retries }) });
/** One page from whichever API the tenant answers; `api` is remembered across pages. */
async function page(site, company, start, state, retries) {
    if (state.api !== "v2") {
        try {
            const payload = await get(site, pcsxUrl(site, company, start), retries);
            const data = payload?.data;
            if (data && Array.isArray(data.positions)) {
                state.api = "pcsx";
                return { positions: data.positions, count: typeof data.count === "number" ? data.count : null };
            }
        }
        catch (error) {
            if (state.api === "pcsx" || !(error instanceof AppError) || !["http_error", "not_found"].includes(error.code))
                throw error;
        }
    }
    state.api = "v2";
    const payload = await get(site, v2Url(site, company, start), retries);
    if (!payload || !Array.isArray(payload.positions)) {
        throw new AppError("invalid_source_payload", "Eightfold answered without a positions array");
    }
    return { positions: payload.positions, count: typeof payload.count === "number" ? payload.count : null };
}
async function listPositions(company, site) {
    const cap = capFrom("ATS_EIGHTFOLD_MAX_POSTINGS", 300);
    const state = { api: null };
    const all = [];
    for (let start = 0; all.length < cap; start += PAGE_SIZE) {
        const { positions, count } = await page(site, company, start, state);
        all.push(...positions.slice(0, cap - all.length));
        if (positions.length < PAGE_SIZE || (count !== null && start + PAGE_SIZE >= count))
            break;
    }
    return { positions: all, api: state.api };
}
/** "Barcelona, , Spain" reads as "Barcelona, Spain". */
const cleanLocation = (value) => value.split(",").map((part) => part.trim()).filter((part, i, all) => part && part !== all[i - 1]).join(", ");
function workplace(value) {
    const text = asString(value).toLowerCase();
    if (text.includes("hybrid"))
        return "hybrid";
    if (text.includes("remote"))
        return "remote";
    return text.includes("onsite") || text.includes("on-site") || text.includes("office") ? "onsite" : "unknown";
}
async function description(site, position) {
    const query = new URLSearchParams({ position_id: String(position.id), domain: site.domain, hl: "en" });
    try {
        const payload = await get(site, `https://${site.host}/api/pcsx/position_details?${query}`);
        return payload?.data ?? null;
    }
    catch (error) {
        // A closed posting must not lose the rest of the board.
        logger.warn("eightfold detail failed", { host: site.host, id: String(position.id), error: String(error) });
        return null;
    }
}
function toJob(company, site, position, detail, capturedAt) {
    const locations = [...new Set(asStringArray(position.locations).map(cleanLocation).filter(Boolean))];
    const fallback = cleanLocation(asString(position.location));
    const type = workplace(position.workLocationOption ?? position.work_location_option);
    const path = asString(position.positionUrl);
    const url = asString(detail?.publicUrl) || asString(position.canonicalPositionUrl)
        || (path.startsWith("/") ? `https://${site.host}${path}` : `https://${site.host}/careers/job/${position.id}?domain=${site.domain}`);
    return normalizePublicJob({
        company, externalId: String(position.id), title: asString(position.name) || asString(position.posting_name),
        locations: locations.length ? locations : fallback ? [fallback] : [],
        url, applyUrl: url,
        descriptionHtml: asString(detail?.jobDescription) || asString(position.job_description),
        postedAt: epochToIso(Number(position.postedTs || position.t_create) || undefined), workplaceType: type, isRemote: type === "remote",
    }, capturedAt, asStringArray(position.standardizedLocations).map((value) => value.split(",").pop()?.trim() ?? ""));
}
export const eightfoldAdapter = {
    kind: "eightfold",
    listUrl: (company) => pcsxUrl(parseBoard(company.board), company, 0),
    boardUrl(company) {
        const site = parseBoard(company.board);
        return `https://${site.host}/careers?domain=${encodeURIComponent(site.domain)}`;
    },
    async listJobs(company, capturedAt) {
        const site = parseBoard(company.board);
        const { positions, api } = await listPositions(company, site);
        // The new API lists no description; each one costs a request, so they are capped.
        let details = api === "pcsx" ? capFrom("ATS_EIGHTFOLD_MAX_DETAILS", 150) : 0;
        const jobs = [];
        for (const position of positions) {
            if (position?.id === undefined || position.id === null)
                continue;
            const detail = details-- > 0 ? await description(site, position) : null;
            jobs.push(toJob(company, site, position, detail, capturedAt));
        }
        return jobs;
    },
    async verifyBoard(company) {
        const site = parseBoard(company.board);
        const { positions, count } = await page(site, company, 0, { api: null }, 0);
        return boardVerification(positions.map((p) => asString(p.name) || asString(p.posting_name)).filter(Boolean), count ?? positions.length);
    },
    probeUrls: () => [],
    /** `https://<tenant>.eightfold.ai/careers?domain=<domain>`, the link employers publish. */
    boardFromUrl(raw) {
        let url;
        try {
            url = new URL(raw);
        }
        catch {
            return null;
        }
        const host = url.hostname.toLowerCase();
        const domain = (url.searchParams.get("domain") ?? "").toLowerCase();
        if (!host.endsWith(".eightfold.ai") || !HOST.test(domain))
            return null;
        return { ats: "eightfold", board: `${host}/${domain}`, region: "global" };
    },
    /** A careers page linking its Eightfold site, or an Eightfold page naming its domain. */
    boardFromPage(pageUrl, html) {
        for (const match of html.replace(/&amp;/g, "&").matchAll(/https?:\/\/[a-z0-9-]+\.eightfold\.ai\/careers[^\s"'<>)\\]*/gi)) {
            const board = eightfoldAdapter.boardFromUrl(match[0]);
            if (board)
                return board;
        }
        let host = "";
        try {
            host = new URL(pageUrl).hostname.toLowerCase();
        }
        catch {
            return null;
        }
        const domain = /"domain"\s*:\s*"([a-z0-9.-]+\.[a-z]{2,})"/i.exec(html)?.[1]?.toLowerCase();
        return host.endsWith(".eightfold.ai") && domain && HOST.test(domain)
            ? { ats: "eightfold", board: `${host}/${domain}`, region: "global" } : null;
    },
};
