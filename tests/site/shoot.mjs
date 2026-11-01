// One screenshot of the built site, after optional clicks and a scroll, for
// looking at a change rather than asserting it. Serves _site/ itself, so run
// `python3 scripts/site.py` first.
//
//   npm run shoot -- "/es/#role=software-engineer" --click ".filter[data-k=role] .pick"
//   npm run shoot -- /es/ --width 390 --dark --scroll 1600 --out bar.png
//
// --width/--height  viewport (default 1200x900)
// --dark            prefers-color-scheme: dark
// --click SEL       click a selector; repeat for several, in order
// --scroll PX|SEL   scroll the window to a y offset, or a selector into view
// --full            the whole page instead of the viewport
// --out FILE        where to write (default test-results/shot.png)
import { chromium } from "@playwright/test";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";

const args = process.argv.slice(2);
const opts = { path: "/es/", width: 1200, height: 900, dark: false, clicks: [], scroll: null,
               full: false, out: "test-results/shot.png" };
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === "--width") opts.width = +args[++i];
  else if (a === "--height") opts.height = +args[++i];
  else if (a === "--dark") opts.dark = true;
  else if (a === "--click") opts.clicks.push(args[++i]);
  else if (a === "--scroll") opts.scroll = args[++i];
  else if (a === "--full") opts.full = true;
  else if (a === "--out") opts.out = args[++i];
  else if (!a.startsWith("--")) opts.path = a;
  else throw new Error(`unknown option ${a}`);
}

const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css",
                ".json": "application/json", ".txt": "text/plain", ".svg": "image/svg+xml" };
const root = join(process.cwd(), "_site");
const server = createServer(async (req, res) => {
  let path = normalize(decodeURIComponent(new URL(req.url, "http://x").pathname));
  if (path.endsWith("/")) path += "index.html";
  try {
    const body = await readFile(join(root, path));
    res.writeHead(200, { "content-type": TYPES[extname(path)] || "application/octet-stream" });
    res.end(body);
  } catch {
    res.writeHead(404).end();
  }
}).listen(0);
const port = server.address().port;

// Full Chromium, not the default headless shell: the shell skips
// backdrop-filter, so the sticky bar looked clear in shots when it was not.
const browser = await chromium.launch({ channel: "chromium" });
const page = await browser.newPage({ viewport: { width: opts.width, height: opts.height },
                                     colorScheme: opts.dark ? "dark" : "light" });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
await page.goto(`http://localhost:${port}${opts.path}`);
await page.locator("#companies tr.main").first().waitFor();
for (const sel of opts.clicks) await page.locator(sel).first().click();
if (opts.scroll != null) {
  if (/^\d+$/.test(opts.scroll)) await page.evaluate((y) => scrollTo(0, y), +opts.scroll);
  else await page.locator(opts.scroll).first().scrollIntoViewIfNeeded();
}
await page.waitForTimeout(300);
await page.screenshot({ path: opts.out, fullPage: opts.full });
await browser.close();
server.close();
console.log(opts.out);
if (errors.length) {
  console.error(errors.join("\n"));
  process.exit(1);
}
