import { AppError } from "../util/errors.js";
import { fetchJson } from "./http.js";
import { boardToken, boardVerification, locationLabel, normalizePublicJob, publishedDate } from "./sourceValidation.js";
/**
 * BambooHR career sites: `<company>.bamboohr.com/careers`.
 *
 * Board: the subdomain (`wallbox`). `/careers/list` lists the open postings
 * with a city and sometimes a country; `/careers/<id>/detail` adds the
 * description, the date and the posting's address, read for the first
 * ATS_BAMBOOHR_MAX_DETAILS postings.
 *
 * The city field is free text: "City of London, UK#UK" carries its country
 * after the hash, and the state field often says "Hybrid" instead.
 */
const RESERVED = new Set(["www", "app", "api", "staticfe", "images", "images4", "help", "status", "marketplace", "partners"]);
function maxDetails() {
    const raw = Number.parseInt(process.env.ATS_BAMBOOHR_MAX_DETAILS ?? "", 10);
    return Number.isFinite(raw) && raw >= 0 ? raw : 60;
}
function host(company) {
    const token = boardToken(company.board, true);
    if (RESERVED.has(token))
        throw new AppError("invalid_board", `not a BambooHR company: ${company.board}`, { board: company.board });
    return `${token}.bamboohr.com`;
}
const blank = (value) => (typeof value === "string" ? value.trim() : "");
/** One place from the list row and, when read, the posting's own address. */
export function bambooPlace(row, detail) {
    const rawCity = blank(row?.location?.city) || blank(detail?.location?.city) || blank(row?.atsLocation?.city);
    const [city, hashCountry = ""] = rawCity.split("#");
    const state = blank(row?.location?.state) || blank(row?.atsLocation?.state);
    const country = blank(row?.atsLocation?.country) || hashCountry.trim()
        // The address country is only trusted when the city carries none of its own.
        || (!rawCity.includes("#") ? blank(detail?.location?.addressCountry) : "");
    return {
        label: locationLabel({ city: city.trim(), region: /^(?:hybrid|remote|on-?site)$/i.test(state) ? "" : state, country }),
        country,
        remote: row?.isRemote === true || /^remote$/i.test(state),
        hybrid: /^hybrid$/i.test(state),
    };
}
async function readList(company) {
    const payload = await fetchJson(`https://${host(company)}/careers/list`, { allowedHosts: [host(company)] });
    const rows = Array.isArray(payload?.result) ? payload.result : [];
    return rows.filter((row) => row && row.id && typeof row.jobOpeningName === "string");
}
export const bamboohrAdapter = {
    kind: "bamboohr",
    listUrl: (company) => `https://${host(company)}/careers/list`,
    boardUrl: (company) => `https://${host(company)}/careers`,
    async listJobs(company, capturedAt) {
        const rows = await readList(company);
        const limit = maxDetails();
        const jobs = [];
        for (const [index, row] of rows.entries()) {
            let detail = null;
            if (index < limit) {
                try {
                    const payload = await fetchJson(`https://${host(company)}/careers/${encodeURIComponent(row.id)}/detail`,
                        { allowedHosts: [host(company)], retries: 1 });
                    detail = payload?.result?.jobOpening ?? null;
                }
                catch {
                    detail = null;
                }
            }
            const place = bambooPlace(row, detail);
            const url = `https://${host(company)}/careers/${encodeURIComponent(row.id)}`;
            jobs.push(normalizePublicJob({
                company, externalId: String(row.id), title: row.jobOpeningName.trim(),
                locations: place.label ? [place.remote ? `Remote, ${place.label}` : place.label] : [],
                url, applyUrl: url,
                descriptionHtml: typeof detail?.description === "string" ? detail.description : "",
                postedAt: publishedDate(detail?.datePosted ?? undefined),
                workplaceType: place.remote ? "remote" : place.hybrid ? "hybrid" : "unknown", isRemote: place.remote,
                employmentType: row.employmentStatusLabel ?? undefined,
            }, capturedAt, place.country ? [place.country] : []));
        }
        return jobs;
    },
    async verifyBoard(company) {
        return boardVerification((await readList(company)).map((row) => row.jobOpeningName));
    },
    probeUrls: () => [],
    boardFromUrl(raw) {
        try {
            const url = new URL(raw);
            const sub = /^([a-z0-9-]+)\.bamboohr\.com$/i.exec(url.hostname)?.[1]?.toLowerCase();
            return sub && !RESERVED.has(sub) && /^\/(?:careers|jobs)\b/i.test(url.pathname)
                ? { ats: "bamboohr", board: sub, region: "global" } : null;
        }
        catch {
            return null;
        }
    },
    boardFromPage(_pageUrl, html) {
        for (const match of String(html).matchAll(/https?:\/\/[a-z0-9-]+\.bamboohr\.com\/(?:careers|jobs)[^\s"'<>)]*/gi)) {
            const board = bamboohrAdapter.boardFromUrl(match[0]);
            if (board)
                return board;
        }
        return null;
    },
};
