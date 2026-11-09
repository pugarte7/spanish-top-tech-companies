import { XMLParser, XMLValidator } from "fast-xml-parser";
import { z } from "zod";
import { AppError } from "../util/errors.js";
import { fetchText } from "./http.js";
import { boardVerification, locationLabel, nonEmptyText, normalizePublicJob, optionalText, parseSourcePayload, } from "./sourceValidation.js";
/**
 * Teamtailor career sites publish every open job in one RSS feed, with the
 * description and each location's city and country. Most employers serve the
 * site on their own domain (careers.idealista.com), so the board is the site's
 * host, not a slug: it cannot be guessed, only read off a link or a page.
 */
const PAGE_SIZE = 500;
const HOST = /^(?=.{4,253}$)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/;
const RESERVED = new Set(["www", "app", "api", "tt", "support", "docs", "blog", "status", "career", "careers", "go"]);
const text = z.union([z.string(), z.number()]).optional().transform((value) => value === undefined ? undefined : String(value).trim() || undefined);
const locationSchema = z.object({ "tt:name": text, "tt:city": text, "tt:country": text }).passthrough();
const itemSchema = z.object({
    title: nonEmptyText,
    description: z.string().optional().default(""),
    pubDate: optionalText,
    link: nonEmptyText,
    remoteStatus: optionalText,
    guid: text,
    "tt:locations": z.union([z.literal(""), z.object({ "tt:location": z.array(locationSchema) }).passthrough()]).optional(),
}).passthrough();
const feedSchema = z.object({
    rss: z.object({ channel: z.object({ item: z.array(itemSchema).optional().default([]) }).passthrough() }).passthrough(),
}).passthrough();
function host(company) {
    const value = company.board.trim().toLowerCase();
    if (!HOST.test(value))
        throw new AppError("invalid_board", "a Teamtailor board is the career site's host name");
    return value;
}
function listUrl(company) {
    return `https://${host(company)}/jobs.rss?per_page=${PAGE_SIZE}`;
}
function parseFeed(xml) {
    const markup = xml.replace(/<!\[CDATA\[[\s\S]*?\]\]>|<!--[\s\S]*?-->/g, "");
    if (/<!\s*(?:DOCTYPE|ENTITY)\b/i.test(markup)) {
        throw new AppError("unsafe_xml", "Teamtailor RSS must not contain DOCTYPE or entity declarations");
    }
    if (XMLValidator.validate(xml) !== true || !/xmlns:tt="https:\/\/teamtailor\.com\/locations"/.test(xml)) {
        throw new AppError("invalid_source_payload", "the board did not return a Teamtailor RSS feed");
    }
    const parser = new XMLParser({
        ignoreAttributes: true, ignoreDeclaration: true, parseTagValue: false,
        processEntities: true, trimValues: true,
        isArray: (_name, path) => path === "rss.channel.item" || path === "rss.channel.item.tt:locations.tt:location",
    });
    const items = parseSourcePayload(feedSchema, parser.parse(xml), "Teamtailor RSS").rss.channel.item;
    if (items.length >= PAGE_SIZE) {
        throw new AppError("source_limit", `Teamtailor feed reached ${PAGE_SIZE} jobs; the rest would be dropped`);
    }
    return items;
}
async function readItems(company) {
    const xml = await fetchText(listUrl(company), {
        allowedHosts: [host(company)], accept: "application/rss+xml, application/xml, text/xml",
    });
    return parseFeed(xml);
}
/** The job id in the posting's own URL: /jobs/8681660-customer-specialist. */
function jobId(item) {
    const id = /\/jobs\/(\d+)(?:-|$|\/|\?)/.exec(item.link)?.[1];
    if (!id)
        throw new AppError("invalid_source_payload", `Teamtailor job link has no id: ${item.link}`);
    return id;
}
const WORKPLACE = { fully: "remote", hybrid: "hybrid", onsite: "onsite" };
function locations(item) {
    const places = item["tt:locations"] && typeof item["tt:locations"] === "object" ? item["tt:locations"]["tt:location"] : [];
    const labels = places.map((place) => locationLabel({ city: place["tt:city"], country: place["tt:country"] })
        || place["tt:name"] || "").filter(Boolean);
    return { labels: [...new Set(labels)], countries: places.map((place) => place["tt:country"] ?? "") };
}
function postedAt(value) {
    const time = value ? Date.parse(value) : Number.NaN;
    return Number.isNaN(time) ? null : new Date(time).toISOString();
}
function normalizeItem(item, company, capturedAt) {
    const where = locations(item);
    const workplace = WORKPLACE[item.remoteStatus ?? ""] ?? "unknown";
    const url = item.link.replace(/^http:\/\//i, "https://");
    const id = jobId(item);
    return normalizePublicJob({
        company, externalId: id, title: item.title, locations: where.labels,
        url, applyUrl: `https://${host(company)}/jobs/${id}/applications/new`,
        descriptionHtml: item.description, postedAt: postedAt(item.pubDate),
        workplaceType: workplace, isRemote: workplace === "remote",
    }, capturedAt, where.countries);
}
/** A hosted Teamtailor site: <company>.teamtailor.com. */
function boardFromUrl(raw) {
    let url;
    try {
        url = new URL(raw);
    }
    catch {
        return null;
    }
    const match = /^([a-z0-9-]+)\.teamtailor\.com$/.exec(url.hostname.toLowerCase());
    return match && !RESERVED.has(match[1]) ? { ats: "teamtailor", board: url.hostname.toLowerCase(), region: "global" } : null;
}
/**
 * A career site on the employer's own domain. Teamtailor's footer link names
 * the site it was served from (utm_content=<host>); a page served from
 * Teamtailor's CDN with a jobs list is the site itself.
 */
function boardFromPage(pageUrl, html) {
    const named = /teamtailor\.com\/[^"'\s<>]*[?&](?:amp;)?utm_content=([a-z0-9.-]+)/i.exec(html)?.[1]?.toLowerCase();
    if (named && HOST.test(named))
        return { ats: "teamtailor", board: named, region: "global" };
    let page;
    try {
        page = new URL(pageUrl).hostname.toLowerCase();
    }
    catch {
        return null;
    }
    if (/teamtailor-cdn\.com/i.test(html) && /href="[^"]*\/jobs(?:["/?])/i.test(html) && HOST.test(page))
        return boardFromUrl(`https://${page}/`) ?? { ats: "teamtailor", board: page, region: "global" };
    return null;
}
export const teamtailorAdapter = {
    kind: "teamtailor",
    listUrl,
    boardUrl: (company) => `https://${host(company)}/jobs`,
    async listJobs(company, capturedAt) {
        return (await readItems(company)).map((item) => normalizeItem(item, company, capturedAt));
    },
    async verifyBoard(company) {
        return boardVerification((await readItems(company)).map((item) => item.title));
    },
    probeUrls: () => [],
    boardFromUrl,
    boardFromPage,
};
