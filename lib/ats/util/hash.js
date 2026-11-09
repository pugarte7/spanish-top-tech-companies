import { createHash } from "node:crypto";
export function sha256(input) {
    return createHash("sha256").update(input, "utf8").digest("hex");
}
/** Short, stable hash used for ids and fingerprints. */
export function shortHash(input, length = 16) {
    return sha256(input).slice(0, length);
}
export function nowIso() {
    return new Date().toISOString();
}
