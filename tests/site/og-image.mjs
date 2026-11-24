// The site's images, all of the mascot: the tab icon (web/favicon.svg, its
// .ico for browsers that take no SVG and the 180px PNG for a phone's home
// screen) and the link preview (og:image) Slack, WhatsApp, LinkedIn and the
// rest show, 1200x630, one per language. The icon is
// the mascot's body with its two eyes, as clean lines: the hand-drawn
// wobble and the hatching turn to noise at 16 pixels. The preview is the top
// of the home page: the mascot at work over the headline, which is read from
// scripts/landing.py. Run it again after a change to either.
//
//   npm run og
import { chromium } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const web = join(root, "web");
const mascot = await readFile(join(web, "mascot.js"), "utf8");
const coast = mascot.match(/const COAST = "([^"]+)"/)[1];
const headlines = JSON.parse(execFileSync("python3", ["-c",
  "import json, landing; print(json.dumps({l: landing.TEXT[l]['h1'] for l in ('es', 'en')}))"],
  { cwd: join(root, "scripts"), encoding: "utf-8" }));
const font = (await readFile(join(web, "fonts", "InterTight-Variable.woff2"))).toString("base64");
const antonio = (await readFile(join(web, "fonts", "Antonio-Variable.woff2"))).toString("base64");

// The coast is 300 by 241 units and the face sits at (132, 112), as in mascot.js.
const eye = (x) => `<ellipse cx="${132 + x}" cy="112" rx="21" ry="31"/><circle cx="${138 + x}" cy="100" r="7.5" fill="#fff"/>`;
const icon = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-12 -42 324 324"><path d="${coast}" fill="#fff" stroke="#000" stroke-width="13" stroke-linejoin="round"/>${eye(-30)}${eye(30)}</svg>\n`;
await writeFile(join(web, "favicon.svg"), icon);
console.log("web/favicon.svg");

const browser = await chromium.launch();
const shot = async (size, background) => {
  const page = await browser.newPage({ viewport: { width: size, height: size } });
  const pad = background ? Math.round(size * .1) : 0;
  await page.setContent(`<body style="margin:0;padding:${pad}px;background:${background || "transparent"}">` +
    `<img src="data:image/svg+xml;base64,${Buffer.from(icon).toString("base64")}" style="display:block;width:${size - 2 * pad}px">`);
  const png = await page.screenshot({ type: "png", omitBackground: !background });
  await page.close();
  return png;
};
await writeFile(join(web, "apple-touch-icon.png"), await shot(180, "#fff"));
console.log("web/apple-touch-icon.png");
// An .ico holding one 32px PNG: a 6-byte header, one 16-byte entry, the image.
const png = await shot(32), head = Buffer.alloc(22);
head.writeUInt16LE(1, 2); head.writeUInt16LE(1, 4);
head[6] = 32; head[7] = 32; head.writeUInt16LE(1, 10); head.writeUInt16LE(32, 12);
head.writeUInt32LE(png.length, 14); head.writeUInt32LE(22, 18);
await writeFile(join(web, "favicon.ico"), Buffer.concat([head, png]));
console.log("web/favicon.ico");

const inked = (text) => text.replace(/\*\*(.+?)\*\*/g, "<mark>$1</mark>");
const html = (headline) => `<!doctype html><meta charset="utf-8"><style>
@font-face { font-family: "Inter Tight"; font-weight: 100 900; src: url(data:font/woff2;base64,${font}) format("woff2"); }
@font-face { font-family: "Antonio"; font-weight: 100 700; src: url(data:font/woff2;base64,${antonio}) format("woff2"); }
html, body { margin: 0; }
body { width: 1200px; height: 630px; overflow: hidden; background: #fff; color: #0a0a0a; text-align: center;
       font-family: "Inter Tight", sans-serif; }
#scene { width: 496px; margin: 18px auto 0; }
#scene canvas { display: block; width: 100%; }
h1 { margin: 6px auto 0; max-width: 1000px; font-size: 76px; font-weight: 500; letter-spacing: -.025em; line-height: 1.05; text-wrap: balance; }
mark { background: none; color: #0000f2; }
p { margin: 22px 0 0; font-size: 26px; color: #6b6b6b; }
</style>
<div id="scene"></div><h1>${inked(headline)}</h1><p>spanishtoptechcompanies.com</p>
<script>${mascot}
// Two CVs on their way, the rest of the pile waiting: a moment that reads at a glance.
document.fonts.load('600 20px "Antonio"').then(() => {
  mountMascot(document.getElementById("scene"), TRAZOS, "")(stateAt(2.05), gaze(2.05), SETTLED, 1);
  document.body.dataset.drawn = "";
});</script>`;

// A page each: the mascot's script declares its names once per page.
for (const [lang, headline] of Object.entries(headlines)) {
  const page = await browser.newPage({ viewport: { width: 1200, height: 630 } });
  await page.setContent(html(headline));
  await page.waitForSelector("body[data-drawn]", { state: "attached" });
  await page.evaluate(() => document.fonts.ready);
  await writeFile(join(web, `og-${lang}.png`), await page.screenshot({ type: "png" }));
  console.log(`web/og-${lang}.png`);
  await page.close();
}
await browser.close();
