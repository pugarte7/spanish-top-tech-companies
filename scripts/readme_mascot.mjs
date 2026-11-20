// Draws the mascot at the top of the READMEs, docs/img/mascot.gif: one loop of
// the scene web/mascot.js paints on the home page, on its own white card so it
// reads on GitHub's light and dark pages alike. Needs ffmpeg and Playwright's
// Chromium.
//
//   node scripts/readme_mascot.mjs
import { chromium } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const FPS = 12, WIDTH = 480;
const mascot = await readFile(join(root, "web", "mascot.js"), "utf8");
const antonio = (await readFile(join(root, "web", "fonts", "Antonio-Variable.woff2"))).toString("base64");

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: WIDTH, height: WIDTH * 5 / 8 }, deviceScaleFactor: 1 });
await page.setContent(`<!doctype html><meta charset="utf-8"><style>
@font-face { font-family: "Antonio"; font-weight: 100 700; src: url(data:font/woff2;base64,${antonio}) format("woff2"); }
html, body { margin: 0; background: #fff; }
canvas { display: block; width: 100%; }
</style><div id="scene"></div><script>${mascot}
const paint = mountMascot(document.getElementById("scene"), TRAZOS, "");
window.frame = (t) => paint(stateAt(t), gaze(t), SETTLED, t);
window.total = TOTAL;
</script>`);
await page.evaluate(() => document.fonts.load('600 20px "Antonio"'));
const frames = mkdtempSync(join(tmpdir(), "readme-mascot-"));
const total = await page.evaluate(() => window.total);
for (let i = 0; i < Math.round(total * FPS); i++) {
  await page.evaluate((t) => window.frame(t), i / FPS);
  await page.screenshot({ path: join(frames, `f${String(i).padStart(3, "0")}.png`) });
}
await browser.close();
const out = join(root, "docs", "img", "mascot.gif");
execFileSync("ffmpeg", ["-loglevel", "error", "-y", "-framerate", String(FPS), "-i", join(frames, "f%03d.png"),
  "-vf", "split[a][b];[a]palettegen=max_colors=8:stats_mode=full[p];[b][p]paletteuse=dither=none", "-loop", "0", out], { stdio: "inherit" });
rmSync(frames, { recursive: true, force: true });
console.log("docs/img/mascot.gif");
