import { AppError } from "../util/errors.js";
import { decodeEntitiesOnce } from "../text/html.js";
import { fetchText } from "./http.js";
import { boardVerification, normalizePublicJob } from "./sourceValidation.js";
/**
 * Bizneo career sites, on the employer's own host (jobs.izertis.com,
 * opportunities.altia.es).
 *
 * Board: the host. Query: the site's filter, Spain unless set
 * (`location=country:OuEd8Quq8vGV`, the same code on every Bizneo site).
 *
 * `/jobs` is server-rendered: one `a.job-card` per posting with its title and
 * spans for the city, when there is one, and the work mode. Pages follow the
 * "next" link until there is none. Posting pages carry no JSON-LD.
 */
const SPAIN = "location=country:OuEd8Quq8vGV";
const MAX_PAGES = 30;
const MODES = /^(?:presencial|h[ií]brido|remoto|teletrabajo(?:\/remoto)?|on-?site|hybrid|remote|in-?office)$/i;
const OPEN_APPLICATION = /^(?:¿?no encuentras|trabaja con nosotros|[úu]nete a nuestro equipo|candidatura espont[aá]nea|autocandidatura|open application)\b/i;
function host(company) {
    const value = String(company.board).trim().replace(/^https?:\/\//i, "").replace(/\/+$/, "").toLowerCase();
    if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(value))
        throw new AppError("invalid_board", `bizneo board must be the site's host, got: ${company.board}`, { board: company.board });
    return value;
}
const filter = (company) => company.query || SPAIN;
const spainOnly = (company) => filter(company).includes(SPAIN.split("=")[1]);
function pageUrl(company, page) {
    const params = new URLSearchParams(filter(company));
    params.set("page", String(page));
    return `https://${host(company)}/jobs?${params}`;
}
const text = (html) => decodeEntitiesOnce(html.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
export function parseBizneoCards(html) {
    const cards = [];
    for (const card of String(html).matchAll(/<a\b[^>]*class="job-card[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi)) {
        const title = text(/<div class="title">([\s\S]*?)<\/div>/i.exec(card[2])?.[1] ?? "");
        const spans = [...(/<div class="details">([\s\S]*?)<\/div>/i.exec(card[2])?.[1] ?? "").matchAll(/<span[^>]*>([\s\S]*?)<\/span>/gi)]
            .map((span) => text(span[1])).filter(Boolean);
        const url = decodeEntitiesOnce(card[1]);
        const id = /\/jobs\/([^/?#]+)/.exec(url)?.[1];
        if (!id || !title || OPEN_APPLICATION.test(title))
            continue;
        cards.push({ id, title, url, city: spans.find((span) => !MODES.test(span)) ?? "", mode: spans.find((span) => MODES.test(span)) ?? "" });
    }
    return cards;
}
const hasNext = (html) => /<a\b[^>]*rel="next"[^>]*class="next"/i.test(html);
async function readCards(company) {
    const cards = new Map();
    for (let page = 1; page <= MAX_PAGES; page += 1) {
        const html = await fetchText(pageUrl(company, page), { allowedHosts: [host(company)] });
        for (const card of parseBizneoCards(html))
            cards.set(card.id, card);
        if (!hasNext(html))
            break;
    }
    return [...cards.values()];
}
export const bizneoAdapter = {
    kind: "bizneo",
    listUrl: (company) => pageUrl(company, 1),
    boardUrl: (company) => `https://${host(company)}/jobs`,
    async listJobs(company, capturedAt) {
        return (await readCards(company)).map((card) => {
            const remote = /remot|teletrabajo/i.test(card.mode);
            const place = spainOnly(company) ? [card.city, "Spain"].filter(Boolean).join(", ") : card.city;
            return normalizePublicJob({
                company, externalId: card.id, title: card.title,
                locations: place ? [remote ? `Remote, ${place}` : place] : [],
                url: card.url, applyUrl: card.url, descriptionHtml: "",
                workplaceType: remote ? "remote" : /h[ií]brido|hybrid/i.test(card.mode) ? "hybrid" : /presencial|on-?site|office/i.test(card.mode) ? "onsite" : "unknown",
                isRemote: remote,
            }, capturedAt, spainOnly(company) ? ["ES"] : []);
        });
    },
    async verifyBoard(company) {
        return boardVerification((await readCards(company)).map((card) => card.title));
    },
    probeUrls: () => [],
    boardFromUrl: () => null,
};
