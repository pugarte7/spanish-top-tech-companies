import { AppError } from "../util/errors.js";
import { logger } from "../util/logger.js";
import { fetchText, userAgent } from "./http.js";
import { asString, normalizeJob } from "./normalize.js";
import { fetchSourceResponse } from "./sourceRedirects.js";
/**
 * Meta Careers (metacareers.com).
 *
 * Search runs through the site's own GraphQL endpoint, which answers one query
 * with every match. The request needs the page's `lsd` token, read fresh from
 * the search page each time, and a persisted query id that Meta rotates when
 * it deploys: when it goes stale the endpoint answers with errors rather than
 * results, so set AUTOAPPLY_META_SEARCH_DOC_ID to the id the live search page
 * sends. Each posting's page carries a schema.org JobPosting block with the
 * description and qualifications.
 *
 * Board: a label only (e.g. `metacareers`); the company's `query` is the
 * search text.
 */
const ORIGIN = "https://www.metacareers.com";
const SEARCH_QUERY_NAME = "CareersJobSearchResultsV2DataQuery";
const DEFAULT_SEARCH_DOC_ID = "27129360303422352";
export function metaJobUrl(id) {
    return `${ORIGIN}/jobs/${encodeURIComponent(id)}/`;
}
export function metaApplyUrl(id) {
    return `${ORIGIN}/profile/create_application/${encodeURIComponent(id)}/`;
}
export function metaSearchPageUrl(query) {
    return `${ORIGIN}/jobsearch/?q=${encodeURIComponent(query.trim())}`;
}
/** The anti-CSRF token the GraphQL endpoint expects, as embedded in any page. */
export function parseLsdToken(html) {
    return /"LSD",\[\],\{"token":"([^"]+)"/.exec(html)?.[1] ?? /name="lsd" value="([^"]+)"/.exec(html)?.[1] ?? null;
}
/** Reads search results out of a GraphQL response, failing loudly on a stale query id. */
export function parseMetaSearchResponse(text) {
    // The endpoint can stream several JSON documents; the first carries the data.
    const first = text.split("\n").find((line) => line.trim().startsWith("{")) ?? "";
    let payload;
    try {
        payload = JSON.parse(first);
    }
    catch {
        throw new AppError("source_format", "Meta search returned something other than JSON");
    }
    const jobs = payload.data?.job_search_with_featured_jobs_v2?.all_jobs;
    if (!Array.isArray(jobs)) {
        const message = payload.errors?.map((error) => asString(error.message)).filter(Boolean).join("; ") ?? "";
        throw new AppError("source_format", `Meta search returned no results list${message ? ` (${message})` : ""}; the persisted query id may have rotated - set AUTOAPPLY_META_SEARCH_DOC_ID`);
    }
    return jobs.flatMap((job) => {
        // GraphQL returns null for a list item that failed to resolve.
        if (!job || typeof job !== "object")
            return [];
        const record = job;
        const id = asString(record.id);
        const title = asString(record.title).trim();
        if (!id || !title)
            return [];
        const list = (value) => (Array.isArray(value) ? value.filter((v) => typeof v === "string") : []);
        return [{ id, title, locations: list(record.locations), teams: list(record.teams) }];
    });
}
/** Reads the schema.org JobPosting block from a posting page. */
export function parseMetaPostingPage(html) {
    const block = /<script type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/.exec(html)?.[1];
    if (!block)
        return null;
    let ld;
    try {
        ld = JSON.parse(block);
    }
    catch {
        return null;
    }
    const section = (heading, value) => {
        const text = asString(value).trim();
        return text ? `<h3>${heading}</h3><p>${text.replace(/\n/g, "<br>")}</p>` : "";
    };
    const places = Array.isArray(ld.jobLocation) ? ld.jobLocation : [];
    const locations = places
        .map((place) => asString(place.name))
        .filter((name) => name.length > 0);
    return {
        descriptionHtml: [
            section("About the role", ld.description),
            section("Responsibilities", ld.responsibilities),
            section("Qualifications", ld.qualifications),
        ].join("\n"),
        postedAt: asString(ld.datePosted) || null,
        locations,
    };
}
function searchDocId() {
    return process.env.AUTOAPPLY_META_SEARCH_DOC_ID?.trim() || DEFAULT_SEARCH_DOC_ID;
}
async function searchMeta(query) {
    const page = await fetchText(metaSearchPageUrl(query));
    const lsd = parseLsdToken(page);
    if (!lsd)
        throw new AppError("source_format", "Meta search page carried no lsd token");
    const variables = {
        search_input: {
            q: query.trim(),
            divisions: [],
            offices: [],
            roles: [],
            leadership_levels: [],
            saved_jobs: [],
            saved_searches: [],
            sub_teams: [],
            teams: [],
            is_leadership: false,
            is_remote_only: false,
            sort_by_new: false,
            results_per_page: null,
        },
        viewasUserID: null,
        isLoggedIn: false,
    };
    const body = new URLSearchParams({
        lsd,
        fb_api_caller_class: "RelayModern",
        fb_api_req_friendly_name: SEARCH_QUERY_NAME,
        variables: JSON.stringify(variables),
        server_timestamps: "true",
        doc_id: searchDocId(),
    });
    // A form-encoded POST, which the shared JSON client does not send. Same
    // honest User-Agent, and the host is pinned to Meta's own.
    const response = await fetchSourceResponse(`${ORIGIN}/graphql`, {
        method: "POST",
        headers: {
            "user-agent": userAgent(),
            accept: "*/*",
            "content-type": "application/x-www-form-urlencoded",
            "x-fb-lsd": lsd,
            "x-fb-friendly-name": SEARCH_QUERY_NAME,
        },
        body: body.toString(),
        signal: AbortSignal.timeout(30_000),
    }, ["www.metacareers.com"], ["x-fb-lsd", "x-fb-friendly-name"]);
    if (!response.ok)
        throw new AppError("http_error", `HTTP ${response.status} from Meta search`);
    return parseMetaSearchResponse(await response.text());
}
export const metaCareersAdapter = {
    kind: "meta",
    listUrl(company) {
        return metaSearchPageUrl(company.query);
    },
    boardUrl(company) {
        return metaSearchPageUrl(company.query);
    },
    async listJobs(company, capturedAt) {
        const postings = await searchMeta(company.query);
        const jobs = [];
        for (const posting of postings) {
            let detail = null;
            try {
                detail = parseMetaPostingPage(await fetchText(metaJobUrl(posting.id)));
            }
            catch (error) {
                logger.warn("meta posting page unreadable; keeping the search summary", { id: posting.id, error: String(error) });
            }
            jobs.push(normalizeJob({
                company,
                externalId: posting.id,
                title: posting.title,
                locations: detail?.locations.length ? detail.locations : posting.locations,
                url: metaJobUrl(posting.id),
                applyUrl: metaApplyUrl(posting.id),
                descriptionHtml: detail?.descriptionHtml ?? "",
                postedAt: detail?.postedAt ?? null,
            }, capturedAt));
        }
        return jobs;
    },
    probeUrls() {
        return [];
    },
    async verifyBoard(company) {
        const postings = await searchMeta(company.query);
        return {
            ok: postings.length > 0,
            postings: postings.length,
            sampleTitles: postings.slice(0, 3).map((posting) => posting.title),
            detail: postings.length > 0 ? "search returned postings" : "search matched no postings",
        };
    },
};
