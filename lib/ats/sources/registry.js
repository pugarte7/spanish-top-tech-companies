import { AppError, toErrorMessage } from "../util/errors.js";
import { nowIso } from "../util/hash.js";
import { logger } from "../util/logger.js";
import { ashbyAdapter } from "./ashby.js";
import { greenhouseAdapter } from "./greenhouse.js";
import { leverAdapter } from "./lever.js";
import { workdayAdapter } from "./workday.js";
import { smartrecruitersAdapter } from "./smartrecruiters.js";
import { workableAdapter } from "./workable.js";
import { recruiteeAdapter } from "./recruitee.js";
import { phenomAdapter } from "./phenom.js";
import { icimsAdapter } from "./icims.js";
import { googleCareersAdapter } from "./googleCareers.js";
import { metaCareersAdapter } from "./metaCareers.js";
import { amazonJobsAdapter } from "./amazonJobs.js";
import { appleJobsAdapter } from "./appleJobs.js";
import { probeJson } from "./http.js";
const ADAPTERS = {
    greenhouse: greenhouseAdapter,
    lever: leverAdapter,
    ashby: ashbyAdapter,
    workday: workdayAdapter,
    smartrecruiters: smartrecruitersAdapter,
    workable: workableAdapter,
    recruitee: recruiteeAdapter,
    phenom: phenomAdapter,
    icims: icimsAdapter,
    google: googleCareersAdapter,
    meta: metaCareersAdapter,
    amazon: amazonJobsAdapter,
    apple: appleJobsAdapter,
};
export function adapterFor(kind) {
    const adapter = ADAPTERS[kind];
    if (!adapter)
        throw new AppError("unknown_ats", `no adapter registered for "${kind}"`);
    return adapter;
}
export function allAdapters() {
    return Object.values(ADAPTERS);
}
/**
 * Fetches every configured board. One failing board never aborts the run; it is
 * reported as an issue so a stale slug can be fixed.
 *
 * `onBoard` receives each board's postings as soon as they are fetched, so a
 * caller can store them before the next board starts. A run across hundreds of
 * boards takes well over an hour, and holding everything until the end meant a
 * client timeout at 90 minutes discarded every board already fetched.
 */
export async function discoverJobs(companies, onBoard) {
    const capturedAt = nowIso();
    const issues = [];
    const jobs = [];
    const active = companies.filter((company) => company.active);
    for (const company of active) {
        let found;
        try {
            const adapter = adapterFor(company.ats);
            found = await adapter.listJobs(company, capturedAt);
            logger.debug("board fetched", { company: company.name, ats: company.ats, count: found.length });
        }
        catch (error) {
            issues.push({
                company: company.name,
                ats: company.ats,
                board: company.board,
                code: error instanceof AppError ? error.code : "error",
                message: toErrorMessage(error),
            });
            logger.warn("board fetch failed", { company: company.name, error: toErrorMessage(error) });
            continue;
        }
        jobs.push(...found);
        // Outside the fetch's try: a failure to store is not a board issue and
        // must not be reported as one.
        onBoard?.(found, company);
    }
    return { jobs, issues, boardsQueried: active.length };
}
/**
 * Confirms a board slug serves real postings.
 *
 * Board slugs increasingly come from outside this server — a web search, a
 * careers-page URL, a human's guess — and a wrong one is not reliably an error:
 * some ATS hosts answer 200 with a generic page carrying no postings. So a slug
 * is only trusted once postings have actually been seen. This costs one request
 * and no third-party credits, which is why verification lives here rather than
 * wherever the candidate came from.
 */
export async function verifyBoard(company) {
    const adapter = adapterFor(company.ats);
    try {
        if (adapter.verifyBoard)
            return await adapter.verifyBoard(company);
        const jobs = await adapter.listJobs(company, nowIso());
        return {
            ok: jobs.length > 0,
            postings: jobs.length,
            sampleTitles: jobs.slice(0, 3).map((job) => job.title),
            detail: jobs.length > 0 ? "board returned postings" : "board responded but published no postings",
        };
    }
    catch (error) {
        return { ok: false, postings: 0, sampleTitles: [], detail: toErrorMessage(error) };
    }
}
function slugVariants(companyName) {
    const base = companyName.trim().toLowerCase();
    const alphanumeric = base.replace(/[^a-z0-9]+/g, "");
    const hyphenated = base.replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    const noSuffix = base.replace(/\b(inc|llc|ltd|corp|technologies|labs|ai)\b/g, "").replace(/[^a-z0-9]+/g, "");
    return [...new Set([alphanumeric, hyphenated, noSuffix, companyName.trim()])].filter((value) => value.length > 1);
}
/**
 * Probes ATS endpoints to find a company's real board slug. Board tokens are
 * not published anywhere central, so guesses must be verified rather than
 * trusted.
 */
export async function resolveBoards(companyName, extraSlugs = []) {
    const slugs = [...new Set([...slugVariants(companyName), ...extraSlugs])];
    const results = [];
    for (const slug of slugs) {
        for (const adapter of allAdapters()) {
            for (const url of adapter.probeUrls(slug)) {
                const probe = await probeJson(url);
                if (probe.ok) {
                    results.push({ ats: adapter.kind, board: slug, url, ok: true, status: probe.status });
                }
            }
        }
    }
    return results;
}
