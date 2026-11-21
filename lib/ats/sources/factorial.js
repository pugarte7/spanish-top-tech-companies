import { AppError } from "../util/errors.js";
import { decodeEntitiesOnce } from "../text/html.js";
import { logger } from "../util/logger.js";
import { fetchText } from "./http.js";
import { boardVerification, normalizePublicJob } from "./sourceValidation.js";
/**
 * Factorial career sites, on `<company>.factorial.es` or `.factorial.com`
 * (the `.factorialhr.com` address redirects there).
 *
 * Board: the site's host, e.g. `mvst.factorial.com`.
 *
 * The home page is server-rendered: one `li.job-offer-item` per posting with
 * its URL, a `data-location-key` ("city:barcelona" or "remote") and columns
 * for the title, the team and the work mode. Every posting is on that one
 * page. The key names a city only, so each posting page is read too (the
 * first ATS_FACTORIAL_MAX_DETAILS of them): it gives the place with its
 * country ("Hybrid (Munich / Augsburg, Germany)", "Gurb, Barcelona, Espanya")
 * and the description. Posting pages carry no JSON-LD and no date.
 */
const MODES = /^(?:presencial|h[ií]brid[oa]?|remot[oa]?|teletrabajo|on-?site|hybrid|remote|in-?office|full remote)$/i;
// The site writes the country in its own language.
const SPAIN_NAMES = /\b(?:españa|espanya|espainia|spanien|espagne|spagna|espanha)\b/giu;
const OPEN_APPLICATION = /^(?:candidatura espont[aàá]nea|autocandidatura|open application|spontaneous application|work with us|trabaja con nosotros|treballa amb nosaltres|[úu]nete a nuestro equipo)\b/i;
function maxDetails() {
    const raw = Number.parseInt(process.env.ATS_FACTORIAL_MAX_DETAILS ?? "", 10);
    return Number.isFinite(raw) && raw >= 0 ? raw : 150;
}
function host(company) {
    const value = String(company.board).trim().replace(/^https?:\/\//i, "").replace(/\/+$/, "").toLowerCase();
    if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(value))
        throw new AppError("invalid_board", `factorial board must be the site's host, got: ${company.board}`, { board: company.board });
    return value;
}
const text = (html) => decodeEntitiesOnce(html.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
const attr = (tag, name) => decodeEntitiesOnce(new RegExp(`\\b${name}='([^']*)'`).exec(tag)?.[1] ?? "");
/** The postings on a Factorial home page, with the location filter's labels for their keys. */
export function parseFactorialList(html) {
    const labels = new Map([...String(html).matchAll(/<option value='([^']+)'>([^<]*)<\/option>/g)]
        .map((option) => [decodeEntitiesOnce(option[1]), text(option[2])]));
    const postings = [];
    for (const item of String(html).matchAll(/<li class='job-offer-item[^']*'([^>]*)>([\s\S]*?)<\/li>/g)) {
        const url = attr(item[1], "data-job-postings-url");
        const id = /\/job_posting\/(?:[^/?#]*-)?(\d+)(?:[/?#]|$)/.exec(url)?.[1];
        const columns = [...item[2].matchAll(/<div class="text-sm[^"]*">([\s\S]*?)<\/div>/g)].map((column) => text(column[1]));
        const title = columns[0] ?? "";
        if (!id || !title || OPEN_APPLICATION.test(title))
            continue;
        const key = attr(item[1], "data-location-key");
        postings.push({
            id, title, url,
            city: key.startsWith("city:") ? (labels.get(key) ?? key.slice(5)) : "",
            remote: attr(item[1], "data-is-remote") === "true" || key === "remote",
            mode: columns.slice(1).find((column) => MODES.test(column)) ?? "",
        });
    }
    return postings;
}
/** The inner HTML of the element that opens at `start`, by counting nested divs. */
function innerDiv(html, start) {
    const open = html.indexOf(">", start) + 1;
    const tags = /<(\/?)div\b[^>]*>/gi;
    tags.lastIndex = open;
    for (let depth = 1, tag = tags.exec(html); tag; tag = tags.exec(html)) {
        depth += tag[1] ? -1 : 1;
        if (depth === 0)
            return html.slice(open, tag.index);
    }
    return "";
}
/** A posting page's place line, split into work mode and place, and its description. */
export function parseFactorialPosting(html) {
    const line = text(/<span class='self-start[^']*'>[\s\S]*?<\/span>\s*<span[^>]*>([\s\S]*?)<\/span>/.exec(html)?.[1] ?? "");
    const framed = /^([^()]+?)\s*\((.+)\)$/.exec(line);
    const [mode, place] = framed ? [framed[1], framed[2]] : MODES.test(line) ? [line, ""] : ["", line];
    const start = String(html).search(/<div class='styledText'>/);
    return {
        mode: MODES.test(mode) ? mode : "",
        place: place.replace(SPAIN_NAMES, "Spain"),
        descriptionHtml: start >= 0 ? innerDiv(html, start).trim() : "",
    };
}
async function readList(company) {
    return parseFactorialList(await fetchText(`https://${host(company)}/`, { allowedHosts: [host(company)] }));
}
async function readPosting(company, posting) {
    try {
        return parseFactorialPosting(await fetchText(posting.url, { allowedHosts: [host(company)], retries: 1 }));
    }
    catch (error) {
        if (error instanceof AppError && error.code === "not_found")
            return null;
        logger.warn("factorial posting page unreadable; keeping the list's city", { id: posting.id, error: String(error) });
        return { mode: "", place: "", descriptionHtml: "" };
    }
}
function workplace(mode, remote) {
    if (remote || /remot|teletrabajo/i.test(mode))
        return "remote";
    return /h[iíy]brid/i.test(mode) ? "hybrid" : /presencial|on-?site|office/i.test(mode) ? "onsite" : "unknown";
}
export const factorialAdapter = {
    kind: "factorial",
    listUrl: (company) => `https://${host(company)}/`,
    boardUrl: (company) => `https://${host(company)}/`,
    async listJobs(company, capturedAt) {
        const jobs = [];
        const postings = await readList(company);
        for (const [index, posting] of postings.entries()) {
            const detail = index < maxDetails() ? await readPosting(company, posting) : { mode: "", place: "", descriptionHtml: "" };
            // A posting that closed between the list and its page is gone.
            if (!detail)
                continue;
            const type = workplace(detail.mode || posting.mode, posting.remote);
            const place = detail.place || posting.city;
            const remote = type === "remote";
            jobs.push(normalizePublicJob({
                company, externalId: posting.id, title: posting.title,
                locations: [remote ? ["Remote", place].filter(Boolean).join(", ") : place].filter(Boolean),
                url: posting.url, applyUrl: posting.url.replace("/job_posting/", "/apply/"),
                descriptionHtml: detail.descriptionHtml,
                workplaceType: type, isRemote: remote,
            }, capturedAt, /\bSpain$/.test(place) ? ["ES"] : []));
        }
        return jobs;
    },
    async verifyBoard(company) {
        return boardVerification((await readList(company)).map((posting) => posting.title));
    },
    probeUrls: () => [],
    /** `https://<company>.factorial.es|com/...` */
    boardFromUrl(raw) {
        try {
            const url = new URL(raw);
            return /^[a-z0-9-]+\.factorial\.(?:es|com)$/i.test(url.hostname) ? { ats: "factorial", board: url.hostname.toLowerCase(), region: "global" } : null;
        }
        catch {
            return null;
        }
    },
};
