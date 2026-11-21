import { AppError } from "../util/errors.js";
import { decodeEntitiesOnce } from "../text/html.js";
import { fetchText } from "./http.js";
import { boardVerification, countryName, normalizePublicJob, publishedDate, publishedSalary } from "./sourceValidation.js";
/**
 * Classic iCIMS portals, `<portal>.icims.com/jobs` (expleo-jobs-es-en.icims.com,
 * worldwidecareers-bruker.icims.com). The Jibe "careers-home" sites with a
 * JSON search are icims.js.
 *
 * Board: the portal's host. Query: the portal's keyword search
 * (`searchKeyword`), empty unless set, for a portal that lists one country.
 *
 * `/jobs/search?in_iframe=1` is server-rendered (without in_iframe the page is
 * only the frame): one `li.iCIMS_JobCardItem` per posting, 20 to a page, paged
 * with `pr=0,1,...` until a page adds nothing. A card links `/jobs/<id>/...`
 * and carries the portal's fields as label/value pairs: "Job Locations" as
 * `CC-Region-City | CC-City`, sometimes a work mode or a pay range. Every
 * posting page carries JobPosting JSON-LD, read for the description and the
 * date on the first ATS_ICIMSCLASSIC_MAX_DETAILS postings.
 */
const MAX_PAGES = 30;
function maxDetails() {
    const raw = Number.parseInt(process.env.ATS_ICIMSCLASSIC_MAX_DETAILS ?? "", 10);
    return Number.isFinite(raw) && raw >= 0 ? raw : 60;
}
function host(company) {
    const value = String(company.board).trim().replace(/^https?:\/\//i, "").replace(/\/.*$/, "").toLowerCase();
    if (!/^[a-z0-9-]+\.icims\.com$/.test(value))
        throw new AppError("invalid_board", `icimsclassic board must be the portal's host (<portal>.icims.com), got: ${company.board}`, { board: company.board });
    return value;
}
function searchUrl(company, page) {
    const params = new URLSearchParams({ ss: "1", in_iframe: "1", pr: String(page) });
    if (company.query)
        params.set("searchKeyword", company.query);
    return `https://${host(company)}/jobs/search?${params}`;
}
const MARKS = { acute: "\u0301", grave: "\u0300", tilde: "\u0303", uml: "\u0308", circ: "\u0302", cedil: "\u0327" };
/** The shared decoder knows no accented letters, which Spanish portals write as entities (Le&oacute;n). */
function decode(value) {
    return decodeEntitiesOnce(String(value).replace(/&([a-zA-Z])(acute|grave|tilde|uml|circ|cedil);/g, (_m, letter, mark) => `${letter}${MARKS[mark]}`).normalize("NFC")
        .replace(/&iquest;/g, "¿").replace(/&iexcl;/g, "¡").replace(/&ordf;/g, "ª").replace(/&ordm;/g, "º").replace(/&euro;/g, "€"));
}
const text = (html) => decode(String(html).replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
/** The card's fields, label to value: dt/dd pairs and the header's labelled spans. */
function cardFields(card) {
    const fields = new Map();
    for (const pair of card.matchAll(/<dt\b[^>]*>([\s\S]*?)<\/dt>\s*<dd\b[^>]*>([\s\S]*?)<\/dd>/gi))
        fields.set(text(pair[1]).toLowerCase(), text(pair[2]));
    for (const pair of card.matchAll(/field-label">([^<]+)<\/span>\s*<span\b[^>]*>([\s\S]*?)<\/span>/gi)) {
        const label = text(pair[1]).toLowerCase();
        if (!fields.has(label))
            fields.set(label, text(pair[2]));
    }
    return fields;
}
/** "ES-MD-Madrid" -> "Madrid, Spain"; "ES-Remote" -> "Remote, Spain"; "PL" -> "Poland". */
export function icimsPlace(raw) {
    const value = raw.trim().replace(/\s+,/g, ",").replace(/[\s,]+$/, "");
    const match = /^([A-Z]{2})(?:-(.+))?$/.exec(value);
    if (!match)
        return value;
    // A region code (MD, CT, BA) between country and city says nothing the city does not.
    const city = (match[2] ?? "").replace(/^[A-Z0-9]{1,3}-(?=.)/, "");
    return [city, countryName(match[1])].filter(Boolean).join(", ");
}
/** "EUR €25,000.00/Yr." -> { currency, amount, period } */
function payField(value) {
    const match = /\b([A-Z]{3})\b[^\d]*([\d,]+(?:\.\d+)?)\s*(?:\/\s*(\w+))?/.exec(value ?? "");
    if (!match)
        return null;
    const period = /^(?:yr|year)/i.test(match[3] ?? "") ? "year" : /^(?:mo|month)/i.test(match[3] ?? "") ? "month" : /^(?:hr|hour)/i.test(match[3] ?? "") ? "hour" : null;
    return { currency: match[1], amount: match[2].replace(/,/g, ""), period };
}
/** "11/20/2026 6:16 AM", the card's posted date, in the portal's US format. */
function cardDate(card) {
    const match = /<span title="(\d{1,2})\/(\d{1,2})\/(\d{4}) [^"]*">/.exec(card);
    return match ? publishedDate(`${match[3]}-${match[1].padStart(2, "0")}-${match[2].padStart(2, "0")}`) : null;
}
/** The postings on one search page. */
export function parseIcimsCards(html, portalHost) {
    const cards = [];
    for (const item of String(html).matchAll(/<li class="iCIMS_JobCardItem">([\s\S]*?)<\/li>/gi)) {
        const card = item[1];
        const link = /<a\b([^>]*\bhref="([^"]*\/jobs\/(\d+)\/[^"]*)"[^>]*)>([\s\S]*?)<\/a>/i.exec(card);
        if (!link)
            continue;
        const id = link[3];
        // The anchor's title, "<id> - <title>", is plain text; the h3 has entities the shared decoder lacks.
        const label = /\btitle="([^"]*)"/.exec(link[1])?.[1];
        const title = label ? decode(label).replace(/^\d+\s*-\s*/, "").trim() : text(/<h3\b[^>]*>([\s\S]*?)<\/h3>/i.exec(link[4])?.[1] ?? "");
        if (!title)
            continue;
        const fields = cardFields(card);
        const places = [...new Set((fields.get("job locations") ?? "").split("|").map((place) => place.trim()).filter(Boolean).map(icimsPlace))];
        if (places.length === 0) {
            const country = fields.get("job location : country (full name)") ?? fields.get("country") ?? "";
            const city = fields.get("city") ?? "";
            const place = [city, country].filter(Boolean).join(", ");
            if (place)
                places.push(place);
        }
        // Posting links can name a sibling portal of the same employer; the board's host serves the posting too.
        const path = new URL(decodeEntitiesOnce(link[2]), `https://${portalHost}`).pathname;
        const low = payField(fields.get("salary minimum"));
        const high = payField(fields.get("salary maximum"));
        cards.push({
            id, title, places, url: `https://${portalHost}${path}`,
            workplace: fields.get("workplace") ?? fields.get("remote") ?? "",
            postedAt: cardDate(card),
            pay: low || high ? publishedSalary({
                min: low?.amount ?? null, max: high?.amount ?? null,
                currency: (low ?? high).currency, period: (low ?? high).period ?? undefined,
            }) : null,
        });
    }
    return cards;
}
function jobPosting(html) {
    for (const block of html.matchAll(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)) {
        try {
            const data = JSON.parse(block[1]);
            const items = Array.isArray(data) ? data : data["@graph"] ?? [data];
            const posting = items.find((item) => item && item["@type"] === "JobPosting");
            if (posting)
                return posting;
        }
        catch {
            // Malformed JSON-LD is common; the card's own fields still stand.
        }
    }
    return null;
}
async function readCards(company) {
    const portal = host(company);
    const cards = new Map();
    for (let page = 0; page < MAX_PAGES; page += 1) {
        const before = cards.size;
        for (const card of parseIcimsCards(await fetchText(searchUrl(company, page), { allowedHosts: [portal] }), portal))
            cards.set(card.id, card);
        if (cards.size === before)
            break;
    }
    return [...cards.values()];
}
export const icimsClassicAdapter = {
    kind: "icimsclassic",
    listUrl: (company) => searchUrl(company, 0),
    boardUrl: (company) => `https://${host(company)}/jobs/search?ss=1`,
    async listJobs(company, capturedAt) {
        const portal = host(company);
        const limit = maxDetails();
        const jobs = [];
        for (const [index, card] of (await readCards(company)).entries()) {
            let detail = null;
            if (index < limit) {
                try {
                    detail = jobPosting(await fetchText(`${card.url}?in_iframe=1`, { allowedHosts: [portal], retries: 1 }));
                }
                catch {
                    detail = null;
                }
            }
            const remote = /remote|remoto|teletrabajo/i.test(card.workplace) || (card.places.length > 0 && card.places.every((place) => /^remote\b/i.test(place)));
            jobs.push(normalizePublicJob({
                company, externalId: card.id, title: card.title, locations: card.places,
                url: card.url, applyUrl: card.url,
                descriptionHtml: typeof detail?.description === "string" ? detail.description : "",
                postedAt: publishedDate(typeof detail?.datePosted === "string" ? detail.datePosted : undefined) ?? card.postedAt,
                workplaceType: remote ? "remote" : /hybrid|h[ií]brido/i.test(card.workplace) ? "hybrid" : /on-?site|office|presencial/i.test(card.workplace) ? "onsite" : "unknown",
                isRemote: remote,
                structuredCompensation: card.pay,
            }, capturedAt, []));
        }
        return jobs;
    },
    async verifyBoard(company) {
        return boardVerification((await readCards(company)).map((card) => card.title));
    },
    probeUrls: () => [],
    /** `https://<portal>.icims.com/jobs/...` */
    boardFromUrl(raw) {
        try {
            const url = new URL(raw);
            if (!/^[a-z0-9-]+\.icims\.com$/i.test(url.hostname) || !url.pathname.startsWith("/jobs"))
                return null;
            return { ats: "icimsclassic", board: url.hostname.toLowerCase(), region: "global" };
        }
        catch {
            return null;
        }
    },
};
