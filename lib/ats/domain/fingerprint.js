import { shortHash } from "../util/hash.js";
/**
 * Duplicate detection.
 *
 * The same role often appears under several requisition ids, on more than one
 * board, or reposted weeks later. Two fingerprints are kept: an exact one for
 * the identical posting and a fuzzy one for the same role.
 */
const TITLE_NOISE = [
    /\(.*?\)/g,
    /\[.*?\]/g,
    /\b(?:req(?:uisition)?\s*#?\s*\d+)\b/gi,
    /\b(?:job\s*id\s*:?\s*\d+)\b/gi,
    /\b(?:remote|hybrid|onsite|on-site)\b/gi,
    /\b(?:full[- ]time|part[- ]time|contract|permanent)\b/gi,
    /\b(?:us|usa|canada|ca|uk|emea|amer|apac)\b/gi,
    /[,\-–—|/]+/g,
];
const LEVEL_TOKENS = /\b(?:i{1,3}|iv|v|vi|[1-5]|l[3-8]|e[3-8])\b/gi;
export function normalizeCompanyName(name) {
    return name
        .toLowerCase()
        .replace(/[.,]/g, "")
        .replace(/\b(?:inc|llc|ltd|limited|corp|corporation|co|company|technologies|technology|labs|holdings|group)\b/g, "")
        .replace(/[^a-z0-9]+/g, "")
        .trim();
}
export function normalizeTitle(title) {
    const stripped = TITLE_NOISE.reduce((value, pattern) => value.replace(pattern, " "), title.toLowerCase());
    return stripped
        .replace(LEVEL_TOKENS, " ")
        .replace(/[^a-z0-9+#\s]/g, " ")
        .replace(/\s+/g, " ")
        .trim();
}
/** Identifies one exact posting on one board. */
export function exactFingerprint(ats, board, externalId) {
    return shortHash(`${ats}|${board}|${externalId}`.toLowerCase());
}
/** Identifies the same role across reposts and boards. */
export function roleFingerprint(companyName, title, locationClass) {
    return shortHash(`${normalizeCompanyName(companyName)}|${normalizeTitle(title)}|${locationClass}`);
}
