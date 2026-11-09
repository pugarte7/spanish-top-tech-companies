import { fetchJson } from "./http.js";
import { asString, normalizeJob } from "./normalize.js";
import { boardVerification } from "./sourceValidation.js";
/**
 * Gem job boards (jobs.gem.com/<board>), read through Gem's public job board
 * API, which answers without a key and in Greenhouse's shape.
 *
 * Board: the board id from the jobs.gem.com URL, e.g. `senndertechnologies-gmbh`.
 * Gem's hosted page takes the application, so the posting URL is the apply URL.
 */
const HOST = "api.gem.com";
const ALLOWED_HOSTS = [HOST];
const listUrl = (board) => `https://${HOST}/job_board/v0/${encodeURIComponent(board)}/job_posts/`;
function locationsOf(post) {
    const primary = asString(post.location?.name);
    const offices = (post.offices ?? []).map((office) => asString(office.location?.name) || asString(office.name));
    return [...new Set([primary, ...offices].filter((value) => value.length > 0))];
}
function workplaceOf(post) {
    const value = asString(post.location_type).toLowerCase();
    if (value === "remote")
        return "remote";
    if (value === "hybrid")
        return "hybrid";
    if (value === "in_office")
        return "onsite";
    return "unknown";
}
async function readPosts(company) {
    const payload = await fetchJson(listUrl(company.board), { allowedHosts: ALLOWED_HOSTS });
    return Array.isArray(payload) ? payload : (payload.job_posts ?? []);
}
export const gemAdapter = {
    kind: "gem",
    listUrl: (company) => listUrl(company.board),
    boardUrl: (company) => `https://jobs.gem.com/${encodeURIComponent(company.board)}`,
    async listJobs(company, capturedAt) {
        return (await readPosts(company)).map((post) => {
            const url = asString(post.absolute_url) || `https://jobs.gem.com/${encodeURIComponent(company.board)}/${encodeURIComponent(asString(post.id))}`;
            const workplace = workplaceOf(post);
            return normalizeJob({
                company,
                externalId: asString(post.id),
                title: asString(post.title),
                locations: locationsOf(post),
                url,
                applyUrl: url,
                descriptionHtml: asString(post.content),
                descriptionPlain: asString(post.content_plain),
                postedAt: asString(post.first_published_at) || asString(post.updated_at) || null,
                workplaceType: workplace,
                isRemote: workplace === "remote",
                employmentType: asString(post.employment_type) || undefined,
            }, capturedAt);
        });
    },
    async verifyBoard(company) {
        return boardVerification((await readPosts(company)).map((post) => asString(post.title)));
    },
    probeUrls: () => [],
    /** jobs.gem.com/<board>, the hosted board a careers page links to. */
    boardFromUrl(raw) {
        let url;
        try {
            url = new URL(raw);
        }
        catch {
            return null;
        }
        if (url.hostname.toLowerCase() !== "jobs.gem.com")
            return null;
        const board = url.pathname.split("/").filter(Boolean)[0];
        return board && /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(board) ? { ats: "gem", board, region: "global" } : null;
    },
    /** A page that embeds or links its Gem board. */
    boardFromPage(_pageUrl, html) {
        const match = /https?:\/\/jobs\.gem\.com\/([A-Za-z0-9][A-Za-z0-9._-]*)/.exec(html ?? "");
        return match ? { ats: "gem", board: match[1], region: "global" } : null;
    },
};
