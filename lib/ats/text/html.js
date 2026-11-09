/** HTML to plain text conversion for ATS job descriptions. */
const NAMED_ENTITIES = {
    amp: "&",
    lt: "<",
    gt: ">",
    quot: '"',
    apos: "'",
    nbsp: " ",
    ndash: "-",
    mdash: "-",
    rsquo: "'",
    lsquo: "'",
    rdquo: '"',
    ldquo: '"',
    hellip: "...",
    bull: "*",
    middot: "*",
};
export function decodeEntitiesOnce(input) {
    return input
        .replace(/&#x([0-9a-f]+);/gi, (_m, hex) => safeCodePoint(Number.parseInt(hex, 16)))
        .replace(/&#(\d+);/g, (_m, dec) => safeCodePoint(Number.parseInt(dec, 10)))
        .replace(/&([a-z]+);/gi, (match, name) => NAMED_ENTITIES[name.toLowerCase()] ?? match);
}
function safeCodePoint(code) {
    if (!Number.isFinite(code) || code < 0 || code > 0x10ffff)
        return "";
    try {
        return String.fromCodePoint(code);
    }
    catch {
        return "";
    }
}
/**
 * Greenhouse returns descriptions with HTML entities escaped, sometimes twice,
 * so entity decoding runs before and after tag stripping.
 */
export function htmlToText(input) {
    if (!input)
        return "";
    const decoded = decodeEntitiesOnce(decodeEntitiesOnce(input));
    const withoutScripts = decoded
        .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
        .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
        .replace(/<!--[\s\S]*?-->/g, " ");
    const withBreaks = withoutScripts
        .replace(/<\s*(br|hr)\s*\/?>/gi, "\n")
        .replace(/<\s*\/\s*(p|div|li|tr|h[1-6]|section|article|ul|ol|table)\s*>/gi, "\n")
        .replace(/<\s*li[^>]*>/gi, "\n- ");
    const stripped = withBreaks.replace(/<[^>]+>/g, " ");
    return normalizeWhitespace(decodeEntitiesOnce(stripped));
}
export function normalizeWhitespace(input) {
    return input
        .replace(/\r\n?/g, "\n")
        .replace(/[ \t\u00a0]+/g, " ")
        .replace(/ *\n */g, "\n")
        .replace(/\n{3,}/g, "\n\n")
        .trim();
}
/**
 * Lowercased, punctuation-collapsed text used for keyword matching. Accents go
 * first: kept, the letters that carry them fell to the punctuation rule and
 * "España" read as "espa a", so "A Coruña" never met "A Coruna".
 */
export function normalizeForMatch(input) {
    return input
        .normalize("NFD")
        .replace(/\p{M}/gu, "")
        .toLowerCase()
        .replace(/[\u2018\u2019]/g, "'")
        .replace(/[^a-z0-9+#./'\s-]/g, " ")
        .replace(/\s+/g, " ")
        .trim();
}
