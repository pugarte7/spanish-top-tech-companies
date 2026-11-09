import { ashbyStructuredPay } from "./ashbyCompensation.js";
import { listHostedAshbyJobs } from "./ashbyHosted.js";
import { ashbyLocations } from "./ashbyLocations.js";
import { fetchJson } from "./http.js";
import { asString, normalizeJob } from "./normalize.js";
import { AppError } from "../util/errors.js";
import { logger } from "../util/logger.js";
/**
 * Ashby public job board API.
 * https://developers.ashbyhq.com/docs/public-job-posting-api
 *
 * Publishes structured compensation, which is the most reliable pay signal of
 * the three supported systems.
 */
const BASE = "https://api.ashbyhq.com/posting-api/job-board";
async function apiJobs(url) {
    try {
        const payload = await fetchJson(url);
        return (payload.jobs ?? []).filter((job) => job.isListed !== false);
    }
    catch (error) {
        if (!(error instanceof AppError) || error.code !== "not_found")
            throw error;
        logger.warn("Ashby listing API returned 404; checking public hosted job pages");
        return null;
    }
}
function workplaceType(job) {
    const value = asString(job.workplaceType).toLowerCase();
    if (value === "remote")
        return "remote";
    if (value === "hybrid")
        return "hybrid";
    if (value === "onsite")
        return "onsite";
    return job.isRemote === true ? "remote" : "unknown";
}
export const ashbyAdapter = {
    kind: "ashby",
    listUrl(company) {
        return `${BASE}/${encodeURIComponent(company.board)}?includeCompensation=true`;
    },
    boardUrl(company) {
        return `https://jobs.ashbyhq.com/${encodeURIComponent(company.board)}`;
    },
    async listJobs(company, capturedAt) {
        const jobs = await apiJobs(this.listUrl(company));
        if (jobs === null)
            return listHostedAshbyJobs(company, capturedAt);
        return jobs.map((job) => {
            const locations = ashbyLocations(job, job.secondaryLocations, workplaceType(job) === "remote");
            return normalizeJob({
                company,
                externalId: asString(job.id),
                title: asString(job.title),
                locations,
                url: asString(job.jobUrl),
                applyUrl: asString(job.applyUrl) || asString(job.jobUrl),
                descriptionPlain: asString(job.descriptionPlain),
                descriptionHtml: asString(job.descriptionHtml),
                postedAt: asString(job.publishedAt) || null,
                workplaceType: workplaceType(job),
                isRemote: job.isRemote === true,
                employmentType: asString(job.employmentType),
                structuredCompensation: ashbyStructuredPay(job.compensation, locations, {
                    isRemote: job.isRemote === true,
                    workplaceType: workplaceType(job),
                }),
            }, capturedAt);
        });
    },
    probeUrls(slug) {
        return [`${BASE}/${encodeURIComponent(slug)}`];
    },
};
