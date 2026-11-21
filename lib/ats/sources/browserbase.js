import { AppError } from "../util/errors.js";
import { logger } from "../util/logger.js";
/**
 * Reads a page through a Browserbase cloud browser, for hosts whose bot
 * protection answers a plain request with a challenge.
 *
 * Cloudflare refuses GitHub's runners on some career sites (Revolut, Prosegur,
 * Capitole, Tracasa: "HTTP 403" every day on Actions, 200 from a home
 * connection). A real browser passes the challenge; once it has, the page's
 * own fetch() reads the URL with the clearance cookie and returns the body as
 * the server sent it, so an adapter gets the same HTML, XML or JSON it would
 * have read directly.
 *
 * http.js comes here for a host on the known list (readDirectly) at once, and
 * for any other after a plain request is still refused once retried.
 *
 * Only with BROWSERBASE_API_KEY. One session for the process, opened on the
 * first refusal and released once nothing has used it for IDLE_MS (Browserbase
 * bills a session's minutes), one tab per host. Talks the DevTools protocol
 * over Node's own WebSocket: no browser library. The browser's User-Agent
 * gets the crawler's own appended, so the site still sees who is asking.
 */
const API = "https://api.browserbase.com/v1";
const IDLE_MS = 20_000;
/** Seconds Browserbase keeps a session at most, should release never come. */
const SESSION_SECONDS = 1800;
const CHALLENGE_MS = 30_000;
const CHALLENGE_TITLE = /just a moment|un momento|attention required|checking your browser/i;
export function browserbaseEnabled() {
    return Boolean(process.env.BROWSERBASE_API_KEY);
}
/** Hosts read through the browser from the first request (data/browser-hosts.json). */
const directHosts = new Set();
/** Hosts that refused a plain request this run and answered the browser. */
const learnedHosts = new Set();
export function readDirectly(hosts) {
    for (const host of hosts)
        directHosts.add(String(host).toLowerCase());
}
/** A host on the list, or one that needed the browser earlier in this run. */
export function readsDirectly(host) {
    return directHosts.has(host.toLowerCase()) || learnedHosts.has(host.toLowerCase());
}
export function noteReadThroughBrowser(host) {
    if (!directHosts.has(host.toLowerCase()))
        learnedHosts.add(host.toLowerCase());
}
/** Hosts this run found needing the browser, to add to the known list. */
export function learnedBrowserHosts() {
    return [...learnedHosts].sort();
}
/** True for a refusal by Cloudflare's bot challenge, the one a browser passes. */
export function isChallenge(response) {
    if (response.status !== 403 && response.status !== 503)
        return false;
    return response.headers.get("cf-mitigated") === "challenge"
        || /chlray/.test(response.headers.get("server-timing") ?? "");
}
function api(path, body) {
    return fetch(`${API}${path}`, {
        method: "POST",
        headers: { "X-BB-API-Key": process.env.BROWSERBASE_API_KEY ?? "", "content-type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(30_000),
    });
}
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let browser = null;
let users = 0;
let idleTimer = null;
/** A new Browserbase session: `{ id, connectUrl }`, the DevTools endpoint. */
export async function createSession(seconds = SESSION_SECONDS) {
    const response = await api("/sessions", { timeout: seconds });
    if (!response.ok)
        throw new AppError("browser_error", `Browserbase answered HTTP ${response.status} creating a session`);
    return response.json();
}
export async function releaseSession(id) {
    await api(`/sessions/${id}`, { status: "REQUEST_RELEASE" }).catch(() => { });
}
async function openSession() {
    const session = await createSession();
    const socket = new WebSocket(session.connectUrl);
    const pending = new Map();
    let next = 0;
    socket.onmessage = (event) => {
        const message = JSON.parse(String(event.data));
        const waiter = message.id && pending.get(message.id);
        if (!waiter)
            return;
        pending.delete(message.id);
        if (message.error)
            waiter.reject(new AppError("browser_error", message.error.message));
        else
            waiter.resolve(message.result);
    };
    socket.onclose = () => {
        for (const waiter of pending.values())
            waiter.reject(new AppError("browser_error", "browser connection closed"));
        pending.clear();
        if (browser?.socket === socket)
            browser = null;
    };
    await new Promise((resolve, reject) => {
        socket.onopen = resolve;
        socket.onerror = () => reject(new AppError("browser_error", "could not connect to the Browserbase session"));
    }).catch(async (error) => {
        await releaseSession(session.id);
        throw error;
    });
    const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
        next += 1;
        pending.set(next, { resolve, reject });
        socket.send(JSON.stringify({ id: next, method, params, sessionId }));
    });
    logger.info("browserbase session opened", { session: session.id });
    return { id: session.id, socket, send, tabs: new Map() };
}
async function session() {
    clearTimeout(idleTimer);
    browser ??= openSession().catch((error) => {
        browser = null;
        throw error;
    });
    return browser;
}
/** Releases the session; the next refusal opens another. */
export async function closeBrowser() {
    clearTimeout(idleTimer);
    const current = browser;
    browser = null;
    if (!current)
        return;
    const opened = await current.catch(() => null);
    if (!opened)
        return;
    opened.socket.close();
    await releaseSession(opened.id);
    logger.info("browserbase session released", { session: opened.id });
}
async function tab(opened, host, userAgent) {
    if (!opened.tabs.has(host)) {
        opened.tabs.set(host, (async () => {
            const { targetId } = await opened.send("Target.createTarget", { url: "about:blank" });
            const { sessionId } = await opened.send("Target.attachToTarget", { targetId, flatten: true });
            const evaluate = async (expression) => {
                const { result, exceptionDetails } = await opened.send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true }, sessionId);
                if (exceptionDetails)
                    throw new AppError("browser_error", exceptionDetails.exception?.description ?? exceptionDetails.text);
                return result.value;
            };
            const agent = await evaluate("navigator.userAgent");
            await opened.send("Network.setUserAgentOverride", { userAgent: `${agent} ${userAgent}` }, sessionId);
            return { sessionId, evaluate };
        })());
    }
    return opened.tabs.get(host);
}
/** Loads `url` in the host's tab and waits for the challenge page to give way. */
async function pass(opened, page, url) {
    // The URL itself, also for an API that takes a POST: it puts the tab on the
    // API's origin, where its home page may be an error (Workday's is).
    await opened.send("Page.navigate", { url }, page.sessionId);
    const deadline = Date.now() + CHALLENGE_MS;
    while (Date.now() < deadline) {
        await sleep(1_500);
        const state = await page.evaluate("[document.readyState, document.title]").catch(() => null);
        if (state && state[0] !== "loading" && !CHALLENGE_TITLE.test(state[1]))
            return;
    }
    throw new AppError("browser_error", `challenge not passed in ${CHALLENGE_MS / 1000}s: ${new URL(url).host}`);
}
const IN_PAGE_FETCH = `async (url, init) => {
  const response = await fetch(url, { ...init, credentials: "include" });
  return { status: response.status, url: response.url, challenge: response.headers.get("cf-mitigated") === "challenge",
           text: await response.text() };
}`;
/**
 * Reads `url` as the page's own fetch() would: the status, the final URL and
 * the body. `init` holds method, headers and body.
 */
export async function fetchThroughBrowser(url, init, userAgent) {
    users += 1;
    try {
        const opened = await session();
        const page = await tab(opened, new URL(url).host, userAgent);
        const read = () => page.evaluate(`(${IN_PAGE_FETCH})(${JSON.stringify(url)}, ${JSON.stringify(init)})`);
        let result = page.passed ? await read() : null;
        if (!result || result.challenge) {
            await pass(opened, page, url);
            page.passed = true;
            result = await read();
        }
        return result;
    }
    finally {
        users -= 1;
        if (users === 0) {
            clearTimeout(idleTimer);
            idleTimer = setTimeout(() => void closeBrowser(), IDLE_MS);
            idleTimer.unref?.();
        }
    }
}
