import { z } from "zod";
import { AppError } from "../util/errors.js";
import { fetchJson } from "./http.js";
import { boardVerification, nonEmptyText, normalizePublicJob, optionalText, parseSourcePayload, publishedDate, publishedSalary, } from "./sourceValidation.js";
/**
 * Deel's own ATS: career pages at `jobs.deel.com/<company>`.
 *
 * Board: `<company slug>/<organization id>/<job board id>`, the three read off
 * any of its job pages. The guest API the page itself calls returns every
 * published posting in one answer, each with its countries, its work
 * arrangement and, when the employer shows it, its pay.
 */
const API = "api-prod.letsdeel.com";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const postingSchema = z.object({
    id: z.string().regex(UUID), title: nonEmptyText, richtextDescription: optionalText, createdAt: optionalText,
    isCompensationVisible: z.boolean().nullish(),
    job: z.object({
        workArrangementEnum: optionalText,
        jobLocations: z.array(z.object({
            location: z.object({ name: optionalText, country: z.object({ code: optionalText, name: optionalText }).passthrough().nullish() }).passthrough(),
        }).passthrough()).nullish(),
        jobEmploymentTypes: z.array(z.object({ employmentType: z.object({ name: optionalText }).passthrough().nullish() }).passthrough()).nullish(),
        currentCompensation: z.object({
            currencyIsoCode: optionalText, minAmount: z.number().nullish(), maxAmount: z.number().nullish(), periodSlug: optionalText,
        }).passthrough().nullish(),
    }).passthrough(),
}).passthrough();
function parseBoard(board) {
    const [slug, org, jobBoard, ...rest] = String(board).split("/");
    if (rest.length || !/^[a-z0-9-]{1,80}$/i.test(slug ?? "") || !UUID.test(org ?? "") || !UUID.test(jobBoard ?? "")) {
        throw new AppError("invalid_board", `deel board must be "<slug>/<organization id>/<job board id>", got: ${board}`, { board });
    }
    return { slug, org, jobBoard };
}
function listUrl(company) {
    const { org, jobBoard } = parseBoard(company.board);
    return `https://${API}/deelapi/guest/ats/organizations/${org}/job_boards/${jobBoard}/job_postings`;
}
async function readPostings(company) {
    const payload = await fetchJson(listUrl(company), { allowedHosts: [API] });
    return parseSourcePayload(z.array(postingSchema), payload, "Deel job postings");
}
function normalizePosting(posting, company, capturedAt) {
    const { slug } = parseBoard(company.board);
    const places = (posting.job.jobLocations ?? []).map(({ location }) => {
        const country = location.country?.name ?? "";
        const name = location.name ?? "";
        return { label: name && country && name !== country ? `${name}, ${country}` : name || country, code: location.country?.code ?? "" };
    }).filter((place) => place.label);
    const arrangement = (posting.job.workArrangementEnum ?? "").toUpperCase();
    const remote = arrangement === "REMOTE";
    const pay = posting.isCompensationVisible ? posting.job.currentCompensation : null;
    const url = `https://jobs.deel.com/${slug}/job-details/${posting.id}`;
    return normalizePublicJob({
        company, externalId: posting.id, title: posting.title,
        locations: places.map((place) => remote ? `Remote, ${place.label}` : place.label),
        url, applyUrl: `${url}/application`,
        descriptionHtml: posting.richtextDescription ?? "",
        postedAt: publishedDate(posting.createdAt ?? undefined),
        workplaceType: remote ? "remote" : arrangement === "HYBRID" ? "hybrid" : arrangement === "ONSITE" || arrangement === "ON_SITE" ? "onsite" : "unknown",
        isRemote: remote,
        employmentType: posting.job.jobEmploymentTypes?.[0]?.employmentType?.name ?? undefined,
        structuredCompensation: pay ? publishedSalary({ min: pay.minAmount ?? null, max: pay.maxAmount ?? null,
            currency: pay.currencyIsoCode ?? "", period: pay.periodSlug }) : null,
    }, capturedAt, places.map((place) => place.code));
}
export const deelAdapter = {
    kind: "deel",
    listUrl,
    boardUrl: (company) => `https://jobs.deel.com/${parseBoard(company.board).slug}`,
    async listJobs(company, capturedAt) {
        return (await readPostings(company)).map((posting) => normalizePosting(posting, company, capturedAt));
    },
    async verifyBoard(company) {
        return boardVerification((await readPostings(company)).map((posting) => posting.title));
    },
    probeUrls: () => [],
    boardFromUrl: () => null,
};
