import { createHash, randomUUID } from "node:crypto";
export function sha256(input) {
    return createHash("sha256").update(input, "utf8").digest("hex");
}
/** Short, stable hash used for ids and fingerprints. */
export function shortHash(input, length = 16) {
    return sha256(input).slice(0, length);
}
export function newId(prefix) {
    return `${prefix}_${randomUUID().replace(/-/g, "").slice(0, 20)}`;
}
export function nowIso() {
    return new Date().toISOString();
}
export function daysBetween(from, to) {
    const ms = to.getTime() - from.getTime();
    return ms / (1000 * 60 * 60 * 24);
}
export function parseDateSafe(value) {
    if (!value)
        return null;
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
}
