import { fetchJson } from "./http.js";
import { asString, normalizeJob } from "./normalize.js";
/**
 * Greenhouse Job Board API (public, unauthenticated for reads).
 * https://developers.greenhouse.io/job-board.html
 *
 * Application submission through the API needs an employer-issued board key,
 * so candidates apply through the hosted form instead.
 */
const BASE = "https://boards-api.greenhouse.io/v1/boards";
function collectLocations(job) {
    const primary = asString(job.location?.name);
    const offices = (job.offices ?? [])
        .map((office) => asString(office.location) || asString(office.name))
        .filter((value) => value.length > 0 && value.toLowerCase() !== "n/a");
    return [...new Set([primary, ...offices].filter((value) => value.length > 0))];
}
function structuredPay(job) {
    const range = job.pay_input_ranges?.[0];
    if (!range)
        return null;
    const minCents = typeof range.min_cents === "number" ? range.min_cents : null;
    const maxCents = typeof range.max_cents === "number" ? range.max_cents : null;
    if (minCents === null && maxCents === null)
        return null;
    return {
        min: minCents === null ? null : minCents / 100,
        max: maxCents === null ? null : maxCents / 100,
        currency: (asString(range.currency_type, "USD") || "USD").toUpperCase().slice(0, 3),
        period: "year",
        source: "ats-structured",
        raw: asString(range.title, "greenhouse pay_input_ranges"),
    };
}
/**
 * Many employers point their Greenhouse board at their own careers site, so
 * `absolute_url` lands on a marketing page rather than a form — and on a host
 * outside the submission allowlist. Greenhouse still hosts the real
 * application at its embed endpoint, so prefer that whenever the posting id is
 * known. Falls back to the board's own URL when it is already a Greenhouse one.
 */
export function hostedApplyUrl(board, externalId, absoluteUrl) {
    if (!externalId)
        return absoluteUrl;
    if (isGreenhouseApplicationUrl(absoluteUrl))
        return absoluteUrl;
    return `https://job-boards.greenhouse.io/embed/job_app?for=${encodeURIComponent(board)}&token=${encodeURIComponent(externalId)}`;
}
function isGreenhouseApplicationUrl(value) {
    try {
        const host = new URL(value).hostname.toLowerCase();
        return host === "boards.greenhouse.io" || host === "job-boards.greenhouse.io";
    }
    catch {
        return false;
    }
}
export const greenhouseAdapter = {
    kind: "greenhouse",
    listUrl(company) {
        return `${BASE}/${encodeURIComponent(company.board)}/jobs?content=true&pay_transparency=true`;
    },
    boardUrl(company) {
        return `https://job-boards.greenhouse.io/${encodeURIComponent(company.board)}`;
    },
    async listJobs(company, capturedAt) {
        const payload = await fetchJson(this.listUrl(company));
        const jobs = payload.jobs ?? [];
        return jobs.map((job) => normalizeJob({
            company,
            externalId: String(job.id ?? ""),
            title: asString(job.title),
            locations: collectLocations(job),
            url: asString(job.absolute_url),
            applyUrl: hostedApplyUrl(company.board, String(job.id ?? ""), asString(job.absolute_url)),
            descriptionHtml: asString(job.content),
            postedAt: asString(job.first_published) || asString(job.updated_at) || null,
            structuredCompensation: structuredPay(job),
        }, capturedAt));
    },
    probeUrls(slug) {
        return [`${BASE}/${encodeURIComponent(slug)}/jobs`];
    },
};
