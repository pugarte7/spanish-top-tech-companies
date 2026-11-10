// Records the demo of an agent applying through the MCP: scripts/mcp_demo/demo.html
// replays, frame by frame, a session whose find_jobs and job_questions answers
// are real (Workato's open postings and its live Greenhouse form, 2026-11-10).
// Writes, per language, web/mcp-demo.<lang>.mp4, .webm and .jpg (its poster) for the
// site and docs/img/mcp-demo.<lang>.gif for the READMEs. Needs ffmpeg and
// Playwright's Chromium.
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
const POSTER_AT = 9.5;
const ffmpeg = (...a) => execFileSync("ffmpeg", ["-loglevel", "error", "-y", ...a], { stdio: "inherit" });

const browser = await chromium.launch();
for (const lang of process.argv.slice(2).length ? process.argv.slice(2) : ["es", "en"]) {
  const frames = mkdtempSync(join(tmpdir(), `mcp-demo-${lang}-`));
  const tab = await browser.newPage({ viewport: { width: 960, height: 600 }, deviceScaleFactor: 2 });
  await tab.goto(`${page}?lang=${lang}`);
  await tab.evaluate(() => document.fonts.ready);
  const total = await tab.evaluate(() => window.TOTAL);
  // render() keeps state (the log, the scroll), so frames are drawn in order.
  for (let i = 0; i < total * FPS; i++) {
    await tab.evaluate((t) => window.render(t), i / FPS);
    await tab.screenshot({ path: join(frames, `f${String(i).padStart(4, "0")}.png`) });
  }
  await tab.close();
  const input = ["-framerate", String(FPS), "-i", join(frames, "f%04d.png")];
  // The site's copies at the frames' own size, 1920x1200 (960x600 at 2x).
  ffmpeg(...input, "-vf", "format=yuv420p", "-c:v", "libx264",
         "-preset", "slow", "-crf", "19", "-tune", "animation", "-movflags", "+faststart", join(root, "web", `mcp-demo.${lang}.mp4`));
  ffmpeg(...input, "-c:v", "libvpx-vp9", "-b:v", "0", "-crf", "32",
         "-row-mt", "1", join(root, "web", `mcp-demo.${lang}.webm`));
  ffmpeg("-i", join(frames, `f${String(POSTER_AT * FPS).padStart(4, "0")}.png`), "-q:v", "6", join(root, "web", `mcp-demo.${lang}.jpg`));
  // 25 fps (4 centiseconds a frame, which GIF can say exactly) and one palette
  // for the whole loop keep it under GitHub's 10 MB.
  ffmpeg(...input, "-vf", "fps=25,scale=960:600:flags=lanczos,split[a][b];[a]palettegen=max_colors=96:stats_mode=diff[p];" +
         "[b][p]paletteuse=dither=none:diff_mode=rectangle", join(root, "docs", "img", `mcp-demo.${lang}.gif`));
  rmSync(frames, { recursive: true, force: true });
  console.log(`mcp-demo.${lang}: mp4, webm, jpg, gif`);
}
await browser.close();
