// What the page promises a reader, checked in a real browser. Run with
// `npm run test:site`; see .claude/skills/test-site/SKILL.md.
import { test, expect } from "@playwright/test";

const num = (s) => Number(String(s).replace(/[^\d]/g, ""));
const rows = (page) => page.locator("#companies tr.main");
const filter = (page, k) => page.locator(`.filter[data-k="${k}"]`);
const hash = (page) => new URLSearchParams(new URL(page.url()).hash.slice(1));

// Fail any test on a script error or a failed request.
test.beforeEach(async ({ page }) => {
  const problems = [];
  page.on("pageerror", (e) => problems.push(`pageerror: ${e.message}`));
  page.on("console", (m) => m.type() === "error" && problems.push(`console: ${m.text()}`));
  page.on("response", (r) => r.status() >= 400 && problems.push(`${r.status()} ${r.url()}`));
  page.problems = problems;
});
test.afterEach(async ({ page }) => {
  expect(page.problems, "errors in the page").toEqual([]);
});

async function open(page, path = "/es/") {
  await page.goto(path);
  await expect(rows(page).first()).toBeVisible();
}

test("loads with figures in every card", async ({ page }) => {
  await open(page);
  for (const id of ["k-median", "k-total", "k-share", "k-people", "k-companies"])
    await expect(page.locator(`#${id}`)).not.toHaveText(/^—?$/);
  await expect(page.locator("#map .region.has").first()).toBeVisible();
  await expect(page.locator("#matrix button").first()).toBeVisible();
  await expect(page.locator("#summary dd").first()).not.toBeEmpty();
});

test("matrix: roles with most salaries, a cell filters the table", async ({ page }) => {
  await open(page);
  const counts = (await page.locator("#matrix tbody th small").allTextContents()).map(num);
  expect(counts.length).toBe(8);
  expect(counts).toEqual([...counts].sort((a, b) => b - a));
  await expect(page.locator("#matrix tbody th").first()).toContainText("Software Engineer");

  const cell = page.locator('#matrix button[data-role="product-manager"][data-years="8-11"]');
  const median = await cell.textContent();
  await cell.click();
  await expect(filter(page, "role").locator(".txt")).toHaveText("Product Manager");
  await expect(filter(page, "years").locator(".txt")).toHaveText("8–11 años");
  expect(hash(page).get("role")).toBe("product-manager");
  expect(hash(page).get("years")).toBe("8-11");
  // The summary is the same group of people as the cell: "75k" there, 75.000 € here.
  const euros = Math.round(parseFloat(median.replace(",", ".")) * 1000);
  await expect.poll(async () => num(await page.locator("#summary dd").first().textContent())).toBe(euros);
  await expect(page.locator("#companies-card")).toBeInViewport();
});

test("summary follows the table's filters", async ({ page }) => {
  await open(page);
  const figures = () => page.locator("#summary dd").allTextContents();
  const all = await figures();
  expect(all).toHaveLength(4);
  await expect(page.locator("#summary .dist .bars i")).toHaveCount(15);

  await filter(page, "role").locator(".pick").click();
  await page.locator('.menu li[data-v="software-engineer"]').click();
  await expect.poll(figures).not.toEqual(all);
  const se = await figures();
  expect(num(se[3])).toBeLessThan(num(all[3]));

  // Every band answers a hover, short bars included.
  await page.locator("#summary .dist .col").nth(5).hover();
  await expect(page.locator("#tip")).toBeVisible();
  await expect(page.locator("#tip")).toContainText("salarios");

  // Search narrows the companies, not the summary.
  await page.locator("#search").fill("glovo");
  expect(await figures()).toEqual(se);
});

test("map switches between pay and number of salaries", async ({ page }) => {
  await open(page);
  const values = async () => (await page.locator("#ranking .v").allTextContents()).map(num);
  const sortedDesc = (v) => v.every((x, i) => i === 0 || v[i - 1] >= x);

  await expect(page.locator("#map-metric [data-m=pay]")).toHaveAttribute("aria-pressed", "true");
  expect(sortedDesc(await values())).toBe(true);
  const sub = await page.locator("#map-sub").textContent();

  await page.locator("#map-metric [data-m=count]").click();
  await expect(page.locator("#map-metric [data-m=count]")).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("#map-sub")).not.toHaveText(sub);
  const counts = await values();
  expect(sortedDesc(counts)).toBe(true);
  expect(counts[0]).toBeGreaterThan(1000);
});

test("the map draws every region and the ranking lists all of those with data", async ({ page }) => {
  await open(page);
  const codes = await page.locator("#map .region").evaluateAll((ps) => ps.map((p) => p.dataset.code).sort());
  expect(codes).toEqual(["AN", "AR", "AS", "CB", "CE", "CL", "CM", "CN", "CT", "EX", "GA", "IB", "MD",
                         "ML", "MU", "NC", "PV", "RI", "VC"]);
  // Cataluña has the most salaries; it once went missing from the map.
  await expect(page.locator('#map .region[data-code="CT"]')).toHaveClass(/has/);
  await expect(page.locator("#ranking li")).toHaveCount(await page.locator("#map .region.has").count());
  const [scroll, client] = await page.locator("#ranking").evaluate((el) => [el.scrollHeight, el.clientHeight]);
  expect(scroll).toBeLessThanOrEqual(client);
});

test("only the top bar sticks when scrolling", async ({ page }) => {
  await open(page);
  await page.locator("#companies-card").scrollIntoViewIfNeeded();
  const stuck = await page.evaluate(() => [...document.querySelectorAll("body *")]
    .filter((e) => getComputedStyle(e).position === "sticky")
    .filter((e) => !e.matches(".topbar, .matrix tbody th"))
    .map((e) => e.outerHTML.slice(0, 60)));
  expect(stuck).toEqual([]);
  // The map ranking has scrolled away, not stuck under the top bar.
  expect((await page.locator("#ranking .bar").first().boundingBox()).y).toBeLessThan(0);
});

test("link logos sit in the same place on every row", async ({ page }) => {
  await open(page);
  const xs = await page.locator("#companies tr.main .links").evaluateAll((els) =>
    els.map((l) => [...l.children].map((c) => Math.round(c.getBoundingClientRect().left))));
  expect(xs.length).toBeGreaterThan(5);
  for (const row of xs) expect(row).toEqual(xs[0]);
});

test("role menu: most salaries first, with specializations", async ({ page }) => {
  await open(page);
  await filter(page, "role").locator(".pick").click();
  const counts = (await page.locator(".menu li.role small").allTextContents()).map(num);
  expect(counts.length).toBeGreaterThan(5);
  expect(counts).toEqual([...counts].sort((a, b) => b - a));
  await expect(page.locator(".menu li.role").first()).toContainText("Software Engineer");

  await page.locator('.twist[data-toggle="software-engineer"]').click();
  const specs = page.locator(".menu li.spec");
  await expect(specs.first()).toBeVisible();
  await specs.first().click();
  await expect(filter(page, "role")).toHaveClass(/on/);
  await expect(filter(page, "role").locator(".txt")).toContainText("Software Engineer ·");
  expect(hash(page).get("role")).toMatch(/^software-engineer\//);
  await expect(rows(page).first()).toBeVisible();
});

test("experience is a span picked with two handles", async ({ page }) => {
  await open(page);
  const before = await rows(page).count();
  await filter(page, "years").locator(".pick").click();
  const set = (id, v) => page.locator(id).evaluate((el, v) => {
    el.value = v;
    el.dispatchEvent(new Event("input", { bubbles: true }));
  }, v);
  await set("#span-from", "2");
  await set("#span-to", "3");
  await expect(page.locator("#span-text")).toHaveText("5–11 años");
  await expect(filter(page, "years").locator(".txt")).toHaveText("5–11 años");
  expect(hash(page).get("years")).toBe("5-7,8-11");
  expect(await rows(page).count()).toBeGreaterThan(0);

  // Handles cannot cross: dragging "from" past "to" carries "to" along.
  await set("#span-from", "4");
  await expect(page.locator("#span-to")).toHaveValue("4");
  await expect(page.locator("#span-text")).toHaveText("12–19 años");

  await page.locator(".menu.span [data-v='']").click();
  await expect(filter(page, "years")).not.toHaveClass(/on/);
  expect(hash(page).get("years")).toBeNull();
  expect(await rows(page).count()).toBe(before);
});

test("work arrangement takes several, and all of them means any", async ({ page }) => {
  await open(page);
  await filter(page, "modes").locator(".pick").click();
  await page.locator('.menu li[data-v="remote"]').click();
  await page.locator('.menu li[data-v="hybrid"]').click();
  // The menu stays open while ticking.
  await expect(page.locator('.menu li[data-v="office"]')).toBeVisible();
  await expect(filter(page, "modes").locator(".txt")).toHaveText("Remoto, Híbrido");
  expect(hash(page).get("work")).toBe("remote,hybrid");

  await page.locator('.menu li[data-v="office"]').click();
  await expect(filter(page, "modes")).not.toHaveClass(/on/);
  expect(hash(page).get("work")).toBeNull();

  await page.keyboard.press("Escape");
  await expect(page.locator(".menu")).toHaveCount(0);
});

test("a link restores its filters", async ({ page }) => {
  await open(page, "/es/#role=software-engineer&years=5-7,8-11&work=remote");
  await expect(filter(page, "role").locator(".txt")).toHaveText("Software Engineer");
  await expect(filter(page, "years").locator(".txt")).toHaveText("5–11 años");
  await expect(filter(page, "modes").locator(".txt")).toHaveText("Remoto");
});

test("clicking a column sorts it, again reverses it", async ({ page }) => {
  await open(page);
  const th = page.locator('#companies th[data-sort="n"]');
  const ns = async () => (await page.locator("#companies tr.main td:last-child").allTextContents()).map(num);

  await th.click();
  await expect(th).toHaveAttribute("aria-sort", "descending");
  let v = await ns();
  expect(v).toEqual([...v].sort((a, b) => b - a));

  await th.click();
  await expect(th).toHaveAttribute("aria-sort", "ascending");
  v = await ns();
  expect(v).toEqual([...v].sort((a, b) => a - b));

  await page.locator('#companies th[data-sort="median"]').click();
  await expect(page.locator('#companies th[data-sort="median"]')).toHaveAttribute("aria-sort", "descending");
});

test("a row opens with the mouse and the keyboard", async ({ page }) => {
  await open(page);
  const row = rows(page).first();
  const detail = row.locator("xpath=following-sibling::tr[1]");
  await row.click();
  await expect(row).toHaveAttribute("aria-expanded", "true");
  await expect(detail).toBeVisible();
  await expect(detail).toContainText("Acciones");
  await expect(detail).not.toContainText("Frente al mercado");

  await row.focus();
  await page.keyboard.press("Enter");
  await expect(row).toHaveAttribute("aria-expanded", "false");
  await expect(detail).toBeHidden();
});

test("an open row shows how total pay splits, adding up to 100%", async ({ page }) => {
  await open(page);
  const row = rows(page).first();
  await row.click();
  const key = row.locator("xpath=following-sibling::tr[1]").locator(".mix-key li");
  await expect(key).toHaveText([/^Base \d+%$/, /^Bonus \d+%$/, /^Acciones \d+%$/]);
  const sum = (await key.allTextContents()).reduce((s, t) => s + +t.match(/(\d+)%/)[1], 0);
  expect(sum).toBe(100);
});

test("links that leave the page open in a new tab", async ({ page, context }) => {
  await open(page);
  // Every link except the brand and the language switch (hreflang).
  const stay = await page.locator("a[href]").evaluateAll((as) => as
    .filter((a) => !a.matches(".brand, [hreflang]") && a.target !== "_blank")
    .map((a) => a.outerHTML.slice(0, 80)));
  expect(stay).toEqual([]);

  const tab = context.waitForEvent("page");
  await rows(page).first().locator('a[aria-label="LinkedIn"]').click();
  expect((await tab).url()).not.toBe(page.url());
  await expect(rows(page).first()).toBeVisible();
});

test.describe("star prompt", () => {
  test.beforeEach(async ({ page }) => {
    await page.clock.install();
  });
  const wait = (page) => page.clock.fastForward(41_000);

  test("appears after a while, with GitHub's star", async ({ page }) => {
    await open(page);
    await expect(page.locator("#star")).toBeHidden();
    await wait(page);
    await expect(page.locator("#star")).toBeVisible();
    await expect(page.locator("#star-go svg")).toBeVisible();
    await expect(page.locator("#star-go")).toHaveText("");
    await expect(page.locator("#star-go")).toHaveAttribute("href", /github\.com\/pugarte7\/spanish-top-tech-companies$/);
  });

  test("starring opens the repo and never asks again", async ({ page, context }) => {
    await open(page);
    await wait(page);
    const tab = context.waitForEvent("page");
    await page.locator("#star-go").click();
    expect((await tab).url()).toContain("github.com/pugarte7/spanish-top-tech-companies");
    await expect(page.locator("#star")).toBeHidden();
    await page.reload();
    await expect(rows(page).first()).toBeVisible();
    await wait(page);
    await expect(page.locator("#star")).toBeHidden();
  });

  test("closing it hides it on later visits too", async ({ page }) => {
    await open(page);
    await wait(page);
    await page.locator("#star-close").click();
    await expect(page.locator("#star")).toBeHidden();
    await page.reload();
    await expect(rows(page).first()).toBeVisible();
    await wait(page);
    await expect(page.locator("#star")).toBeHidden();
  });
});

test("search narrows the table", async ({ page }) => {
  await open(page);
  await expect(page.locator("#more")).toBeVisible();
  await page.locator("#search").fill("glovo");
  await expect(rows(page)).toHaveCount(1);
  await expect(rows(page).first()).toContainText("Glovo");
  // Nothing more to show, so no "show all" button.
  await expect(page.locator("#more")).toBeHidden();
});

test("the English page works too", async ({ page }) => {
  await open(page, "/en/");
  await expect(page.locator("#companies thead")).toContainText("Median base salary");
});

test("no sideways scroll on a phone @mobile", async ({ page }) => {
  await open(page);
  const [scroll, width] = await page.evaluate(() => [document.documentElement.scrollWidth, innerWidth]);
  expect(scroll).toBeLessThanOrEqual(width);
});

test("the companies table fits a phone, links in the open row @mobile", async ({ page }) => {
  await open(page);
  // The table once scrolled sideways inside its card, hiding the 60k+ column.
  const [inner, outer] = await page.locator(".table-wrap").evaluate((el) => [el.scrollWidth, el.clientWidth]);
  expect(inner).toBeLessThanOrEqual(outer);
  const share = await page.locator('#companies th[data-sort="share"]').boundingBox();
  expect(share.x + share.width).toBeLessThanOrEqual(await page.evaluate(() => innerWidth));
  await rows(page).first().click();
  await expect(rows(page).first().locator("xpath=following-sibling::tr[1]").locator(".links a").first()).toBeVisible();
});

test("filter menus stay on a phone's screen @mobile", async ({ page }) => {
  await open(page);
  const width = await page.evaluate(() => document.documentElement.clientWidth);
  for (const k of ["role", "years", "modes"]) {
    await filter(page, k).locator(".pick").click();
    const box = await page.locator(".menu").boundingBox();
    expect(box.x, `${k} menu's left edge`).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width, `${k} menu's right edge`).toBeLessThanOrEqual(width);
    await page.keyboard.press("Escape");
  }
});

test("the top bar is one row on a phone @mobile", async ({ page }) => {
  await open(page);
  expect((await page.locator(".topbar").boundingBox()).height).toBeLessThan(60);
});
