/**
 * Structured error type. Every tool failure carries a stable `code` so agents
 * can branch on it instead of parsing prose.
 */
export class AppError extends Error {
    code;
    details;
    constructor(code, message, details = {}) {
        super(message);
        this.name = "AppError";
        this.code = code;
        this.details = details;
    }
}
export function isAppError(value) {
    return value instanceof AppError;
}
export function toErrorMessage(error) {
    if (isAppError(error))
        return `[${error.code}] ${error.message}`;
    if (error instanceof Error)
        return error.message;
    return String(error);
}
