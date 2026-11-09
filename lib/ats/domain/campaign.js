import { z } from "zod";
/** A company's job board, as presets/spain.js and scripts/jobs.mjs describe it. */
const nonEmpty = z.string().trim().min(1);
/**
 * `google`, `meta`, `amazon` and `apple` are the employers' own career sites.
 * They only take applications from a signed-in account, so the agent's browser
 * has to be signed in as the candidate.
 */
export const AtsKindSchema = z.enum([
    "greenhouse",
    "lever",
    "ashby",
    "workday",
    "smartrecruiters",
    "workable",
    "recruitee",
    "google",
    "meta",
    "amazon",
    "apple",
    "gem",
]);
export const CompanySchema = z.object({
    name: nonEmpty,
    ats: AtsKindSchema,
    /**
     * Board token / site slug used by the ATS public API.
     * Workday has no single token, so it carries the `tenant/datacenter/site`
     * triple read off the employer's career-site URL, e.g.
     * `nvidia/wd5/NVIDIAExternalCareerSite`.
     */
    board: nonEmpty,
    tier: z.enum(["A", "B", "C"]).default("B"),
    tags: z.array(nonEmpty).default([]),
    active: z.boolean().default(true),
    /** Lever and Ashby have EU-hosted instances. */
    region: z.enum(["global", "eu"]).default("global"),
    /**
     * Server-side search filter, for boards that support one. Large Workday
     * tenants and SmartRecruiters boards publish thousands of unrelated postings,
     * and each posting costs a second request to read its description, so
     * narrowing at the source is both cheaper and more polite than filtering
     * after the fact. Ignored by boards with no search endpoint.
     */
    query: z.string().default(""),
});
