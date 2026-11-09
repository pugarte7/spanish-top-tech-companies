import { AppError } from "../util/errors.js";
import { fetchText } from "./http.js";
import { boardVerification, normalizePublicJob } from "./sourceValidation.js";
/**
 * Bending Spoons (jobs.bendingspoons.com), its own Next.js career site.
 *
 * The listing page embeds every open position in its `__NEXT_DATA__` script:
 * title, offices with their countries, whether the role can be remote, the
 * description in parts and the application form. The page is read whole; the
 * `_next/data/<buildId>/...` JSON the browser calls changes path with every
 * deploy, so it is not used.
 *
 * Board: the career site's host, `jobs.bendingspoons.com`.
 */
const HOST = "jobs.bendingspoons.com";
const MAX_BYTES = 8 * 1024 * 1024;
export function bendingSpoonsJobUrl(id) {
    return `https://${HOST}/positions/${encodeURIComponent(id)}`;
}
/** The page's `__NEXT_DATA__` payload, or null. */
export function nextData(html) {
    const match = /<script id="__NEXT_DATA__" type="application\/json"[^>]*>([\s\S]*?)<\/script>/.exec(html);
    if (!match?.[1])
        return null;
    try {
        return JSON.parse(match[1]);
    }
    catch {
        return null;
    }
}
export function parseBendingSpoonsList(html) {
    const list = nextData(html)?.props?.pageProps?.list;
    if (!Array.isArray(list))
        throw new AppError("source_schema", "Bending Spoons page carries no position list");
    return list.filter((position) => position && typeof position === "object" && typeof position.id === "string"
        && typeof position.jobTitle === "string");
}
/** "Madrid (Spain)" reads as "Madrid, Spain"; "New York (NY)" keeps the country from the office record. */
function officeLabel(office) {
    const country = office?.country?.name ?? "";
    const title = String(office?.title ?? "").trim();
    const city = title.replace(/\s*\([^)]*\)\s*$/, "").trim();
    return [city, country].filter(Boolean).join(", ");
}
export function bendingSpoonsLocations(position) {
    const offices = Array.isArray(position.officeLocations) ? position.officeLocations : [];
    const labels = offices.map(officeLabel).filter(Boolean);
    const countries = offices.map((office) => office?.country?.isoCode ?? "");
    // "Remote in the default countries" means the countries of its offices that allow remote work.
    const remote = [
        ...(position.availableAsRemoteInDefaultCountries ? offices.map((office) => office?.country).filter((c) => c?.enablesRemoteWork) : []),
        ...(Array.isArray(position.additionalRemoteWorkCountries) ? position.additionalRemoteWorkCountries : []),
    ].filter((country) => country?.name);
    for (const country of remote) {
        labels.push(`Remote, ${country.name}`);
        countries.push(country.isoCode ?? "");
    }
    return {
        labels: [...new Set(labels)],
        countries: [...new Set(countries.filter(Boolean))],
        workplaceType: remote.length && !offices.length ? "remote" : remote.length ? "hybrid" : "onsite",
    };
}
function descriptionHtml(position) {
    const items = (values) => (Array.isArray(values) ? values : [])
        .map((value) => typeof value === "string" ? value : `<strong>${value?.title ?? ""}</strong> ${value?.description ?? ""}`)
        .map((value) => `<li>${value}</li>`).join("");
    return [
        position.highLevelDescription ?? "",
        position.responsibilities?.length ? `<h3>Responsibilities</h3><ul>${items(position.responsibilities)}</ul>` : "",
        position.requirements?.length ? `<h3>Requirements</h3><ul>${items(position.requirements)}</ul>` : "",
        position.sellingPoints?.length ? `<h3>What we offer</h3><ul>${items(position.sellingPoints)}</ul>` : "",
    ].filter(Boolean).join("\n");
}
function normalizePosition(position, company, capturedAt) {
    const where = bendingSpoonsLocations(position);
    const url = bendingSpoonsJobUrl(position.id);
    const schedule = String(position.workSchedule ?? "");
    return normalizePublicJob({
        company, externalId: position.id, title: position.jobTitle, locations: where.labels,
        url, applyUrl: `${url}/apply`, descriptionHtml: descriptionHtml(position),
        workplaceType: where.workplaceType, isRemote: where.workplaceType === "remote",
        employmentType: schedule.startsWith("full_time") ? "full_time" : schedule || undefined,
    }, capturedAt, where.countries);
}
async function readPositions(company) {
    if (company.board !== HOST)
        throw new AppError("invalid_board", `bendingspoons board must be "${HOST}", got: ${company.board}`, { board: company.board });
    const html = await fetchText(`https://${HOST}/`, { allowedHosts: [HOST], maxBytes: MAX_BYTES });
    return parseBendingSpoonsList(html).filter((position) => position.status === "active" && position.isEvent !== true);
}
export const bendingSpoonsAdapter = {
    kind: "bendingspoons",
    listUrl: () => `https://${HOST}/`,
    boardUrl: () => `https://${HOST}/`,
    async listJobs(company, capturedAt) {
        return (await readPositions(company)).map((position) => normalizePosition(position, company, capturedAt));
    },
    async verifyBoard(company) {
        return boardVerification((await readPositions(company)).map((position) => position.jobTitle));
    },
    boardFromUrl(raw) {
        try {
            return new URL(raw).hostname.toLowerCase() === HOST ? { ats: "bendingspoons", board: HOST, region: "global" } : null;
        }
        catch {
            return null;
        }
    },
    probeUrls: () => [],
};
