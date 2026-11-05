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

test("header card: the median, its histogram with the 60k line, figures with their unit", async ({ page }) => {
  await open(page);
  const data = await (await page.request.get("/api/v1/data.json")).json();
  const all = data.cells["||"];
  await expect(page.locator("#k-median")).toHaveText(`${all.median.toLocaleString("es-ES", { useGrouping: "always" })} €`);
  await expect(page.locator("#k-dist .col")).toHaveCount(all.hist.length);
  await expect(page.locator("#k-dist .cut")).toHaveText("60.000 € o más");
  // Blue from the bar up: the bands from 60k on, and none under it.
  const first = 1 + (data.threshold - data.hist.low) / data.hist.step;
  await expect(page.locator("#k-dist .col i.hi")).toHaveCount(all.hist.length - first);
  await expect(page.locator(`#k-dist .col:nth-child(${first}) i`)).not.toHaveClass(/hi/);
  // Four digits keep their dot, as every other figure on the page.
  await expect(page.locator("#k-dist .gl b").last()).toHaveText(/^\d{1,3}(\.\d{3})*$/);
  await expect(page.locator("#k-people")).toHaveText(all.n.toLocaleString("es-ES", { useGrouping: "always" }));
  await expect(page.locator(".hero-stats dt").first()).toHaveText("cobra 60.000 € o más de base");
  await expect(page.locator(".hero-stats dt").last()).toContainText("empresas con 5 o más salarios");
});

test("header card: the label left, the date top right, three equal figures whose labels break alike", async ({ page }) => {
  await open(page);
  for (const width of [1600, 1280, 800, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    const m = await page.evaluate(() => {
      const card = document.querySelector(".hero-card"), cs = getComputedStyle(card), c = card.getBoundingClientRect();
      const inner = { left: c.left + parseFloat(cs.borderLeftWidth) + parseFloat(cs.paddingLeft),
                      right: c.right - parseFloat(cs.borderRightWidth) - parseFloat(cs.paddingRight) };
      const label = document.querySelector(".hero-card-head span").getBoundingClientRect();
      const date = document.querySelector("#updated").getBoundingClientRect();
      return {
        inner, label: { left: label.left, top: label.top }, date: { right: date.right, top: date.top },
        widths: [...document.querySelectorAll(".hero-stats > div")].map((d) => d.getBoundingClientRect().width),
        lines: [...document.querySelectorAll(".hero-stats dt")].map((d) =>
          Math.round(d.getBoundingClientRect().height / parseFloat(getComputedStyle(d).lineHeight))),
      };
    });
    const at = `at ${width}px: ${JSON.stringify(m)}`;
    expect(Math.abs(m.label.left - m.inner.left), at).toBeLessThan(1);
    expect(Math.abs(m.date.right - m.inner.right), at).toBeLessThan(1);
    expect(Math.abs(m.date.top - m.label.top), at).toBeLessThan(1);
    expect(Math.max(...m.widths) - Math.min(...m.widths), at).toBeLessThan(1.5);
    expect(new Set(m.lines).size, at).toBe(1);
    expect(m.lines[0]).toBeLessThanOrEqual(2);
  }
});

// Light and Spanish by default: a system in dark mode and a browser in English
// still land on the light Spanish page, until the reader picks otherwise.
test.describe("on a dark system in English", () => {
  test.use({ colorScheme: "dark", locale: "en-GB" });
  test("the site opens light and in Spanish whatever the system says", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveURL(/\/es\/$/);
    await expect(page.locator("html")).toHaveAttribute("lang", "es");
    expect(await page.evaluate(() => getComputedStyle(document.documentElement).colorScheme)).toBe("light");
    expect(await page.evaluate(() => getComputedStyle(document.body).backgroundColor)).toBe("rgb(240, 240, 240)");
  });
});

// Dark is the light theme's mirror: pale blue ink on black, the field black
// too, and the frieze and the lacería drawn in blue rather than white.
test("dark mode turns the blue field black and draws it in blue", async ({ page }) => {
  await open(page);
  await page.locator("#theme").click();
  const look = await page.locator("header.field").evaluate((e) => ({
    field: getComputedStyle(e).backgroundColor,
    frieze: getComputedStyle(e, "::after").backgroundColor,
    ink: getComputedStyle(document.body).color,
    ground: getComputedStyle(document.body).backgroundColor,
  }));
  expect(look.field).toBe("rgb(0, 0, 0)");
  expect(look.ground).toBe("rgb(0, 0, 0)");
  expect(look.ink).toBe("rgb(184, 184, 255)");
  expect(look.frieze).toBe("rgb(107, 107, 255)");
});

test("every blue field is tiled from the one lazo, and text has no tiles behind it", async ({ page }) => {
  await open(page);
  await expect(page.locator("pattern#lazo")).toHaveCount(1);
  for (const sel of ["header.field", ".agents-stage", "footer", "#star"])
    await expect(page.locator(`${sel} > .wall rect`), sel).toHaveAttribute("fill", "url(#lazo)");
  // The frieze and a veil of the field's blue behind the banner's, the agents' and the footer's text.
  for (const sel of ["header.field", ".agents-stage", "footer"])
    expect(await page.locator(sel).evaluate((e) => { const a = getComputedStyle(e, "::after"); return a.maskImage || a.webkitMaskImage; }), sel).toContain("cenefa");
  for (const sel of [".pitch", ".agent-say", "footer p"])
    await expect(page.locator(sel)).toHaveClass(/\bveil\b/);
});

test("the banner's text is square: buttons end with the title, the veil clears both sides alike", async ({ page }) => {
  for (const [path, width] of [["/es/", 1280], ["/en/", 1600], ["/es/", 800], ["/es/", 390]]) {
    await page.setViewportSize({ width, height: 900 });
    await open(page, path);
    await page.evaluate(() => document.fonts.ready);
    const m = await page.locator(".pitch").evaluate((v) => {
      const b = v.getBoundingClientRect(), s = getComputedStyle(v, "::before"), r = document.createRange();
      const far = (el) => { r.selectNodeContents(el); return Math.max(...[...r.getClientRects()].map((q) => q.right)); };
      const title = far(v.querySelector("h1")), lede = far(v.querySelector(".hero-lede"));
      const buttons = v.querySelector(".cta").getBoundingClientRect().right;
      const right = Math.max(title, lede, buttons);
      return { title, lede, buttons, left: -parseFloat(s.left), right: b.right - parseFloat(s.right) - right };
    });
    const at = `${path} at ${width}px: ${JSON.stringify(m)}`;
    // On a phone the buttons take the whole column and the title is narrower.
    if (width > 640) expect(Math.abs(m.buttons - m.title), at).toBeLessThan(1.5);
    expect(m.lede, at).toBeLessThanOrEqual(m.buttons + 0.5);
    expect(Math.abs(m.right - m.left), at).toBeLessThan(1);
    // Every line of the title and of the text is centred on the buttons.
    const off = await page.locator(".pitch").evaluate((v) => {
      const cta = v.querySelector(".cta").getBoundingClientRect(), r = document.createRange(), out = [];
      for (const el of v.querySelectorAll("h1, .hero-lede")) {
        r.selectNodeContents(el);
        const by = {};
        for (const q of r.getClientRects()) {
          const k = Math.round(q.top / 4);
          by[k] = [Math.min(by[k]?.[0] ?? Infinity, q.left), Math.max(by[k]?.[1] ?? 0, q.right)];
        }
        for (const [l, right] of Object.values(by)) out.push((l - cta.left) - (cta.right - right));
      }
      return out;
    });
    for (const o of off) expect(Math.abs(o), `${at} line offsets ${off}`).toBeLessThan(1.5);
  }
});

test("header buttons: every row as wide, the pair half each, and each leads somewhere", async ({ page }) => {
  await open(page);
  const box = async (sel) => (await page.locator(sel).boundingBox());
  const see = await box(".cta .btn.main.wide"), how = await box(".how summary");
  const role = await box('.cta a[href="#matrix-card"]'), region = await box('.cta a[href="#map-card"]');
  expect(how.width).toBeCloseTo(see.width, 0);
  expect(role.width).toBeCloseTo(region.width, 0);
  expect(role.x).toBeCloseTo(see.x, 0);
  expect(region.x + region.width).toBeCloseTo(see.x + see.width, 0);
  expect(how.y).toBeGreaterThan(role.y);

  await page.locator(".how summary").click();
  await expect(page.locator(".how .steps")).toBeVisible();
  await page.locator('.cta a[href="#matrix-card"]').click();
  await expect(page.locator("#matrix-card")).toBeInViewport();
  await page.locator('.cta a[href="#companies-card"]').click();
  await expect(page.locator("#companies-card")).toBeInViewport();
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

test("map opens on number of salaries and switches to pay", async ({ page }) => {
  await open(page);
  const values = async () => (await page.locator("#ranking .v").allTextContents()).map(num);
  const sortedDesc = (v) => v.every((x, i) => i === 0 || v[i - 1] >= x);

  await expect(page.locator("#map-metric [data-m=count]")).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("#map-metric button")).toHaveText(["N. Salarios", "Base mediana"]);
  const [a, b] = await page.locator("#map-metric button").evaluateAll((bs) => bs.map((x) => x.getBoundingClientRect().width));
  expect(Math.abs(a - b)).toBeLessThan(1);
  await expect(page.locator("#map-sub")).toHaveText("Cuántos salarios se han recogido en cada comunidad.");
  const counts = await values();
  expect(sortedDesc(counts)).toBe(true);
  expect(counts[0]).toBeGreaterThan(1000);
  const sub = await page.locator("#map-sub").textContent();

  await page.locator("#map-metric [data-m=pay]").click();
  await expect(page.locator("#map-metric [data-m=pay]")).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("#map-sub")).not.toHaveText(sub);
  expect(sortedDesc(await values())).toBe(true);
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

test("companies under three salaries come after the rest", async ({ page }) => {
  await open(page);
  await page.locator("#more").click();
  const ns = (await page.locator("#companies tr.main td:last-child").allTextContents()).map(num);
  const thin = ns.findIndex((n) => n < 3);
  expect(thin).toBeGreaterThan(0);
  expect(ns.slice(thin).every((n) => n < 3)).toBe(true);
});

test("a company with one or two salaries in Spain has an asterisk, and the note under the table says why", async ({ page }) => {
  const table = async () => page.locator("#companies tr.main").evaluateAll((trs) => trs.map((tr) =>
    ({ n: Number(tr.lastElementChild.textContent), star: !!tr.querySelector("td.pay .asterisk") })));
  await open(page);
  // The first rows all have three salaries or more: nothing starred, no note.
  await expect(page.locator("#companies td.pay .asterisk")).toHaveCount(0);
  await expect(page.locator("#few-note")).toBeHidden();
  await page.locator("#more").click();
  const all = await table();
  expect(all.some((r) => r.star && r.n === 1)).toBe(true);
  expect(all.some((r) => r.star && r.n === 2)).toBe(true);
  expect(all.every((r) => r.star === (r.n < 3))).toBe(true);
  await expect(page.locator("#few-note")).toBeVisible();
  await expect(page.locator("#few-note")).toContainText("menos de 3 salarios en España");
  // Under a role, a company down to one or two salaries but with more in Spain has none.
  await page.goto("about:blank");
  await open(page, "/es/#role=product-manager");
  await expect(filter(page, "role").locator(".txt")).toHaveText("Product Manager");
  await page.locator("#more").click();
  const pm = await table();
  expect(pm.filter((r) => r.star).every((r) => r.n < 3)).toBe(true);
  expect(pm.some((r) => r.n < 3 && !r.star)).toBe(true);
});

async function clickStar(page) {
  await open(page);
  await page.locator("#more").click();
  const star = page.locator("#companies td.pay .asterisk").first();
  await star.scrollIntoViewIfNeeded();
  await star.click();
  return star;
}

test("clicking the asterisk shows a card about that company, without opening the row", async ({ page }) => {
  const star = await clickStar(page);
  const row = star.locator("xpath=ancestor::tr");
  const name = await row.locator(".name").textContent();
  const tip = page.locator("#asterisk-tip");
  await expect(tip).toBeVisible();
  await expect(tip.locator("b")).toHaveText("1 salario en España");
  await expect(tip).toContainText(`${name} existe`);
  await expect(tip).toContainText("solo hemos encontrado este salario");
  await expect(star).toHaveAttribute("aria-expanded", "true");
  await expect(row).toHaveAttribute("aria-expanded", "false");
  const [s, t] = [await star.boundingBox(), await tip.boundingBox()];
  expect(Math.abs(t.y - (s.y + s.height)) < 12 || Math.abs(t.y + t.height - s.y) < 12).toBe(true);
  // A second click, Escape or a click elsewhere closes it.
  await star.click();
  await expect(tip).toBeHidden();
  await star.click();
  await page.keyboard.press("Escape");
  await expect(tip).toBeHidden();
  await star.click();
  await page.locator("#companies-card h2").click();
  await expect(tip).toBeHidden();
  await expect(star).toHaveAttribute("aria-expanded", "false");
  // A company with two salaries says so.
  const two = page.locator("#companies tr.main").filter({ has: page.locator("td.num", { hasText: /^2$/ }) })
    .first().locator(".asterisk");
  await two.scrollIntoViewIfNeeded();
  await two.click();
  await expect(tip.locator("b")).toHaveText("2 salarios en España");
  await expect(tip).toContainText("solo hemos encontrado 2");
});

test("the asterisk's note fits a phone's screen @mobile", async ({ page }) => {
  await clickStar(page);
  const t = await page.locator("#asterisk-tip").boundingBox();
  const width = page.viewportSize().width;
  expect(t.x).toBeGreaterThanOrEqual(0);
  expect(t.x + t.width).toBeLessThanOrEqual(width);
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

// site.py loads PostHog on Vercel builds only; here a stand-in records what track() sends.
test("what readers use reaches PostHog once it settles, and a search only when it finds a company", async ({ page }) => {
  await page.addInitScript(() => {
    window.sent = [];
    window.posthog = { capture: (event, props) => window.sent.push([event, props]) };
  });
  await open(page);
  const sent = () => page.evaluate(() => window.sent);
  const named = async (event) => (await sent()).filter(([e]) => e === event);

  await page.locator('#matrix button[data-role="product-manager"][data-years="8-11"]').click();
  await expect.poll(sent).toContainEqual(["filter",
    { role: "product-manager", years: "8-11", work: null, loc: null, via: "matrix" }]);

  const name = (await rows(page).first().locator(".name").textContent()).trim();
  await page.locator("#search").fill("qqxzq");
  await page.waitForTimeout(1_800);
  expect(await named("search")).toEqual([]);
  await page.locator("#search").fill(name.slice(0, 4).toUpperCase());
  await expect.poll(() => named("search")).toEqual([["search",
    { q: name.slice(0, 4).toLowerCase(), results: expect.any(Number) }]]);

  await rows(page).first().click();
  expect(await named("company_open")).toEqual([["company_open", { company: name, role: "product-manager" }]]);
  await page.locator('#companies th[data-sort="n"]').click();
  expect(await named("sort")).toEqual([["sort", { by: "n", asc: false }]]);
  await page.locator('.agent-tab[data-name="Grok CLI"]').click();
  expect(await named("agent_pick")).toEqual([["agent_pick", { agent: "Grok CLI" }]]);
  // A link restoring its filters is the page view's URL, not a choice.
  expect((await named("filter")).length).toBe(1);
});

test("the location filter narrows the table to a region and a city", async ({ page }) => {
  await open(page);
  const pickPlace = async (sel) => {
    await page.locator('.filter[data-k="loc"] .pick').click();
    const li = page.locator(`.filter[data-k="loc"] ${sel}`).first();
    const [name, n] = [await li.locator("span").first().textContent(), await li.locator("small").textContent()];
    await li.click();
    await expect(page.locator('.filter[data-k="loc"] .txt')).toHaveText(name);
    await expect(page.locator("#summary dd").nth(3)).toHaveText(n);
    await expect(rows(page).first()).toBeVisible();
  };
  await pickPlace('li.role[data-v]');
  await expect(page).toHaveURL(/#loc=[A-Z]{2}$/);
  await page.locator('.filter[data-k="loc"] .pick').click();
  await page.locator('.filter[data-k="loc"] .twist').first().click();
  await page.keyboard.press("Escape");
  await pickPlace("li.spec");
  await expect(page).toHaveURL(/#loc=[A-Z]{2}-/);
});

test("tapping a region on the map filters the table by it @mobile", async ({ page }) => {
  await open(page);
  await page.locator('#map .region.has[data-code="AN"]').tap();
  await expect(page).toHaveURL(/#loc=AN$/);
  await expect(filter(page, "loc").locator(".txt")).toHaveText("Andalucía");
  await expect(rows(page).first()).toBeVisible();
});

test("an empty table says no luck and offers a way out of each filter", async ({ page }) => {
  await open(page);
  // A role with few salaries, and a region on the map where it has none.
  const role = "ux-researcher";
  const places = (await (await page.request.get(`/api/v1/companies/${role}.json`)).json()).places.map((r) => r.code);
  const mapped = await page.locator("#map .region.has").evaluateAll((ps) => ps.map((p) => p.dataset.code));
  const region = mapped.find((c) => !places.includes(c));
  expect(region, "a mapped region without ux researchers").toBeTruthy();
  await filter(page, "role").locator(".pick").click();
  await filter(page, "role").locator(`[data-v="${role}"]`).first().click();
  await expect(page).toHaveURL(new RegExp(`#role=${role}$`));
  await expect(rows(page).first()).toBeVisible();
  await page.locator(`#map .region.has[data-code="${region}"]`).click();
  await expect(page.locator("#companies .empty-title")).toHaveText("Vaya, no ha habido suerte.");
  await expect(page.locator("#companies .empty-ways button")).toHaveText(["Todos los roles", "Toda España"]);
  await expect(page.locator("#summary"), "the table's message is enough").toBeHidden();
  await page.locator("#companies .empty-ways button", { hasText: "Todos los roles" }).click();
  await expect(rows(page).first()).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`#loc=${region}$`));
  // A search that hides every company offers to clear it.
  await page.locator("#search").fill("zzzz");
  await expect(page.locator("#companies")).toContainText("Ninguna empresa coincide con «zzzz»");
  await page.locator("#companies .empty-ways button").click();
  await expect(page.locator("#search")).toHaveValue("");
  await expect(rows(page).first()).toBeVisible();
});

test("a table that cannot load says so, and the retry brings it", async ({ page }) => {
  await open(page);
  let cut = true;
  await page.route("**/api/v1/companies/software-engineer.json*", (r) => cut ? r.abort() : r.continue());
  await filter(page, "role").locator(".pick").click();
  await filter(page, "role").locator('[data-v="software-engineer"]').first().click();
  await expect(page.locator("#companies")).toContainText("No se pudo cargar la tabla.");
  cut = false;
  await page.locator("#retry").click();
  await expect(rows(page).first()).toBeVisible();
  await expect(filter(page, "role").locator(".txt")).toHaveText("Software Engineer");
  // The cut request is the point of the test, not a problem in the page.
  page.problems.splice(0, page.problems.length, ...page.problems.filter((p) => !p.includes("ERR_FAILED")));
});

// A deploy that changes the company list while a tab is open: the tables
// fetched afterwards number companies on the new list.
async function deployWhileOpen(page, times) {
  await open(page);
  let left = times;
  await page.route("**/api/v1/companies/software-engineer.json*", async (r) => {
    if (left-- <= 0) return r.continue();
    const res = await r.fetch();
    await r.fulfill({ response: res, json: { ...(await res.json()), list_v: "deployed" } });
  });
}
const pickEngineer = async (page) => {
  await filter(page, "role").locator(".pick").click();
  await filter(page, "role").locator('[data-v="software-engineer"]').first().click();
};

test("a tab left open across a deploy reloads, keeping its filters", async ({ page }) => {
  await deployWhileOpen(page, 1);
  const reloaded = page.waitForEvent("load");
  await pickEngineer(page);
  await reloaded;
  await expect(rows(page).first()).toBeVisible();
  await expect(filter(page, "role").locator(".txt")).toHaveText("Software Engineer");
});

test("a tab that already reloaded fetches the new company list instead", async ({ page }) => {
  await deployWhileOpen(page, 2);
  const reloaded = page.waitForEvent("load");
  await pickEngineer(page);
  await reloaded;
  await expect(rows(page).first()).toBeVisible();
  await expect(filter(page, "role").locator(".txt")).toHaveText("Software Engineer");
});

test("every open row has its experience bars and the 60k line", async ({ page }) => {
  await open(page);
  const n = await rows(page).count();
  for (let i = 0; i < n; i++) {
    const row = rows(page).nth(i);
    await row.click();
    const det = row.locator("xpath=following-sibling::tr[1]");
    await expect(det.locator(".yplot .yb b").first()).toBeVisible();
    await expect(det.locator(".yplot .ref")).toHaveText("60k");
    await row.click();
  }
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

test("the footer links to the legal and privacy page, which names who runs the site", async ({ page }) => {
  await open(page);
  const legal = page.locator("footer a[href='/es/legal/']");
  await expect(legal).toHaveText("Aviso legal y privacidad");
  await page.goto("/es/legal/");
  await expect(page.locator("h1")).toHaveText("Aviso legal y privacidad");
  await expect(page.locator("main")).toContainText("Pablo Ugarte");
  await expect(page.locator("a[href^='mailto:']").first()).toHaveText("ugartep117@gmail.com");
  await expect(page.locator("a[hreflang=en]")).toHaveAttribute("href", "/en/legal/");
});

test("links that leave the page open in a new tab", async ({ page, context }) => {
  await open(page);
  // Every link except the brand, the language switch (hreflang), links
  // within the page and the footer's links into the salary pages, which are
  // the next page of the same visit.
  const stay = await page.locator("a[href]").evaluateAll((as) => as
    .filter((a) => !a.matches(".brand, [hreflang], [href^='#'], .foot-links a") && a.target !== "_blank")
    .map((a) => a.outerHTML.slice(0, 80)));
  expect(stay).toEqual([]);

  const tab = context.waitForEvent("page");
  // Not every company has a LinkedIn page; the first that does.
  await rows(page).locator('a[aria-label="LinkedIn"]').first().click();
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

  test("the redesigned card asks again those who only closed the old one", async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem("star-prompt", String(Date.now() + 30 * 864e5)));
    await open(page);
    await wait(page);
    await expect(page.locator("#star")).toBeVisible();
  });

  test("whoever starred from the old card is never asked", async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem("star-prompt", "starred"));
    await open(page);
    await wait(page);
    await expect(page.locator("#star")).toBeHidden();
  });

  test("closing it brings it back the next day", async ({ page }) => {
    await open(page);
    await wait(page);
    await page.locator("#star-close").click();
    await page.clock.fastForward(24 * 3600_000 + 60_000);
    await page.reload();
    await expect(rows(page).first()).toBeVisible();
    await wait(page);
    await expect(page.locator("#star")).toBeVisible();
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

test.describe("agents", () => {
  const MCP = "https://spanishtoptechcompanies.com/mcp";
  const tabs = (page) => page.locator(".agent-tab");
  const pressed = (page) => page.locator('.agent-tab[aria-pressed="true"]');
  test.beforeEach(async ({ page }) => {
    await page.clock.install();
  });

  test("the section shows every agent's logo and turns to the next", async ({ page }) => {
    await open(page);
    await expect(tabs(page)).toHaveCount(6);
    for (const img of await page.locator("#agents img").all())
      await expect.poll(() => img.evaluate((el) => el.complete && el.naturalWidth > 0)).toBe(true);
    await expect(pressed(page)).toHaveAttribute("data-name", "Instinct");
    await expect(page.locator("#agents .agent-call")).toHaveText("Que Instinct aplique por ti");
    await expect(page.locator("#agent-get")).toHaveAttribute("href", "https://instinct.com/");
    await page.clock.fastForward(3_100);
    await expect(pressed(page)).toHaveAttribute("data-name", "Claude Code");
    await expect(page.locator("#agents .agent-call")).toHaveText("Que Claude Code aplique por ti");
    await expect(page.locator("#agent-by")).toHaveText("Anthropic");
    await expect(page.locator("#agent-get")).toHaveText(/Consigue Claude Code/);
    await expect(page.locator("#agent-get")).toHaveAttribute("href", "https://code.claude.com/docs/en/setup");
  });

  // The ↗ character showed on iPhones as a blue emoji tile.
  test("the get link draws its arrow instead of using a character", async ({ page }) => {
    await open(page);
    await expect(page.locator("#agent-get")).toHaveText("Consigue Instinct");
    await expect(page.locator("#agent-get svg.out")).toBeVisible();
  });

  test("picking an agent stops the turn", async ({ page }) => {
    await open(page);
    await page.locator('.agent-tab[data-name="Grok CLI"]').click();
    await page.clock.fastForward(10_000);
    await expect(pressed(page)).toHaveAttribute("data-name", "Grok CLI");
    await expect(page.locator("#agent-get")).toHaveAttribute("href", /github\.com\/xai-org\/grok-build/);
    await expect(page.locator(".agent-stack .agent-tile.on")).toHaveCount(1);
  });

  // "Claude Code" wrapped a line the other names did not, and the page jumped.
  const staysPut = async (page) => {
    await open(page, "/en/");
    const where = () => page.evaluate(() => [
      document.documentElement.scrollHeight,
      Math.round(document.querySelector(".agent-tabs").getBoundingClientRect().top + scrollY)]);
    const first = await where();
    for (const tab of await tabs(page).all()) {
      await tab.evaluate((t) => t.click());
      expect(await where()).toEqual(first);
    }
  };
  test("the page stays put whatever agent shows", async ({ page }) => staysPut(page));
  test("the page stays put whatever agent shows on a phone @mobile", async ({ page }) => staysPut(page));

  test("nothing turns for readers who ask for less motion", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await open(page);
    await page.clock.fastForward(10_000);
    await expect(pressed(page)).toHaveAttribute("data-name", "Instinct");
  });

  test("copy puts the MCP address on the clipboard", async ({ page, context }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await open(page);
    await page.locator('.copy-btn[data-copy="agent-mcp"]').click();
    await expect(page.locator('.copy-btn[data-copy="agent-mcp"]')).toHaveText("Copiado");
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(MCP);
  });

  test("the English page asks in English", async ({ page }) => {
    await open(page, "/en/");
    await expect(page.locator("#agents-title")).toHaveText("Let your agent apply for you");
    await expect(page.locator("#agents .agent-call")).toHaveText("Let Instinct apply for you");
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

test("the date shown is the data's, and the method says when salaries are from", async ({ page }) => {
  await open(page);
  const data = await (await page.request.get("/api/v1/data.json")).json();
  const day = new Date(`${data.data_as_of}T00:00:00Z`).toLocaleDateString("es-ES",
    { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
  await expect(page.locator("#updated")).toHaveText(`Actualizado ${day}`);
  await expect(page.locator(".how .steps")).toContainText("Cuándo.");
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
  // The table once scrolled sideways inside its card, hiding the 60k+ column;
  // later the number of salaries was hidden on phones, and readers missed it.
  const [inner, outer] = await page.locator(".table-wrap").evaluate((el) => [el.scrollWidth, el.clientWidth]);
  expect(inner).toBeLessThanOrEqual(outer);
  const width = await page.evaluate(() => innerWidth);
  for (const k of ["share", "n"]) {
    const th = page.locator(`#companies th[data-sort="${k}"]`);
    await expect(th).toBeVisible();
    const box = await th.boundingBox();
    expect(box.x + box.width).toBeLessThanOrEqual(width);
  }
  await expect(rows(page).first().locator("td.num").last()).toHaveText(/^\d+$/);
  await rows(page).first().click();
  await expect(rows(page).first().locator("xpath=following-sibling::tr[1]").locator(".links a").first()).toBeVisible();
  // The open row is tinted to the card's edges, and its turned arrow is whole.
  const m = await page.evaluate(() => {
    const card = document.querySelector("#companies-card"), cs = getComputedStyle(card), c = card.getBoundingClientRect();
    const wrap = document.querySelector(".table-wrap").getBoundingClientRect();
    const row = document.querySelector("#companies tr.main.open").getBoundingClientRect();
    const arrow = document.querySelector("#companies tr.main.open .chev span").getBoundingClientRect();
    return { inner: [c.left + parseFloat(cs.borderLeftWidth), c.right - parseFloat(cs.borderRightWidth)],
             row: [row.left, row.right], wrap: [wrap.left, wrap.right], arrow: [arrow.left, arrow.right] };
  });
  expect(Math.abs(m.row[0] - m.inner[0]), JSON.stringify(m)).toBeLessThan(1);
  expect(Math.abs(m.row[1] - m.inner[1]), JSON.stringify(m)).toBeLessThan(1);
  expect(m.arrow[0], JSON.stringify(m)).toBeGreaterThanOrEqual(m.wrap[0]);
});

test("on a phone the title is centred and the text runs as wide as the buttons @mobile", async ({ page }) => {
  await open(page);
  const [lede, cta] = await page.evaluate(() =>
    [".hero-lede", ".cta"].map((s) => document.querySelector(s).getBoundingClientRect().width));
  expect(Math.abs(lede - cta)).toBeLessThan(1);
  const lines = await page.locator(".pitch h1").evaluate((h) => {
    const r = document.createRange(); r.selectNodeContents(h);
    const by = {};
    for (const q of r.getClientRects()) {
      const k = Math.round(q.top / 4);
      by[k] = [Math.min(by[k]?.[0] ?? Infinity, q.left), Math.max(by[k]?.[1] ?? 0, q.right)];
    }
    return Object.values(by).map(([l, right]) => [l, innerWidth - right]);
  });
  expect(lines.length).toBeGreaterThan(1);
  for (const [left, right] of lines) expect(Math.abs(left - right), JSON.stringify(lines)).toBeLessThan(1.5);
});

test("an open company on a phone is centred, with a margin on both sides @mobile", async ({ page }) => {
  await open(page);
  await rows(page).first().click();
  const m = await page.evaluate(() => {
    const td = document.querySelector("#companies tr.det td").getBoundingClientRect(), mid = td.left + td.width / 2;
    const r = document.createRange();
    const centre = (e) => {
      r.selectNodeContents(e);
      const q = [...r.getClientRects()];
      return (Math.min(...q.map((x) => x.left)) + Math.max(...q.map((x) => x.right))) / 2 - mid;
    };
    const plot = document.querySelector("#companies tr.det .yplot").getBoundingClientRect();
    return {
      margins: [plot.left - td.left, td.right - plot.right],
      off: [".yplot", ".yaxis", ".yunit", ".split dl", ".mix-key", ".detail .links"]
        .map((s) => [s, Math.round(centre(document.querySelector(`#companies tr.det ${s}`)))]),
      // Each band's label on one line: the unit moves to one caption under the axis.
      tall: [...document.querySelectorAll("#companies tr.det .yaxis span")].filter((x) => x.getBoundingClientRect().height > 20).length,
    };
  });
  expect(Math.abs(m.margins[0] - m.margins[1]), JSON.stringify(m)).toBeLessThan(1);
  expect(m.margins[0]).toBeGreaterThanOrEqual(20);
  for (const [s, o] of m.off) expect(Math.abs(o), `${s} ${JSON.stringify(m)}`).toBeLessThanOrEqual(1);
  expect(m.tall).toBe(0);
  await expect(page.locator("#companies tr.det .yunit")).toHaveText("Años de experiencia");
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

test("the tab shows the tile favicon", async ({ page }) => {
  await open(page);
  for (const sel of ['link[rel=icon][type="image/svg+xml"]', 'link[rel=icon][sizes="32x32"]', "link[rel=apple-touch-icon]"]) {
    const href = await page.locator(sel).getAttribute("href");
    expect((await page.request.get(href)).status(), href).toBe(200);
  }
});

// A pasted link shows the preview image: Slack and the rest read the head of
// the page they are given, the bare domain included, and never run its script.
test("a pasted link carries a large preview image", async ({ request }) => {
  for (const [path, lang] of [["/", "es"], ["/es/", "es"], ["/en/", "en"]]) {
    const head = await (await request.get(path)).text();
    const image = head.match(/<meta property="og:image" content="([^"]+)"/)?.[1];
    expect(image, path).toBe(`https://spanishtoptechcompanies.com/og-${lang}.png`);
    expect(head, path).toContain('<meta name="twitter:card" content="summary_large_image">');
    expect(head, path).toContain('<link rel="icon" href="/favicon.svg"');
    const png = await request.get(new URL(image).pathname);
    expect(png.status(), image).toBe(200);
    expect(png.headers()["content-type"], image).toContain("image/png");
  }
});

test("the top bar scrolls away on a phone @mobile", async ({ page }) => {
  await open(page);
  await page.locator("#companies-card").scrollIntoViewIfNeeded();
  expect((await page.locator(".topbar").boundingBox()).y).toBeLessThan(0);
});

test.describe("salary pages", () => {
  test("a role page carries its figures, canonical and other language without script", async ({ browser }) => {
    const context = await browser.newContext({ javaScriptEnabled: false });
    const page = await context.newPage();
    await page.goto("/es/salarios/software-engineer/");
    await expect(page.locator("h1")).toContainText("programador");
    await expect(page.locator(".hero-median")).toHaveText(/\d+\.000\s€/);
    await expect(page.locator(".guide-table").first().locator("tbody tr")).not.toHaveCount(0);
    await expect(page.locator('link[rel="canonical"]'))
      .toHaveAttribute("href", "https://spanishtoptechcompanies.com/es/salarios/software-engineer/");
    await expect(page.locator('link[hreflang="en"]'))
      .toHaveAttribute("href", "https://spanishtoptechcompanies.com/en/salaries/software-engineer/");
    await context.close();
  });

  test("every link on the hub resolves", async ({ page, request }) => {
    await page.goto("/en/salaries/");
    const hrefs = await page.locator("main a[href^='/']").evaluateAll((as) => [...new Set(as.map((a) => a.getAttribute("href")))]);
    expect(hrefs.length).toBeGreaterThan(50);
    for (const href of hrefs) expect((await request.get(href)).status(), href).toBe(200);
  });

  test("@mobile a company page fits a phone", async ({ page }) => {
    await page.goto("/en/companies/revolut/");
    const over = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
    expect(over).toBeLessThanOrEqual(0);
  });

  test("the sitemap lists every page in both languages", async ({ request }) => {
    const xml = await (await request.get("/sitemap.xml")).text();
    expect(xml).toContain("<loc>https://spanishtoptechcompanies.com/es/salarios/software-engineer/</loc>");
    expect(xml).toContain("<loc>https://spanishtoptechcompanies.com/en/companies/revolut/</loc>");
    expect((await (await request.get("/robots.txt")).text())).toContain("Sitemap: https://spanishtoptechcompanies.com/sitemap.xml");
  });
});
