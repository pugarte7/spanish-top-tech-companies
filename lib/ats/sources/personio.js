import { XMLParser, XMLValidator } from "fast-xml-parser";
import { z } from "zod";
import { AppError } from "../util/errors.js";
import { fetchText } from "./http.js";
import { boardToken, boardVerification, nonEmptyText, normalizePublicJob, optionalText, parseSourcePayload, postingIdentifier, publishedDate, } from "./sourceValidation.js";
/**
 * Personio career sites: `<company>.jobs.personio.de` (or `.com`).
 *
 * Board: the subdomain (`tado`). `/xml` is the public feed of every published
 * position with its description, so one request reads the whole board.
 *
 * The office is free text, usually "City" or "Country - City"; the second is
 * turned round to "City, Country" so the location classifier reads it.
 */
const RESERVED = new Set(["www", "api", "app", "support", "status", "jobs"]);
const sectionSchema = z.object({ name: optionalText, value: optionalText });
const officeList = z.union([z.literal(""), z.object({ office: z.array(optionalText) })]).optional();
const positionSchema = z.object({
    id: postingIdentifier, name: nonEmptyText,
    subcompany: optionalText, office: optionalText, additionalOffices: officeList,
    department: optionalText, employmentType: optionalText, schedule: optionalText, createdAt: optionalText,
    jobDescriptions: z.union([z.literal(""), z.object({ jobDescription: z.array(sectionSchema) })]).optional(),
}).passthrough();
const feedSchema = z.object({
    "workzag-jobs": z.union([z.literal(""), z.object({ position: z.array(positionSchema) })]),
}).strict();
function host(company) {
    const token = boardToken(company.board, true);
    if (RESERVED.has(token))
        throw new AppError("invalid_board", `not a Personio company: ${company.board}`, { board: company.board });
    return `${token}.jobs.personio.de`;
}
const listUrl = (company) => `https://${host(company)}/xml?language=en`;
export function parsePersonioFeed(xml) {
    const markup = xml.replace(/<!\[CDATA\[[\s\S]*?\]\]>|<!--[\s\S]*?-->/g, "");
    if (/<!\s*(?:DOCTYPE|ENTITY)\b/i.test(markup))
        throw new AppError("unsafe_xml", "Personio XML must not contain DOCTYPE or entity declarations");
    if (/&(?!(?:amp|lt|gt|quot|apos|#\d+|#x[\da-fA-F]+);)/.test(markup))
        throw new AppError("unsafe_xml", "Personio XML contains an undeclared entity");
    if (XMLValidator.validate(xml) !== true)
        throw new AppError("invalid_source_payload", "Personio returned malformed XML");
    const parser = new XMLParser({
        ignoreAttributes: true, ignoreDeclaration: true, parseTagValue: false,
        processEntities: true, trimValues: true,
        isArray: (_name, path) => ["workzag-jobs.position", "workzag-jobs.position.jobDescriptions.jobDescription",
            "workzag-jobs.position.additionalOffices.office"].includes(path),
    });
    const feed = parseSourcePayload(feedSchema, parser.parse(xml), "Personio XML");
    const positions = feed["workzag-jobs"] === "" ? [] : feed["workzag-jobs"].position;
    if (new Set(positions.map((p) => p.id)).size !== positions.length)
        throw new AppError("invalid_source_payload", "Personio XML contains repeated position identifiers");
    return positions;
}
/** "Spain - Barcelona" -> "Barcelona, Spain"; "Barcelona" stays. */
export function personioOffice(office) {
    const text = (office ?? "").trim();
    const parts = text.split(/\s+-\s+/).map((part) => part.trim()).filter(Boolean);
    return parts.length === 2 ? `${parts[1]}, ${parts[0]}` : text;
}
async function readPositions(company) {
    const xml = await fetchText(listUrl(company), { allowedHosts: [host(company)], accept: "application/xml, text/xml" });
    return parsePersonioFeed(xml);
}
function normalizePosition(position, company, capturedAt) {
    const offices = [position.office, ...(position.additionalOffices ? position.additionalOffices.office : [])];
    const locations = [...new Set(offices.map(personioOffice).filter(Boolean))];
    const remote = locations.length > 0 && locations.every((label) => /remote|home/i.test(label));
    const sections = position.jobDescriptions ? position.jobDescriptions.jobDescription : [];
    const url = `https://${host(company)}/job/${position.id}?language=en`;
    return normalizePublicJob({
        company, externalId: position.id, title: position.name, locations,
        url, applyUrl: `${url}#apply`,
        descriptionHtml: sections.map((s) => [s.name ? `<h3>${s.name}</h3>` : "", s.value ?? ""].join("")).join("\n"),
        postedAt: publishedDate(position.createdAt ?? undefined),
        workplaceType: remote ? "remote" : "unknown", isRemote: remote,
        employmentType: position.employmentType ?? undefined,
    }, capturedAt, []);
}
export const personioAdapter = {
    kind: "personio",
    listUrl,
    boardUrl: (company) => `https://${host(company)}/`,
    async listJobs(company, capturedAt) {
        return (await readPositions(company)).map((position) => normalizePosition(position, company, capturedAt));
    },
    async verifyBoard(company) {
        return boardVerification((await readPositions(company)).map((position) => position.name));
    },
    probeUrls: () => [],
    boardFromUrl(raw) {
        try {
            const sub = /^([a-z0-9-]+)\.jobs\.personio\.(?:de|com)$/i.exec(new URL(raw).hostname)?.[1]?.toLowerCase();
            return sub && !RESERVED.has(sub) ? { ats: "personio", board: sub, region: "global" } : null;
        }
        catch {
            return null;
        }
    },
    boardFromPage(_pageUrl, html) {
        for (const match of String(html).matchAll(/https?:\/\/[a-z0-9-]+\.jobs\.personio\.(?:de|com)[^\s"'<>)]*/gi)) {
            const board = personioAdapter.boardFromUrl(match[0]);
            if (board)
                return board;
        }
        return null;
    },
};
