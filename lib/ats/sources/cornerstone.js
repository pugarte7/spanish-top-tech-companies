import { AppError } from "../util/errors.js";
import { fetchJson, fetchText } from "./http.js";
import { boardVerification, locationLabel, normalizePublicJob, publishedDate } from "./sourceValidation.js";
/**
 * Cornerstone OnDemand career sites (`<tenant>.csod.com/ux/ats/careersite/<id>`).
 *
 * Board: `<tenant>/<site id>`, e.g. `gmv/4`. The company's `query`, when set,
 * is the ISO country of postings the site publishes with no location at all
 * (Bankinter's branch roles), which only an employer hiring in one country
 * can be given.
 *
 * The career site page carries the anonymous visitor token its own search
 * uses, and the API host (`cloud`) for the tenant; the search is a POST to
 * `<cloud>/rec-job-search/external/jobs` with that token, exactly as the page
 * makes it. Each requisition comes with its description.
 */
const PAGE_SIZE = 100;
const MAX_PAGES = 30;
// Open applications and template rows are not postings.
const NOT_A_POSTING = /type here|env[ií]a tu cv|send (?:us )?your cv|candidatura espont[aá]nea|spontaneous application/i;
function parseBoard(board) {
    const match = /^([a-z0-9-]+)\/(\d+)$/i.exec(String(board).trim());
    if (!match)
        throw new AppError("invalid_board", `cornerstone board must be "<tenant>/<site id>", got: ${board}`, { board });
    return { tenant: match[1].toLowerCase(), site: Number(match[2]) };
}
const siteUrl = ({ tenant, site }) => `https://${tenant}.csod.com/ux/ats/careersite/${site}/home?c=${tenant}`;
async function session(board) {
    const html = await fetchText(`${siteUrl(board)}&lang=en-US`, { allowedHosts: [`${board.tenant}.csod.com`] });
    const token = /"token"\s*:\s*"([^"]+)"/.exec(html)?.[1];
    const cloud = /"cloud"\s*:\s*"(https:\/\/[a-z0-9-]+\.api\.csod\.com)\/?"/i.exec(html)?.[1] ?? "https://eu-fra.api.csod.com";
    if (!token)
        throw new AppError("invalid_source_payload", "Cornerstone career site page carries no search token");
    return { token, cloud };
}
async function readRequisitions(board) {
    const { token, cloud } = await session(board);
    const host = new URL(cloud).hostname;
    const all = [];
    for (let page = 1; page <= MAX_PAGES; page += 1) {
        const payload = await fetchJson(`${cloud}/rec-job-search/external/jobs`, {
            allowedHosts: [host],
            headers: { authorization: `Bearer ${token}` },
            body: {
                careerSiteId: board.site, careerSitePageId: board.site, pageNumber: page, pageSize: PAGE_SIZE,
                cultureId: 1, searchText: "", cultureName: "en-US", states: [], countryCodes: [], cities: [],
                placeID: "", radius: null, postingsWithinDays: null,
                customFieldCheckboxKeys: [], customFieldDropdowns: [], customFieldRadios: [],
            },
        });
        const data = payload?.data ?? {};
        const rows = Array.isArray(data.requisitions) ? data.requisitions : [];
        all.push(...rows);
        if (rows.length < PAGE_SIZE || all.length >= Number(data.totalCount ?? 0))
            break;
    }
    return all.filter((row) => row && row.requisitionId && typeof row.displayJobTitle === "string"
        && !NOT_A_POSTING.test(row.displayJobTitle));
}
function places(row, fallbackCountry) {
    const locations = Array.isArray(row.locations) ? row.locations : [];
    const labels = locations.map((l) => locationLabel({ city: l?.city, region: l?.state, countryCode: l?.country }))
        .filter(Boolean);
    const countries = locations.map((l) => String(l?.country ?? "")).filter(Boolean);
    if (labels.length === 0 && fallbackCountry)
        return { labels: [locationLabel({ countryCode: fallbackCountry })], countries: [fallbackCountry] };
    return { labels, countries };
}
export const cornerstoneAdapter = {
    kind: "cornerstone",
    listUrl: (company) => siteUrl(parseBoard(company.board)),
    boardUrl: (company) => siteUrl(parseBoard(company.board)),
    async listJobs(company, capturedAt) {
        const board = parseBoard(company.board);
        const fallback = /^[a-z]{2}$/i.test(company.query ?? "") ? company.query.toUpperCase() : "";
        return (await readRequisitions(board)).map((row) => {
            const { labels, countries } = places(row, fallback);
            const url = `https://${board.tenant}.csod.com/ux/ats/careersite/${board.site}/home/requisition/` +
                `${row.requisitionId}?c=${board.tenant}`;
            return normalizePublicJob({
                company, externalId: String(row.requisitionId), title: row.displayJobTitle.trim(),
                locations: labels, url, applyUrl: url,
                descriptionHtml: typeof row.externalDescription === "string" ? row.externalDescription : "",
                postedAt: publishedDate(row.postingEffectiveDate ?? undefined),
                workplaceType: "unknown", isRemote: false,
            }, capturedAt, countries);
        });
    },
    async verifyBoard(company) {
        return boardVerification((await readRequisitions(parseBoard(company.board))).map((row) => row.displayJobTitle));
    },
    probeUrls: () => [],
    /** `<tenant>.csod.com/ux/ats/careersite/<id>/...` or the older `/ATS/careersite/...?site=<id>&c=<tenant>`. */
    boardFromUrl(raw) {
        let url;
        try {
            url = new URL(String(raw).replace(/&amp;/g, "&"));
        }
        catch {
            return null;
        }
        const tenant = /^([a-z0-9-]+)\.csod\.com$/i.exec(url.hostname)?.[1];
        if (!tenant)
            return null;
        const site = /\/careersite\/(\d+)/i.exec(url.pathname)?.[1] ?? url.searchParams.get("site");
        return site && /^\d+$/.test(site) ? { ats: "cornerstone", board: `${tenant.toLowerCase()}/${site}`, region: "global" } : null;
    },
    /** A page linking its Cornerstone career site. */
    boardFromPage(_pageUrl, html) {
        for (const match of String(html).matchAll(/https?:\/\/[a-z0-9-]+\.csod\.com\/[^\s"'<>)]*careersite[^\s"'<>)]*/gi)) {
            const board = cornerstoneAdapter.boardFromUrl(match[0]);
            if (board)
                return board;
        }
        return null;
    },
};
