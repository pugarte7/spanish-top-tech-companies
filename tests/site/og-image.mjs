// The link preview (og:image) for Slack, WhatsApp, LinkedIn and the rest: the
// banner's blue field and lazo de seis, the tile favicon and the page's title,
// 1200x630, one per language. No figures, which would go stale between
// redraws. Writes web/og-es.png and web/og-en.png; run it again after a
// change to the title, the tile or the field.
//
//   npm run og
import { chromium } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const web = join(root, "web");
// site.py's own tile, so the preview stays the banner's pattern.
const lazo = execFileSync("python3", ["-c",
  "import importlib.util as u; s = u.spec_from_file_location('stc', 'site.py'); "
  + "m = u.module_from_spec(s); s.loader.exec_module(m); print(m.lazo_de_seis())"],
  { cwd: join(root, "scripts"), encoding: "utf-8" });
const font = async (name) => (await readFile(join(web, "fonts", name))).toString("base64");
const [antonio, barlow] = await Promise.all([font("Antonio-Variable.woff2"), font("Barlow-Medium.woff2")]);
const icon = (await readFile(join(web, "favicon.svg"))).toString("base64");
const cenefa = (await readFile(join(web, "cenefa.svg"))).toString("base64");

const TITLES = {
  es: "Las empresas tech que más pagan en España",
  en: "The tech companies in Spain that pay the most",
};

const html = (title) => `<!doctype html><meta charset="utf-8"><style>
@font-face { font-family: Antonio; font-weight: 100 700; src: url(data:font/woff2;base64,${antonio}) format("woff2"); }
@font-face { font-family: Barlow; font-weight: 500; src: url(data:font/woff2;base64,${barlow}) format("woff2"); }
html, body { margin: 0; }
body { width: 1200px; height: 630px; position: relative; overflow: hidden; background: #0000f2; color: #f2f2f2; }
.tile-defs { position: absolute; width: 0; height: 0; overflow: hidden; }
.tile-defs .tint polygon { fill: rgba(0, 0, 0, .14); }
.tile-defs .edge polygon { fill: none; stroke: rgba(242, 242, 242, .92); stroke-linejoin: round; }
.tile-defs .band polygon { fill: none; stroke: #0000d0; stroke-linejoin: round; }
.wall { position: absolute; inset: 0; }
.frieze { position: absolute; left: 0; right: 0; height: 22px; background: url(data:image/svg+xml;base64,${cenefa}) 0 0 / 28px 22px repeat-x #0000f2; }
.frieze.top { top: 10px; } .frieze.bottom { bottom: 10px; }
.card { position: absolute; left: 50%; top: 50%; transform: translate(-50%, -50%); width: 900px;
        display: grid; justify-items: center; gap: 22px; text-align: center; }
.card::before { content: ""; position: absolute; z-index: -1; inset: -16px -40px; border-radius: 40px;
                background: #0000f2; box-shadow: 0 0 60px 40px #0000f2; }
.card { isolation: isolate; }
img { width: 104px; height: 104px; display: block; }
.brand { font: 500 26px/1 Antonio; letter-spacing: .2em; text-transform: uppercase; }
h1 { margin: 0; font: 200 76px/1.04 Antonio; text-wrap: balance; }
.url { font: 500 24px/1 Barlow; color: #dcdcfa; letter-spacing: .02em; }
</style>
${lazo}
<div class="wall"><svg width="1200" height="630"><rect width="100%" height="100%" fill="url(#lazo)"/></svg></div>
<div class="frieze top"></div><div class="frieze bottom"></div>
<div class="card">
  <img src="data:image/svg+xml;base64,${icon}" alt="">
  <div class="brand">Spanish Top Tech Companies</div>
  <h1>${title}</h1>
  <div class="url">spanishtoptechcompanies.com</div>
</div>`;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1200, height: 630 } });
for (const [lang, title] of Object.entries(TITLES)) {
  await page.setContent(html(title));
  await page.evaluate(() => document.fonts.ready);
  await writeFile(join(web, `og-${lang}.png`), await page.screenshot({ type: "png" }));
  console.log(`web/og-${lang}.png`);
}
await browser.close();
