// Browser tests for the static site in _site/. `npm run test:site` builds the
// site, serves it and runs tests/site/*.spec.mjs in Chromium.
import { defineConfig, devices } from "@playwright/test";

const PORT = 47123;

export default defineConfig({
  testDir: "tests/site",
  testMatch: "*.spec.mjs",
  outputDir: "test-results",
  reporter: [["list"]],
  use: {
    baseURL: `http://localhost:${PORT}`,
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"], viewport: { width: 1200, height: 900 } },
      grepInvert: /@mobile/ },
    { name: "mobile", use: { ...devices["Pixel 7"] }, grep: /@mobile/ },
  ],
  webServer: {
    command: `python3 scripts/site.py && python3 -m http.server -d _site ${PORT}`,
    url: `http://localhost:${PORT}/es/`,
    reuseExistingServer: false,
    timeout: 60_000,
  },
});
