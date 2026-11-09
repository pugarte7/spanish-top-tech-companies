import { AppError } from "../util/errors.js";
import { fetchJson } from "./http.js";
import { boardVerification, normalizePublicJob, publishedSalary } from "./sourceValidation.js";
/**
 * Pinpoint career sites: `<company>.pinpointhq.com`, or the employer's own
 * domain in front of it (jobs.aligntech.com).
 *
 * Board: the site's host. `https://<host>/postings.json` lists every open
 * posting with its location, workplace type and description.
 *
 * Location names are free text the employer types: "ESP Madrid" (ISO3 prefix),
 * "EMEA-Spain-Field based", "Remote/Spain". They are cut into place words so
 * the shared classifier can read them.
 */
const ISO3 = {
    ESP: "Spain", PRT: "Portugal", FRA: "France", DEU: "Germany", ITA: "Italy", GBR: "United Kingdom",
    IRL: "Ireland", NLD: "Netherlands", BEL: "Belgium", POL: "Poland", ROU: "Romania", CHE: "Switzerland",
    AUT: "Austria", SWE: "Sweden", DNK: "Denmark", NOR: "Norway", FIN: "Finland", CZE: "Czechia",
    USA: "United States", CAN: "Canada", MEX: "Mexico", BRA: "Brazil", ARG: "Argentina", CRI: "Costa Rica",
    IND: "India", PHL: "Philippines", AUS: "Australia", NZL: "New Zealand", SGP: "Singapore", JPN: "Japan",
    ARE: "United Arab Emirates", SAU: "Saudi Arabia", EGY: "Egypt", ZAF: "South Africa", SRB: "Serbia",
};
const NOISE = /^(?:emea|apac|latam|amer|americas|na|remote|field based|hybrid|onsite|on-site|office|hq)$/i;
function host(company) {
    const value = String(company.board).trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "");
    if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(value))
        throw new AppError("invalid_board", `pinpoint board must be a host, got: ${company.board}`, { board: company.board });
    return value;
}
/** "ESP Madrid" -> "Madrid, Spain"; "EMEA-Spain-Field based" -> "Spain". */
export function placeWords(name) {
    const words = [];
    for (const part of String(name ?? "").split(/\s*[-/|]\s*/)) {
        const iso = /^([A-Z]{3})\b\s*(.*)$/.exec(part.trim());
        if (iso && ISO3[iso[1]]) {
            if (iso[2])
                words.push(iso[2]);
            words.push(ISO3[iso[1]]);
        }
        else if (part.trim() && !NOISE.test(part.trim())) {
            words.push(part.trim());
        }
    }
    return words;
}
function label(location) {
    const city = /^(?:remote|field based)$/i.test(location?.city ?? "") ? "" : location?.city ?? "";
    const words = [city, location?.province ?? "", ...placeWords(location?.name)].map((w) => w.trim()).filter(Boolean);
    return [...new Map(words.map((w) => [w.toLowerCase(), w])).values()].join(", ");
}
async function readPostings(company) {
    const payload = await fetchJson(`https://${host(company)}/postings.json`, { allowedHosts: [host(company)] });
    const rows = Array.isArray(payload?.data) ? payload.data : [];
    return rows.filter((row) => row && row.id && typeof row.title === "string" && typeof row.url === "string");
}
function salary(row) {
    if (!row.compensation_visible)
        return null;
    return publishedSalary({
        min: row.compensation_minimum ?? null, max: row.compensation_maximum ?? null,
        currency: row.compensation_currency ?? "", period: row.compensation_frequency ?? "",
    });
}
export const pinpointAdapter = {
    kind: "pinpoint",
    listUrl: (company) => `https://${host(company)}/postings.json`,
    boardUrl: (company) => `https://${host(company)}`,
    async listJobs(company, capturedAt) {
        return (await readPostings(company)).map((row) => {
            const place = label(row.location);
            const remote = row.workplace_type === "remote";
            const country = placeWords(row.location?.name).find((w) => Object.values(ISO3).includes(w)) ?? "";
            return normalizePublicJob({
                company, externalId: String(row.id), title: row.title.trim(),
                locations: place ? [remote && !/remote/i.test(place) ? `Remote, ${place}` : place] : [],
                url: row.url, applyUrl: `${row.url.replace(/\/$/, "")}/applications/new`,
                descriptionHtml: [row.description, row.key_responsibilities, row.skills_knowledge_expertise, row.benefits]
                    .filter((part) => typeof part === "string").join("\n"),
                postedAt: null, workplaceType: ["remote", "hybrid", "onsite"].includes(row.workplace_type) ? row.workplace_type : "unknown",
                isRemote: remote, employmentType: row.employment_type ?? undefined,
                structuredCompensation: salary(row),
            }, capturedAt, country ? [country] : []);
        });
    },
    async verifyBoard(company) {
        return boardVerification((await readPostings(company)).map((row) => row.title));
    },
    probeUrls: () => [],
    boardFromUrl(raw) {
        try {
            const hostname = new URL(raw).hostname.toLowerCase();
            const sub = /^([a-z0-9-]+)\.pinpointhq\.com$/.exec(hostname)?.[1];
            return sub && !["app", "www", "api", "help", "status", "cdn"].includes(sub)
                ? { ats: "pinpoint", board: hostname, region: "global" } : null;
        }
        catch {
            return null;
        }
    },
    /** A link to a Pinpoint board, or the employer's own domain serving Pinpoint's app. */
    boardFromPage(pageUrl, html) {
        for (const match of String(html).matchAll(/https?:\/\/[a-z0-9-]+\.pinpointhq\.com[^\s"'<>)]*/gi)) {
            const board = pinpointAdapter.boardFromUrl(match[0]);
            if (board)
                return board;
        }
        try {
            const hostname = new URL(pageUrl).hostname.toLowerCase();
            return /app\.pinpointhq\.com|pinpoint-careers|data-pinpoint/i.test(html) && !hostname.endsWith("pinpointhq.com")
                ? { ats: "pinpoint", board: hostname, region: "global" } : null;
        }
        catch {
            return null;
        }
    },
};
