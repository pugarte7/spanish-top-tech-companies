// Records the vertical video from scripts/x_video/video.html at 30 fps, with
// the track scripts/x_video/music.py writes: frames are shot at four times the
// page, kept whole as the 2160x3840 master and scaled down for the 1080x1920 cut. Needs ffmpeg, python3 and
// Playwright's Chromium.
//
//   node scripts/x_video.mjs [--stills 3,8,16]   (stills: PNGs of those seconds only)
import { chromium } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, "x_video", "out");
const FPS = 30;
mkdirSync(out, { recursive: true });

const browser = await chromium.launch();
const tab = await browser.newPage({ viewport: { width: 540, height: 960 }, deviceScaleFactor: 4 });
await tab.goto(pathToFileURL(join(here, "x_video", "video.html")).href);
await tab.evaluate(() => window.READY);
const stills = process.argv.indexOf("--stills");
if (stills > 0) {
  for (const s of process.argv[stills + 1].split(",")) {
    await tab.evaluate((t) => window.render(t), Number(s));
    await tab.screenshot({ path: join(out, `still-${s}.png`) });
  }
} else {
  const frames = mkdtempSync(join(tmpdir(), "x-video-"));
  const total = await tab.evaluate(() => window.TOTAL);
  for (let i = 0; i < total * FPS; i++) {
    await tab.evaluate((t) => window.render(t), i / FPS);
    await tab.screenshot({ path: join(frames, `f${String(i).padStart(4, "0")}.png`) });
  }
  const wav = join(frames, "music.wav");
  const cuts = await tab.evaluate(() => window.CUTS);
  execFileSync("python3", [join(here, "x_video", "music.py"), wav, String(total), ...cuts.map(String)], { stdio: "inherit" });
  const master = join(out, "mcp-mascot.es.4k.mp4"), cut = join(out, "mcp-mascot.es.mp4");
  const encode = (file, filter, crf) => execFileSync("ffmpeg", ["-loglevel", "error", "-y", "-framerate", String(FPS), "-i", join(frames, "f%04d.png"), "-i", wav,
    "-vf", filter, "-c:v", "libx264", "-preset", "slow", "-crf", crf, "-c:a", "aac", "-b:a", "192k", "-shortest", "-movflags", "+faststart", file], { stdio: "inherit" });
  encode(master, "format=yuv420p", "15");
  encode(cut, "scale=1080:1920:flags=lanczos,format=yuv420p", "12");
  rmSync(frames, { recursive: true, force: true });
  console.log(master, cut);
}
await browser.close();
