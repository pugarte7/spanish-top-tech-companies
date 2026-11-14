// Records the demo of an agent applying through the MCP: scripts/mcp_demo/demo.html
// replays, frame by frame, a search whose find_jobs and job_questions answers
// are real (remote backend postings and Pleo's live Ashby form, 2026-11-14).
// Two cuts per language: 16:10 as web/mcp-demo.<lang>.mp4, .webm and .jpg (its
// poster) for the site and docs/img/mcp-demo.<lang>.gif for the READMEs, and 4:5
// with larger type as web/mcp-demo-m.<lang>.* for the site on a phone. Needs
// ffmpeg and Playwright's Chromium.
//
//   node scripts/mcp_demo.mjs [es|en ...]
import { chromium } from "playwright";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const page = pathToFileURL(join(root, "scripts", "mcp_demo", "demo.html")).href;
const FPS = 30;
const POSTER_AT = 7;
// [layout, file name, width, height]; the frames are shot at twice that.
const CUTS = [["wide", "mcp-demo", 960, 600], ["tall", "mcp-demo-m", 600, 750]];
const ffmpeg = (...a) => execFileSync("ffmpeg", ["-loglevel", "error", "-y", ...a], { stdio: "inherit" });

const browser = await chromium.launch();
for (const lang of process.argv.slice(2).length ? process.argv.slice(2) : ["es", "en"]) {
  for (const [layout, name, width, height] of CUTS) {
    const frames = mkdtempSync(join(tmpdir(), `${name}-${lang}-`));
    const tab = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 2 });
    await tab.goto(`${page}?lang=${lang}&layout=${layout}`);
    await tab.evaluate(() => Promise.all([...document.fonts].map((f) => f.load())));
    const total = await tab.evaluate(() => window.TOTAL);
    // render() keeps the steps' highlight gliding, so frames are drawn in order.
    for (let i = 0; i < total * FPS; i++) {
      await tab.evaluate((t) => window.render(t), i / FPS);
      await tab.screenshot({ path: join(frames, `f${String(i).padStart(4, "0")}.png`) });
    }
    await tab.close();
    const input = ["-framerate", String(FPS), "-i", join(frames, "f%04d.png")];
    const out = (ext) => join(root, "web", `${name}.${lang}.${ext}`);
    // The site's copies at the frames' own size.
    ffmpeg(...input, "-vf", "format=yuv420p", "-c:v", "libx264",
           "-preset", "slow", "-crf", "19", "-tune", "animation", "-movflags", "+faststart", out("mp4"));
    ffmpeg(...input, "-c:v", "libvpx-vp9", "-b:v", "0", "-crf", "32", "-row-mt", "1", out("webm"));
    ffmpeg("-i", join(frames, `f${String(POSTER_AT * FPS).padStart(4, "0")}.png`), "-q:v", "6", out("jpg"));
    // 25 fps (4 centiseconds a frame, which GIF can say exactly) and one palette
    // for the whole loop keep it under GitHub's 10 MB.
    if (layout === "wide") {
      ffmpeg(...input, "-vf", `fps=25,scale=${width}:${height}:flags=lanczos,split[a][b];[a]palettegen=max_colors=96:stats_mode=diff[p];` +
             "[b][p]paletteuse=dither=none:diff_mode=rectangle", join(root, "docs", "img", `${name}.${lang}.gif`));
    }
    rmSync(frames, { recursive: true, force: true });
    console.log(`${name}.${lang}: mp4, webm, jpg${layout === "wide" ? ", gif" : ""}`);
  }
}
await browser.close();
