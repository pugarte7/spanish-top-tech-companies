import { z } from "zod";
import { CompanySchema } from "../domain/campaign.js";
import { allAdapters } from "../sources/registry.js";
import { jobLocationClasses } from "../ranking/location.js";
import { normalizeForMatch } from "../text/html.js";
import { toErrorMessage } from "../util/errors.js";
/**
 * Builds the Spain company preset from spanishtoptechcompanies.com.
 *
 * The salary site sends Spanish job seekers here, and with only the US/Canada
 * preset their discovery found nothing in Spain. The site already knows which
 * employers in Spain pay engineers what, and it publishes only aggregates, so
 * its company list is the seed: name, Levels.fyi slug, website, and the
 * software-engineer median that ranks it.
 *
 * Board slugs are not published anywhere, so each company's board is either
 * read off its own website (trusted, since the employer put it there) or
 * guessed with the server's own resolver (not trusted until the board's
 * postings name the company: "seat" or "factorial" on Lever can be anyone).
 * A board is kept only if it is open in Spain right now, by the same location
 * classifier the gates use, because a board with nothing in Spain adds fetch
 * time to every run and no postings.
 *
 * Everything that touches the network is injected, so the rules are tested
 * offline and the builder script is the only caller that goes online.
 */
/** Where a Spanish candidate can take the job: an office in Spain, or remote from Spain or anywhere in Europe. */
export const SPAIN_LOCATION_CLASSES = ["spain", "remote-spain", "remote-europe"];
const SiteCompanySchema = z.object({
    name: z.string().trim().min(1),
    web: z.string().nullable().optional(),
    url: z.string().nullable().optional(),
    levels: z.string().trim().min(1),
    linkedin: z.string().nullable().optional(),
    cities: z.array(z.string()).default([]),
});
/** data.json: the companies the site lists (only verified ones) and the bars it lists them by. */
const SiteDataSchema = z.object({
    data_as_of: z.string().optional(),
    threshold: z.number().positive(),
    // Gone from data.json since 2026-11-04 (every company is listed); it only splits tiers B and C.
    company_floor: z.number().positive().optional(),
    min_ranked: z.number().int().positive(),
    companies: z.array(SiteCompanySchema),
});
/**
 * companies.json: per-role tables whose rows start [companyIndex, n, median].
 * The "|" cell is every region and every experience band, which is the
 * median the site ranks a company by. Only the software-engineer table is
 * read: the others include per-place lookups with no fields of their own, and
 * a cell holding a string names the cell with the same rows.
 */
const CompanyTablesSchema = z.object({
    "software-engineer": z
        .object({ fields: z.array(z.string()), cells: z.record(z.string(), z.union([z.string(), z.array(z.array(z.unknown()))])) })
        .optional(),
});
/** Reads the site's two aggregate files into the companies it lists, with their engineer medians. */
export function readSiteSnapshot(data, tables) {
    const site = SiteDataSchema.parse(data);
    const engineers = CompanyTablesSchema.parse(tables)["software-engineer"];
    const fields = engineers?.fields ?? [];
    const at = (name) => fields.indexOf(name);
    const byIndex = new Map();
    const all = engineers?.cells["|"];
    const rows = typeof all === "string" ? engineers?.cells[all] : all;
    for (const row of Array.isArray(rows) ? rows : []) {
        const index = row[at("c")];
        const n = row[at("n")];
        const median = row[at("median")];
        if (typeof index === "number" && typeof n === "number" && typeof median === "number")
            byIndex.set(index, { n, median });
    }
    const companies = site.companies.map((company, index) => {
        const engineer = byIndex.get(index);
        return {
            name: company.name,
            levelsSlug: company.levels,
            // `url` falls back to the company's Levels.fyi page when it has no site of its own.
            website: company.web ?? null,
            cities: company.cities,
            engineerMedian: engineer?.median ?? null,
            engineerCount: engineer?.n ?? 0,
        };
    });
    return {
        companies,
        rules: {
            threshold: site.threshold,
            companyFloor: site.company_floor ?? 45_000,
            minRanked: site.min_ranked,
            dataAsOf: site.data_as_of ?? "",
        },
    };
}
/**
 * Tier from the site's own ranking, so the queue orders employers the way the
 * site does. A: engineers' median at the site's listing bar (60k) over enough
 * salaries for the site to rank it. B: at the bar on fewer salaries, or at
 * least at the floor the site counts companies from. C: under that, or no
 * engineer salaries at all (the company is listed for other roles).
 */
export function salaryTier(company, rules) {
    const median = company.engineerMedian;
    if (median === null)
        return "C";
    if (median >= rules.threshold && company.engineerCount >= rules.minRanked)
        return "A";
    if (median >= rules.companyFloor)
        return "B";
    return "C";
}
/**
 * Workday reads every posting's detail page, and the tenants Spanish employers
 * run (Airbus, BBVA) publish thousands of roles worldwide; unfiltered, the
 * first page Airbus serves is all Toulouse and Bremen. Its search matches
 * location text, so "Spain" narrows the board to the roles here both for this
 * probe and for every discovery run after it.
 */
export const WORKDAY_QUERY = "Spain";
/** SmartRecruiters filters by country server-side; Bosch publishes 5,000 roles, 74 of them here. */
export const SMARTRECRUITERS_COUNTRY = "es";
const NOT_A_SLUG = new Set(["embed", "api", "v1", "jobs", "job_app", "job_board", "boards", "careers", ""]);
function cleanSlug(value) {
    if (!value)
        return null;
    const slug = decodeURIComponent(value).trim();
    if (NOT_A_SLUG.has(slug.toLowerCase()) || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(slug))
        return null;
    return slug;
}
/** A Workday site name, which may itself be "jobs" or "Careers" (Red Hat's is). */
function cleanSite(value) {
    if (!value)
        return null;
    const site = decodeURIComponent(value).trim();
    return /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(site) ? site : null;
}
const RECRUITEE_RESERVED = new Set(["www", "app", "api", "docs", "support", "blog", "careers"]);
/** Reads a board from a link to a hosted job board. Unrecognised links return null. */
export function boardFromUrl(raw) {
    let url;
    try {
        url = new URL(raw);
    }
    catch {
        return null;
    }
    const host = url.hostname.toLowerCase();
    const segments = url.pathname.split("/").filter((part) => part.length > 0);
    // EU-hosted boards are served by the same API as the rest.
    if (/^(?:job-)?boards(?:\.eu)?\.greenhouse\.io$/.test(host)) {
        // The embed script names the board in ?for=, not in the path.
        const slug = segments[0] === "embed" ? cleanSlug(url.searchParams.get("for") ?? undefined) : cleanSlug(segments[0]);
        return slug ? { ats: "greenhouse", board: slug, region: "global" } : null;
    }
    if (host === "jobs.lever.co" || host === "jobs.eu.lever.co") {
        const slug = cleanSlug(segments[0]);
        return slug ? { ats: "lever", board: slug, region: host === "jobs.eu.lever.co" ? "eu" : "global" } : null;
    }
    if (host === "jobs.ashbyhq.com") {
        const slug = cleanSlug(segments[0]);
        return slug ? { ats: "ashby", board: slug, region: "global" } : null;
    }
    // These three cannot be guessed (the resolver has no probe for them), so a link is the only way in.
    if (host === "jobs.smartrecruiters.com" || host === "careers.smartrecruiters.com") {
        const slug = cleanSlug(segments[0]);
        return slug ? { ats: "smartrecruiters", board: slug, region: "global" } : null;
    }
    if (host === "apply.workable.com") {
        const slug = segments[0] === "j" ? null : cleanSlug(segments[0]);
        return slug ? { ats: "workable", board: slug, region: "global" } : null;
    }
    const recruitee = /^([a-z0-9-]+)\.recruitee\.com$/.exec(host);
    if (recruitee && !RECRUITEE_RESERVED.has(recruitee[1])) {
        return { ats: "recruitee", board: recruitee[1], region: "global" };
    }
    const workday = /^([a-z0-9-]+)\.(wd\d+)\.myworkdayjobs\.com$/.exec(host);
    if (workday) {
        // An optional locale segment comes first: /en-US/External, /es/External or /External.
        const parts = segments[0] && /^[a-z]{2}(-[A-Za-z]{2})?$/.test(segments[0]) ? segments.slice(1) : segments;
        const site = cleanSite(parts[0]);
        return site ? { ats: "workday", board: `${workday[1]}/${workday[2]}/${site}`, region: "global" } : null;
    }
    // Employers whose own career site is the board: the board is a search for Spain.
    if (host === "www.amazon.jobs" || host === "amazon.jobs")
        return { ats: "amazon", board: "ESP", region: "global" };
    if ((host === "www.google.com" || host === "careers.google.com") && (host === "careers.google.com" || url.pathname.startsWith("/about/careers")))
        return { ats: "google", board: "Spain", region: "global" };
    if (host === "www.metacareers.com" || host === "metacareers.com")
        return { ats: "meta", board: "metacareers", region: "global", query: "Spain" };
    // Adapters for boards on the employer's own domain recognise their own links.
    for (const adapter of allAdapters()) {
        const board = adapter.boardFromUrl?.(url.href);
        if (board)
            return board;
    }
    return null;
}
const URL_TAIL = String.raw `[^\s"'<>)\\]*`;
const ATS_LINK = new RegExp([
    String.raw `https?://(?:boards|job-boards)(?:\.eu)?\.greenhouse\.io/`,
    String.raw `https?://jobs(?:\.eu)?\.lever\.co/`,
    String.raw `https?://jobs\.ashbyhq\.com/`,
    String.raw `https?://(?:jobs|careers)\.smartrecruiters\.com/`,
    String.raw `https?://apply\.workable\.com/`,
    String.raw `https?://[a-z0-9-]+\.recruitee\.com/?`,
    String.raw `https?://[a-z0-9-]+\.wd\d+\.myworkdayjobs\.com/`,
]
    .map((prefix) => prefix + URL_TAIL)
    .join("|"), "gi");
/**
 * Every hosted board a page links to. The page is untrusted text and is only
 * pattern-matched for board URLs; nothing in it is followed except as a URL
 * this module recognises.
 */
export function boardsLinkedFrom(html) {
    const found = new Map();
    for (const match of html.replace(/&amp;/g, "&").matchAll(ATS_LINK)) {
        const board = boardFromUrl(match[0]);
        if (board)
            found.set(boardKey(board), board);
    }
    return [...found.values()];
}
const ASSET_PATH = /(^\/wp-json\/|\.(css|js|json|xml|png|jpe?g|svg|webp|ico|pdf)$)/i;
const CAREERS_HINT = /(careers?|jobs|empleo|trabaja|unete|join-us|work-with-us|vacantes)/i;
/** The first careers page the site links to on its own domain, where the board link usually lives. */
export function careersPageLinkedFrom(html, pageUrl) {
    let base;
    try {
        base = new URL(pageUrl);
    }
    catch {
        return null;
    }
    const root = registrableHost(base.hostname);
    for (const match of html.matchAll(/href\s*=\s*["']([^"'#]+)["']/gi)) {
        let link;
        try {
            link = new URL(match[1], base);
        }
        catch {
            continue;
        }
        if (link.protocol !== "https:")
            continue;
        if (registrableHost(link.hostname) !== root)
            continue;
        if (link.href === base.href || ASSET_PATH.test(link.pathname))
            continue;
        // A careers subdomain counts only when it is not the page already being read.
        const hostHint = link.hostname !== base.hostname && CAREERS_HINT.test(link.hostname.split(".")[0] ?? "");
        if (hostHint || CAREERS_HINT.test(link.pathname))
            return link.href;
    }
    return null;
}
/** Last two labels, which is the site itself for everything the salary site lists (.com, .es, .io, .ai). */
function registrableHost(hostname) {
    return hostname.toLowerCase().split(".").slice(-2).join(".");
}
const GENERIC_LABELS = new Set(["www", "careers", "jobs", "global", "corporate", "group", "en", "es"]);
/** The name a company's own domain gives it: www.47deg.com is "47deg". */
export function domainStem(website) {
    // The site links some companies straight to their board, whose domain names the ATS, not the employer.
    if (!website || boardFromUrl(website))
        return null;
    try {
        const labels = new URL(website).hostname.toLowerCase().split(".");
        const name = labels.slice(0, -1).filter((label) => !GENERIC_LABELS.has(label)).pop();
        return name && name.length >= 3 ? name : null;
    }
    catch {
        return null;
    }
}
/**
 * Slugs to try beyond the resolver's own name variants: the Levels.fyi slug,
 * the same without hyphens, and the website's domain. Employers often name
 * their board after their domain ("factorialhr") rather than their brand.
 */
export function slugGuesses(company) {
    const stem = domainStem(company.website);
    return [...new Set([company.levelsSlug, company.levelsSlug.replace(/-/g, ""), ...(stem ? [stem] : [])])].filter((slug) => slug.length > 1);
}
/** Postings open to someone in Spain: an office here, or remote from Spain or Europe. */
export function spainPostings(jobs) {
    return jobs.filter((job) => jobLocationClasses(job).some((value) => SPAIN_LOCATION_CLASSES.includes(value)));
}
/**
 * Whether a guessed board belongs to this company: some posting's text names
 * it, by its name or its domain. A board read off the company's own site needs
 * no such check.
 */
export function boardNamesCompany(jobs, company) {
    const needles = [normalizeForMatch(company.name), domainStem(company.website) ?? ""].filter((value) => value.length >= 3);
    if (needles.length === 0)
        return false;
    return jobs.some((job) => {
        const text = normalizeForMatch(`${job.title} ${job.descriptionText}`);
        return needles.some((needle) => new RegExp(`(^|[^a-z0-9])${escapeRegex(needle)}([^a-z0-9]|$)`).test(text));
    });
}
function escapeRegex(input) {
    return input.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
export function boardKey(board) {
    return `${board.ats}|${board.region}|${board.board.toLowerCase()}`;
}
function tagsFor(company) {
    const cities = company.cities.map((city) => normalizeForMatch(city).replace(/\s+/g, "-")).filter((city) => city.length > 0);
    return [...new Set(["spain", ...cities.slice(0, 3)])];
}
/**
 * Every board a page points at: links to hosted boards, plus career sites an
 * adapter recognises from the page itself (a board on the employer's own
 * domain has no link to give away).
 */
export function pageBoards(pageUrl, html) {
    const found = new Map(boardsLinkedFrom(html).map((board) => [boardKey(board), board]));
    for (const adapter of allAdapters()) {
        const board = adapter.boardFromPage?.(pageUrl, html);
        if (board)
            found.set(boardKey(board), board);
    }
    return [...found.values()];
}
function regionFromProbeUrl(url) {
    return url.includes("api.eu.lever.co") ? "eu" : "global";
}
/** Boards one page points at, or the careers page it links to does. */
async function boardsFrom(pageUrl, deps) {
    const direct = boardFromUrl(pageUrl);
    if (direct)
        return [direct];
    if (!deps.fetchPage)
        return [];
    // The client only speaks HTTPS; a site with none is not read, and its board is left to the guesses.
    const url = pageUrl.replace(/^http:\/\//i, "https://");
    const home = await deps.fetchPage(url);
    if (!home)
        return [];
    const found = pageBoards(url, home);
    if (found.length > 0)
        return found;
    const careers = careersPageLinkedFrom(home, url);
    const page = careers ? await deps.fetchPage(careers) : null;
    return page ? pageBoards(careers, page) : [];
}
/**
 * Boards the company's careers page (data/careers.json, set by hand) points
 * at, else its website. Both are the employer's own word on where it hires.
 */
async function websiteBoards(company, deps) {
    if (company.careers) {
        const found = await boardsFrom(company.careers, deps);
        if (found.length > 0)
            return found;
    }
    return company.website ? boardsFrom(company.website, deps) : [];
}
const MAX_OWN_BOARDS = 2;
function judgeBoard(jobs, inSpain, source, company) {
    if (jobs.length === 0)
        return "no-postings";
    if (source === "guess" && !boardNamesCompany(jobs, company))
        return "unconfirmed";
    return inSpain.length === 0 ? "no-spain-postings" : "kept";
}
/** Probes one company and keeps the board with the most postings open in Spain. */
export async function probeCompany(company, rules, deps) {
    const tier = salaryTier(company, rules);
    const candidates = new Map();
    const linked = await websiteBoards(company, deps);
    // A page linking many boards is a portfolio or a partner list, not the
    // company's own careers link, so those boards must prove themselves like guesses.
    const linkedSource = linked.length <= MAX_OWN_BOARDS ? "website" : "guess";
    for (const ref of linked)
        candidates.set(boardKey(ref), { ref, source: linkedSource });
    for (const match of await deps.resolve(company.name, slugGuesses(company))) {
        const ref = { ats: match.ats, board: match.board, region: regionFromProbeUrl(match.url) };
        if (!candidates.has(boardKey(ref)))
            candidates.set(boardKey(ref), { ref, source: "guess" });
    }
    const reports = [];
    let best = null;
    for (const { ref, source } of candidates.values()) {
        const entry = CompanySchema.parse({
            name: company.name,
            ats: ref.ats,
            board: ref.board,
            tier,
            tags: tagsFor(company),
            ...(ref.region === "eu" ? { region: "eu" } : {}),
            ...(ref.ats === "workday" ? { query: WORKDAY_QUERY } : {}),
            ...(ref.query ? { query: ref.query } : {}),
            ...(ref.ats === "smartrecruiters" ? { country: SMARTRECRUITERS_COUNTRY } : {}),
        });
        let report;
        try {
            const jobs = await deps.listJobs(entry);
            const inSpain = spainPostings(jobs);
            const outcome = judgeBoard(jobs, inSpain, source, company);
            report = { ...ref, source, outcome, postings: jobs.length, spainPostings: inSpain.length };
        }
        catch (error) {
            report = { ...ref, source, outcome: "error", postings: 0, spainPostings: 0, detail: toErrorMessage(error) };
        }
        reports.push(report);
        if (report.outcome !== "kept")
            continue;
        // Most postings in Spain wins; on a tie the board the company links to itself.
        if (!best ||
            report.spainPostings > best.report.spainPostings ||
            (report.spainPostings === best.report.spainPostings && source === "website" && best.report.source === "guess")) {
            best = { report, company: entry };
        }
    }
    return { name: company.name, tier, candidates: reports, kept: best?.company ?? null };
}
function presetEntry(company) {
    const { name, ats, board, tier, tags } = company;
    return {
        name,
        ats,
        board,
        tier,
        tags,
        ...(company.region === "eu" ? { region: company.region } : {}),
        ...(company.query ? { query: company.query } : {}),
        ...(company.country ? { country: company.country } : {}),
    };
}
/** One entry per company and per board, sorted by name, so a rebuild diffs cleanly. */
export function assemblePreset(reports) {
    const byName = new Map();
    const boards = new Set();
    for (const report of reports) {
        const company = report.kept;
        if (!company)
            continue;
        const key = boardKey({ ats: company.ats, board: company.board, region: company.region });
        if (byName.has(company.name.toLowerCase()) || boards.has(key))
            continue;
        byName.set(company.name.toLowerCase(), company);
        boards.add(key);
    }
    const companies = [...byName.values()]
        .sort((a, b) => a.name.localeCompare(b.name, "en", { sensitivity: "base" }))
        .map(presetEntry);
    return { version: 1, companies };
}
export function summarize(reports, preset) {
    const boardsFound = {};
    const boardsKept = {};
    for (const report of reports) {
        for (const candidate of report.candidates) {
            // A slug that answered with an empty board is not a board anyone hires through.
            if (candidate.outcome === "error" || candidate.outcome === "no-postings")
                continue;
            const label = candidate.ats === "lever" && candidate.region === "eu" ? "lever-eu" : candidate.ats;
            boardsFound[label] = (boardsFound[label] ?? 0) + 1;
        }
    }
    for (const company of preset.companies) {
        const label = company.ats === "lever" && company.region === "eu" ? "lever-eu" : company.ats;
        boardsKept[label] = (boardsKept[label] ?? 0) + 1;
    }
    return { companiesProbed: reports.length, boardsFound, boardsKept, companiesKept: preset.companies.length };
}
