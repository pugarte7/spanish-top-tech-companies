import { AppError } from "../util/errors.js";
import { decodeEntitiesOnce } from "../text/html.js";
import { fetchText } from "./http.js";
import { boardVerification, normalizePublicJob } from "./sourceValidation.js";
/**
 * Avature career portals, on `<tenant>.avature.net` or the employer's own
 * domain (jobs.siemens.com).
 *
 * Board: the portal's host and path up to `/SearchJobs`, e.g.
 * `jobs.siemens.com/en_US/externaljobs` or `mercadona.avature.net/es_ES/Careers`;
 * a portal whose search page has another name ends with it
 * (`jobs.siemens-energy.com/en_US/jobs/SearchJobsSpain`).
 * Query: the portal's keyword search, "Spain" unless set; "-" reads every
 * posting, for a portal that only lists Spain; a query with "=" is the
 * portal's own filter parameters (its country field), sent as they are.
 *
 * The search page is server-rendered: one `article--result` per posting with
 * its JobDetail link, title and a subtitle that starts with the place. A
 * portal shows a fixed number per page (6 at Siemens) and pages with the
 * offset its own pagination links name (folderOffset or jobOffset). The
 * posting pages carry no JSON-LD, so no description is read.
 */
const DEFAULT_QUERY = "Spain";
const MAX_PAGES = 40;
function parseBoard(board) {
    const [host, ...rest] = String(board).trim().replace(/^https?:\/\//i, "").replace(/\/+$/, "").split("/");
    if (!/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(host ?? "") || rest.length === 0 || rest.some((part) => !/^[A-Za-z0-9_-]+$/.test(part))) {
        throw new AppError("invalid_board", `avature board must be "<host>/<portal path>", got: ${board}`, { board });
    }
    const search = /^SearchJobs\w*$/.test(rest.at(-1)) ? rest.pop() : "SearchJobs";
    if (rest.length === 0)
        throw new AppError("invalid_board", `avature board must be "<host>/<portal path>", got: ${board}`, { board });
    return { host: host.toLowerCase(), base: `https://${[host.toLowerCase(), ...rest].join("/")}`, search };
}
const isFilter = (company) => (company.query ?? "").includes("=");
const keyword = (company) => company.query === "-" || isFilter(company) ? "" : (company.query || DEFAULT_QUERY);
function searchUrl(company, offset, offsetParam = "folderOffset") {
    const params = isFilter(company) ? new URLSearchParams(company.query) : new URLSearchParams({ search: keyword(company) });
    if (offset > 0)
        params.set(offsetParam, String(offset));
    const { base, search } = parseBoard(company.board);
    return `${base}/${search}/?${params}`;
}
const text = (html) => decodeEntitiesOnce(html.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
/** The postings on one search page. */
export function parseAvatureResults(html) {
    const found = new Map();
    for (const article of String(html).matchAll(/<article\b[^>]*\barticle--result\b[\s\S]*?<\/article>/gi)) {
        const link = /<a\b[^>]*href="([^"]*\/(?:Job|Folder)Detail\/[^"]*)"[^>]*>([\s\S]*?)<\/a>/i.exec(article[0]);
        if (!link)
            continue;
        const url = decodeEntitiesOnce(link[1]);
        const id = /\/(?:Job|Folder)Detail\/(?:[^/?#]+\/)?(\d+)/.exec(url)?.[1];
        const title = text(link[2]);
        if (!id || !title || found.has(id))
            continue;
        const subtitle = /article__header__text__subtitle"[^>]*>([\s\S]*?)<\/div>/i.exec(article[0])?.[1] ?? "";
        const place = text(subtitle).split(/\s*[•|]\s*|\s+Job ID\b/)[0].replace(/\s+,/g, ",").trim();
        found.set(id, { id, title, place, url });
    }
    return [...found.values()];
}
/** The offset parameter the portal's own pagination links use. */
export function offsetParam(html) {
    return /SearchJobs\/[^"]*?[?&;](folderOffset|jobOffset|listOffset)=\d+/.exec(String(html))?.[1] ?? "folderOffset";
}
function totalResults(html) {
    const total = Number.parseInt((/([\d.,]+)\s+(?:results?|resultados?|jobs?|ofertas?)\b/i.exec(html)?.[1] ?? "").replace(/[.,]/g, ""), 10);
    return Number.isFinite(total) ? total : null;
}
/** A keyword search for Spain matched it: an unplaced posting, or a bare city, is in Spain. */
export function avaturePlace(place, company) {
    const label = place && !/^multiple locations$|^varias ubicaciones$/i.test(place) ? place : "";
    // A portal's own Spain search page (SearchJobsSpain) lists Spain only.
    const spain = keyword(company).toLowerCase() === "spain" || /Spain$/.test(parseBoard(company.board).search);
    if (!spain || label.includes(",") || /\b(spain|españa|espana)\b/i.test(label))
        return label;
    return [label, "Spain"].filter(Boolean).join(", ");
}
async function readList(company) {
    const { host } = parseBoard(company.board);
    const postings = new Map();
    let offset = 0;
    let total = null;
    let param;
    for (let page = 0; page < MAX_PAGES; page += 1) {
        const html = await fetchText(searchUrl(company, offset, param), { allowedHosts: [host] });
        total ??= totalResults(html);
        param ??= offsetParam(html);
        const rows = parseAvatureResults(html);
        const before = postings.size;
        for (const row of rows)
            postings.set(row.id, row);
        offset += rows.length;
        if (rows.length === 0 || postings.size === before || (total !== null && offset >= total))
            break;
    }
    return [...postings.values()];
}
export const avatureAdapter = {
    kind: "avature",
    listUrl: (company) => searchUrl(company, 0),
    boardUrl: (company) => `${parseBoard(company.board).base}/${parseBoard(company.board).search}`,
    async listJobs(company, capturedAt) {
        return (await readList(company)).map((posting) => {
            const place = avaturePlace(posting.place, company);
            return normalizePublicJob({
                company, externalId: posting.id, title: posting.title, locations: place ? [place] : [],
                url: posting.url, applyUrl: posting.url, descriptionHtml: "",
                workplaceType: /\bremote\b/i.test(place) ? "remote" : "unknown", isRemote: /\bremote\b/i.test(place),
            }, capturedAt, []);
        });
    },
    async verifyBoard(company) {
        return boardVerification((await readList(company)).map((posting) => posting.title));
    },
    probeUrls: () => [],
    /** `https://<tenant>.avature.net/<path>/SearchJobs|JobDetail/...` */
    boardFromUrl(raw) {
        try {
            const url = new URL(raw);
            if (!/^[a-z0-9-]+\.avature\.net$/i.test(url.hostname))
                return null;
            const path = /^(\/[A-Za-z0-9_\/-]+?)\/(?:SearchJobs|JobDetail)\b/.exec(url.pathname)?.[1];
            return path ? { ats: "avature", board: `${url.hostname.toLowerCase()}${path}`, region: "global" } : null;
        }
        catch {
            return null;
        }
    },
    boardFromPage(_pageUrl, html) {
        for (const match of String(html).matchAll(/https?:\/\/[a-z0-9-]+\.avature\.net\/[^\s"'<>)]*(?:SearchJobs|JobDetail)[^\s"'<>)]*/gi)) {
            const board = avatureAdapter.boardFromUrl(decodeEntitiesOnce(match[0]));
            if (board)
                return board;
        }
        return null;
    },
};
