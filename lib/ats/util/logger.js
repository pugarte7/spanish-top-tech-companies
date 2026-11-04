/**
 * Logging for an stdio MCP server.
 *
 * stdout is reserved for the JSON-RPC protocol stream, so every diagnostic goes
 * to stderr. Log records are redacted before they are written.
 */
import { redact } from "../text/redact.js";
const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };
function configuredLevel() {
    const raw = (process.env.AUTOAPPLY_LOG_LEVEL ?? "info").toLowerCase();
    return raw in LEVELS ? raw : "info";
}
function write(level, message, context) {
    if (LEVELS[level] < LEVELS[configuredLevel()])
        return;
    const record = {
        ts: new Date().toISOString(),
        level,
        message,
        ...(context ? { context } : {}),
    };
    process.stderr.write(`${redact(JSON.stringify(record))}\n`);
}
export const logger = {
    debug: (message, context) => write("debug", message, context),
    info: (message, context) => write("info", message, context),
    warn: (message, context) => write("warn", message, context),
    error: (message, context) => write("error", message, context),
};
