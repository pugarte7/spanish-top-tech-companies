"use strict";
const S = window.S;
const LANG = document.body.dataset.lang;
const LOCALE = LANG === "es" ? "es-ES" : "en-GB";
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const money = (n) => n == null ? "—" : new Intl.NumberFormat(LOCALE, {
  style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(n);
const short = (n) => new Intl.NumberFormat(LOCALE, { maximumFractionDigits: 1 })
  .format(n / 1000) + "k";
const pct = (x) => Math.round(x * 100) + "%";
// A share of a whole that can be small: one decimal under 10%, "<0,1%" for a trace.
const share = (x) => x > 0 && x < 0.001 ? `<${(0.1).toLocaleString(LOCALE)}%`
  : (x * 100).toLocaleString(LOCALE, { maximumFractionDigits: x < 0.1 ? 1 : 0 }) + "%";

let D;
// Filters belong to the companies table only; the charts above it show everyone.
// `pay` is which column the summary, the 60k+ share and the years follow:
// base, or total pay (base + bonus + stock), whichever the reader last sorted.
const state = { role: "", years: [], modes: [], loc: "", q: "", all: false, sort: "median", asc: false, pay: "base" };
const MODES = ["remote", "hybrid", "office"];
const cell = (o = {}) => D.cells[`${o.role || ""}|${o.region || ""}|${o.years || ""}`];
const regionName = (code) => D.regions[code]?.[LANG] || code;
const yearsLabel = (b) => `${b.replace("-", "–")} ${S.years_unit}`;

// What readers use, to PostHog, which site.py loads on Vercel builds only:
// anywhere else there is no window.posthog and nothing is sent.
const track = (event, props) => window.posthog?.capture(event, props);
const log = (level, message, attributes) => window.posthog?.logger?.[level]?.(message, attributes);
// Once the reader stops: the span's handles and the search box fire on every move.
const settle = (ms, f) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => f(...a), ms); }; };

// --- tooltip ----------------------------------------------------------------
$("theme").addEventListener("click", () => {
  const dark = getComputedStyle(document.documentElement).colorScheme === "dark";
  const next = dark ? "light" : "dark";
  document.documentElement.dataset.theme = next;
  try { localStorage.setItem("theme", next); } catch (_) {}
});

const tip = $("tip");
function showTip(e, html) {
  tip.innerHTML = html;
  tip.hidden = false;
  const r = tip.getBoundingClientRect();
  let x = e.clientX + 14, y = e.clientY + 14;
  if (x + r.width > innerWidth - 8) x = e.clientX - r.width - 14;
  if (y + r.height > innerHeight - 8) y = e.clientY - r.height - 14;
  tip.style.left = x + "px";
  tip.style.top = y + "px";
}
const hideTip = () => { tip.hidden = true; };
function hover(el, html) {
  el.addEventListener("mousemove", (e) => showTip(e, html()));
  el.addEventListener("mouseleave", hideTip);
}
// The middle half exists only for groups of D.quartile_min or more.
const range = (a) => a.p25 == null ? "—" : `${short(a.p25)} – ${short(a.p75)}`;
const statTip = (title, a) => `<b>${esc(title)}</b><br>${S.median} ${money(a.median)}<br>` +
  `<span class="t-sub">${a.p25 == null ? "" : `${S.range} ${range(a)} · `}${a.n} ${S.people}</span>`;

// --- filters ------------------------------------------------------------------
// Each filter is a button that opens a panel: role is a tree of roles and
// their specializations, most salaries first; experience is a span of bands
// picked with two handles; work arrangement takes several. Nothing chosen
// means any.
const FILTERS = {
  role: { label: () => S.role_label, active: () => !!state.role, text: () => roleName(state.role) },
  years: { label: () => S.years_label, active: () => state.years.length > 0, text: () => spanLabel(state.years) },
  modes: {
    label: () => S.mode_label, active: () => state.modes.length > 0,
    text: () => state.modes.map((m) => S["mode_" + m]).join(", "),
  },
  loc: { label: () => S.loc_label, active: () => !!state.loc, text: () => placeName(state.loc) },
};
let menuOpen = null;
const expanded = new Set();

const roleTree = () => T[""]?.roles || [];
const bands = () => T[""]?.bands || D.years;
// The role's places: regions by salaries, each with its cities as [key, name,
// salaries, file]. A city whose salaries are all its region's has the
// region's file.
const places = () => T[state.role]?.places || [];
const findCity = (key, from = places()) => from.flatMap((r) => r.cities).find((c) => c[0] === key);
const placeName = (key) => key.includes("-")
  ? (findCity(key) || findCity(key, T[""]?.places || []))?.[1] || key : regionName(key);
const placeFile = () => `${state.role || "all"}~${findCity(state.loc)?.[3] || state.loc}`;
function roleName(slug) {
  for (const r of roleTree()) {
    if (r.slug === slug) return r.name;
    const sp = r.specs.find((x) => x.slug === slug);
    if (sp) return `${r.name} · ${sp.name}`;
  }
  return slug;
}
// "5-7","8-11" reads "5–11 años"; a span reaching the last band is open-ended.
function spanLabel(span) {
  if (!span.length) return S.any;
  const from = span[0].split(/[-+]/)[0], last = span[span.length - 1];
  const to = last.endsWith("+") ? "" : last.split("-")[1];
  return (to ? (from === to ? from : `${from}–${to}`) : `${from}+`) + ` ${S.years_unit}`;
}

function filterBar() {
  $("filters").innerHTML = Object.entries(FILTERS).map(([k, f]) =>
    `<div class="filter${f.active() ? " on" : ""}" data-k="${k}">` +
    `<button class="pick" aria-haspopup="true" aria-expanded="${menuOpen === k}">` +
    `<span class="lab">${esc(f.label())}</span> <span class="txt">${esc(f.active() ? f.text() : S.any)}</span></button>` +
    (menuOpen === k ? MENUS[k]() : "") + `</div>`).join("");
  $("filters").querySelectorAll(".filter").forEach((el) => {
    const k = el.dataset.k;
    // Redrawing detaches the clicked node, which the outside-click handler
    // would read as a click elsewhere, so clicks inside a filter stop here.
    el.onclick = (e) => e.stopPropagation();
    el.querySelector(".pick").onclick = () => {
      menuOpen = menuOpen === k ? null : k;
      filterBar();
      $("filters").querySelector(".menu [tabindex], .menu input")?.focus();
    };
    el.querySelectorAll("[data-v]").forEach((o) => {
      o.onclick = () => pick(k, o.dataset.v);
      o.onkeydown = (e) => {
        if (e.target !== o) return;
        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); o.click(); }
      };
    });
    el.querySelectorAll("[data-toggle]").forEach((t) => t.onclick = (e) => {
      e.stopPropagation();
      const r = t.dataset.toggle;
      expanded.has(r) ? expanded.delete(r) : expanded.add(r);
      filterBar();
      $("filters").querySelector(`[data-toggle="${CSS.escape(r)}"]`)?.focus();
    });
    if (k === "years" && menuOpen === k) wireSpan(el);
  });
  placeMenu();
}

// A menu opens under its button; one near the right edge slides left to stay
// on screen, which on a phone is most of them.
function placeMenu() {
  const menu = $("filters").querySelector(".menu");
  if (!menu) return;
  const r = menu.getBoundingClientRect(), edge = document.documentElement.clientWidth - 12;
  if (r.right > edge) menu.style.left = `${Math.max(edge - r.right, 12 - r.left)}px`;
}

const option = (v, label, cls, sel, extra = "") =>
  `<li data-v="${esc(v)}" tabindex="0" role="option" aria-selected="${sel}" class="${cls}${sel ? " sel" : ""}">` +
  `${label}${extra}</li>`;
const count = (n) => `<small>${n.toLocaleString(LOCALE)}</small>`;

const MENUS = {
  role: () => {
    const open = (r) => expanded.has(r.slug) || state.role.startsWith(r.slug + "/");
    return `<ul class="menu tree" role="listbox">` + option("", esc(S.all_roles), "", !state.role) +
      roleTree().map((r) => option(r.slug, `<span>${esc(r.name)}</span>${count(r.n)}`, "role",
        state.role === r.slug, r.specs.length
          ? `<button class="twist${open(r) ? " open" : ""}" data-toggle="${esc(r.slug)}" ` +
            `aria-label="${esc(r.name)}" aria-expanded="${open(r)}">›</button>` : "") +
        (open(r) ? r.specs.map((sp) => option(sp.slug, `<span>${esc(sp.name)}</span>${count(sp.n)}`,
          "spec", state.role === sp.slug)).join("") : "")).join("") + `</ul>`;
  },
  years: () => {
    const b = bands(), last = b.length - 1;
    const [i, j] = state.years.length
      ? [b.indexOf(state.years[0]), b.indexOf(state.years[state.years.length - 1])] : [0, last];
    const ticks = b.map((x) => `<span>${esc(x.replace("-", "–"))}</span>`).join("");
    return `<div class="menu span"><div class="span-head"><b id="span-text">${esc(spanLabel(state.years))}</b>` +
      `<button class="link" data-v="">${esc(S.any)}</button></div>` +
      `<div class="dual"><span class="rail"><i id="span-fill"></i></span>` +
      `<input type="range" id="span-from" min="0" max="${last}" step="1" value="${i}" aria-label="${esc(S.from)}">` +
      `<input type="range" id="span-to" min="0" max="${last}" step="1" value="${j}" aria-label="${esc(S.to)}"></div>` +
      `<div class="ticks">${ticks}</div></div>`;
  },
  modes: () => `<ul class="menu" role="listbox" aria-multiselectable="true">` +
    option("", esc(S.any), "any", !state.modes.length) +
    MODES.map((m) => option(m, esc(S["mode_" + m]), "check", state.modes.includes(m))).join("") + `</ul>`,
  // Like the role menu: regions, and under the arrow the cities of those
  // that have more than one.
  loc: () => {
    const open = (r) => expanded.has("loc:" + r.code) || state.loc.startsWith(r.code + "-");
    return `<ul class="menu tree" role="listbox">` + option("", esc(S.all_spain), "", !state.loc) +
      places().map((r) => option(r.code, `<span>${esc(regionName(r.code))}</span>${count(r.n)}`, "role",
        state.loc === r.code, r.cities.length > 1
          ? `<button class="twist${open(r) ? " open" : ""}" data-toggle="loc:${r.code}" ` +
            `aria-label="${esc(regionName(r.code))}" aria-expanded="${open(r)}">›</button>` : "") +
        (open(r) && r.cities.length > 1 ? r.cities.map(([key, name, n]) =>
          option(key, `<span>${esc(name)}</span>${count(n)}`, "spec", state.loc === key)).join("") : "")).join("") +
      `</ul>`;
  },
};

// The two handles update the table as they move, without redrawing the panel
// under the pointer.
function wireSpan(el) {
  const from = el.querySelector("#span-from"), to = el.querySelector("#span-to");
  const b = bands(), last = b.length - 1;
  const paint = () => {
    const i = +from.value, j = +to.value;
    el.querySelector("#span-fill").style.cssText = `left:${(i / last) * 100}%;right:${100 - (j / last) * 100}%`;
  };
  const move = (moved) => {
    if (+from.value > +to.value) (moved === from ? to : from).value = moved.value;
    const i = +from.value, j = +to.value;
    state.years = i === 0 && j === last ? [] : b.slice(i, j + 1);
    state.all = false;
    paint();
    el.querySelector("#span-text").textContent = spanLabel(state.years);
    el.querySelector(".txt").textContent = FILTERS.years.active() ? spanLabel(state.years) : S.any;
    el.classList.toggle("on", FILTERS.years.active());
    saveHash();
    companies();
  };
  from.oninput = () => move(from);
  to.oninput = () => move(to);
  paint();
}

async function pick(k, v) {
  if (k === "role" || k === "loc") {
    state[k] = v;
    menuOpen = null;
  } else if (k === "years") {
    state.years = [];
  } else if (!v) {
    state.modes = [];
  } else {
    const next = state.modes.includes(v) ? state.modes.filter((x) => x !== v) : [...state.modes, v];
    // Everything ticked is the same as nothing ticked.
    state.modes = next.length === MODES.length ? [] : MODES.filter((x) => next.includes(x));
  }
  state.all = false;
  saveHash();
  filterBar();
  $("filters").querySelector(`.filter[data-k="${k}"] [data-v="${CSS.escape(v)}"]`)?.focus();
  if (!await loadTables()) return;
  log("info", "salary filters applied", { filter: k, selection: v || "all" });
  filterBar();
  companies();
}

const trackFilters = settle(1000, (via) => track("filter", {
  role: state.role || null, years: state.years.join(",") || null,
  work: state.modes.join(",") || null, loc: state.loc || null, via,
}));

// Every change of filters passes here: the hash keeps them for a shared link,
// and PostHog hears of them once they settle. `via` is "menu", "matrix", "map"
// or "empty" (a way out of an empty table).
function saveHash(via = "menu") {
  writeHash();
  trackFilters(via);
}
function writeHash() {
  const h = new URLSearchParams();
  if (state.role) h.set("role", state.role);
  if (state.years.length) h.set("years", state.years.join(","));
  if (state.modes.length) h.set("work", state.modes.join(","));
  if (state.loc) h.set("loc", state.loc);
  if (state.pay === "total") h.set("pay", "total");
  history.replaceState(null, "", h.toString() ? "#" + h : location.pathname);
}

document.addEventListener("click", (e) => {
  if (menuOpen && !e.target.closest(".filter")) { menuOpen = null; filterBar(); }
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && menuOpen) { menuOpen = null; filterBar(); }
});

// Only a search that finds a company is sent: it is then part of a company's
// name, never whatever else someone typed.
const trackSearch = settle(1500, () => {
  const q = state.q.trim().toLowerCase();
  const results = q.length > 1 ? named(table(), q).length : 0;
  if (results) track("search", { q, results });
});

function wire() {
  $("search").oninput = (e) => { state.q = e.target.value; companies(); trackSearch(); };
  $("more").onclick = () => { state.all = !state.all; companies(); };
}

// Set several filters at once, as a matrix cell or a map region does.
async function applyFilters(patch, via) {
  Object.assign(state, patch, { all: false });
  menuOpen = null;
  saveHash(via);
  filterBar();
  if (!await loadTables()) return;
  companies();
}

// --- header ---------------------------------------------------------------------
// A band of the salary histogram: under the first edge, over the last, or between two.
function bandLabel(i, n) {
  const { low, step } = D.hist;
  return i === 0 ? `${S.under} ${short(low)}`
    : i === n - 1 ? `${S.over} ${short(low + (i - 1) * step)}`
    : `${short(low + (i - 1) * step)}–${short(low + i * step)}`;
}
const bandTip = (a, i) => {
  const c = a.hist[i];
  return `<b>${bandLabel(i, a.hist.length)} €</b><br>` + (c === null
    ? `${S.under} ${D.min_group} ${S.people}`
    : `${c.toLocaleString(LOCALE)} ${S.people} · ${share(c / a.n)}`);
};

// Grouped like the other figures: es-ES leaves four digits without a dot.
const grouped = (n) => n.toLocaleString(LOCALE, { useGrouping: "always" });

// Everyone in Spain: the median, the histogram and three figures, each with its unit.
function kpis() {
  const a = cell();
  $("k-median").textContent = a ? money(a.median) : "—";
  $("k-total").textContent = a ? money(a.total) : "—";
  $("k-share").textContent = a ? pct(a.share) : "—";
  $("k-people").textContent = a ? grouped(a.n) : "—";
  $("k-companies").textContent = grouped((D.company_cells["||"] || []).length);
  heroDist(a);
}

// Bars to scale on a 0..max+8% axis with round gridlines, one tick every 20k,
// and the 60k line, the bar the whole site is drawn around.
function heroDist(a) {
  const el = $("k-dist");
  if (!a) { el.innerHTML = ""; return; }
  const { low, step, high } = D.hist, n = a.hist.length;
  const top = Math.max(...a.hist.map((c) => c || 0)) * 1.08;
  const every = [100, 200, 250, 500, 1000, 2000, 2500, 5000].find((g) => top / g <= 3) || 10000;
  const x = (edge) => (edge / n) * 100;
  const lines = [];
  for (let v = every; v < top; v += every)
    lines.push(`<span class="gl" style="bottom:${(v / top) * 100}%"><b>${grouped(v)}</b></span>`);
  const bars = a.hist.map((c, i) => {
    const high = i > 0 && low + (i - 1) * step >= D.threshold;
    return `<span class="col" data-i="${i}"><i class="${high ? "hi" : ""}" style="height:${((c || 0) / top) * 100}%"></i></span>`;
  }).join("");
  const ticks = [];
  for (let v = low; v < high - step; v += 2 * step)
    ticks.push(`<span${v === D.threshold ? ' class="at"' : ""} style="left:${x(1 + (v - low) / step)}%">${short(v)}</span>`);
  ticks.push(`<span style="left:${x(n - 0.5)}%">${short(high)}+</span>`);
  el.innerHTML = `<div class="plot"><div class="area">${lines.join("")}` +
    `<div class="bars" style="grid-template-columns:repeat(${n},minmax(0,1fr))">${bars}</div></div>` +
    `<span class="cut" style="left:${x(1 + (D.threshold - low) / step)}%"><b>${esc(S.hero_cut)}</b></span></div>` +
    `<div class="axis" aria-hidden="true">${ticks.join("")}</div>`;
  el.querySelectorAll(".col").forEach((col) => hover(col, () => bandTip(a, +col.dataset.i)));
}

// The veil behind the banner's text hugs the text, so the tiles stop as far
// from it on every side. Its box is the column, which is wider than a balanced
// title, and the title's line box starts above its letters. The text and the
// buttons take the width of the title's longest line, so nothing sticks out.
function hugVeil() {
  const v = document.querySelector(".pitch.veil");
  if (!v) return;
  const box = v.getBoundingClientRect(), h1 = v.querySelector("h1"), r = document.createRange();
  // The title's lines are measured on the whole column, then the block takes their width.
  v.style.removeProperty("--title-w");
  r.selectNodeContents(h1);
  const lines = [...r.getClientRects()];
  const title = Math.max(...lines.map((q) => q.right)) - Math.min(...lines.map((q) => q.left));
  v.style.setProperty("--title-w", `${Math.min(box.width, Math.ceil(title))}px`);
  let right = v.querySelector(".cta").getBoundingClientRect().right;
  for (const el of [h1, v.querySelector(".hero-lede")]) {
    r.selectNodeContents(el);
    for (const q of r.getClientRects()) right = Math.max(right, q.right);
  }
  v.style.setProperty("--hug-right", `${Math.max(0, box.right - right)}px`);
  // The words on the title's first line, and how far below their line's top
  // their letters start. A page translator replaces the title's text node.
  const text = h1.firstChild;
  if (text?.nodeType !== Node.TEXT_NODE) return;
  let first = "", at = 0, top = null;
  for (const w of text.data.split(" ")) {
    r.setStart(text, at); r.setEnd(text, at + w.length);
    const t = r.getBoundingClientRect().top;
    if (top === null) top = t;
    if (Math.abs(t - top) > 2) break;
    first += (first ? " " : "") + w; at += w.length + 1;
  }
  const cs = getComputedStyle(h1), ctx = document.createElement("canvas").getContext("2d");
  ctx.font = `${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
  const m = ctx.measureText(first);
  const ink = (parseFloat(cs.lineHeight) - m.fontBoundingBoxAscent - m.fontBoundingBoxDescent) / 2
    + m.fontBoundingBoxAscent - m.actualBoundingBoxAscent;
  v.style.setProperty("--hug-top", `${Math.max(0, ink) || 0}px`);
}

// --- pay shades -----------------------------------------------------------------
// One scale for pay on the map and in the matrix: two greys under the 60k bar,
// the hue from it, so the colour itself says which side of the bar a figure is.
const SHADE_EDGES = [50000, 60000, 70000, 85000];
const shade = (v) => 1 + SHADE_EDGES.filter((t) => v >= t).length;
const payLegend = () => [0, ...SHADE_EDGES].map((v, i, edges) => {
  const to = edges[i + 1];
  const label = !v ? `< ${short(to)}` : to ? `${short(v)}–${short(to)}` : `${short(v)}+`;
  return `<span><i class="s${i + 1}"></i>${label}</span>`;
}).join("") + `<span><i class="na"></i>${esc(S.map_empty)}</span>`;

// --- map ------------------------------------------------------------------------
// The map shows either pay or how many salaries each region has. Counts run
// from a handful to thousands, so their grey classes are on a log scale. Counts
// are the default view.
let mapMetric = "count";

function map() {
  const svg = $("map");
  const stats = {};
  for (const code of Object.keys(D.regions)) {
    const a = cell({ region: code });
    if (a) stats[code] = a;
  }
  const pay = mapMetric === "pay";
  const value = (a) => pay ? a.median : a.n;
  const vals = Object.values(stats).map((a) => Math.log(a.n));
  const lo = Math.min(...vals), hi = Math.max(...vals);
  const classes = vals.length ? 5 : 0;
  const step = (hi - lo) / classes || 1;
  // Both views are hatched: the map's <pattern>s #hpN (pay) and #hcN (counts).
  const fill = (a) => pay ? `url(#hp${shade(a.median)})`
    : `url(#hc${hi === lo ? classes : Math.min(classes, 1 + Math.floor((Math.log(a.n) - lo) / step))})`;

  $("map-sub").textContent = pay ? S.map_pay_sub : S.map_count_sub;
  $("map-metric").querySelectorAll("button").forEach((b) => {
    b.setAttribute("aria-pressed", b.dataset.m === mapMetric);
    b.onclick = () => { mapMetric = b.dataset.m; map(); };
  });

  svg.querySelectorAll(".region").forEach((p) => {
    const code = p.dataset.code, a = stats[code];
    p.classList.toggle("has", !!a);
    p.style.fill = a ? fill(a) : "";
    p.onmousemove = (e) => showTip(e, a ? statTip(regionName(code), a)
      : `<b>${esc(regionName(code))}</b><br>${esc(S.map_empty)}`);
    p.onmouseleave = hideTip;
    // Readers tap regions expecting the table to follow, phones above all.
    p.onclick = a ? async () => {
      hideTip();
      await applyFilters({ loc: code }, "map");
      $("companies-card").scrollIntoView({ behavior: "smooth", block: "start" });
    } : null;
  });

  let legend = "";
  if (pay) legend = payLegend();
  else {
    const count = (v) => Math.round(Math.exp(v)).toLocaleString(LOCALE);
    if (classes && hi > lo) {
      for (let i = 1; i <= classes; i++) {
        legend += `<span><i style="background:var(--c${i})"></i>${count(lo + step * (i - 1))}–${count(lo + step * i)}</span>`;
      }
    }
    legend += `<span><i class="na"></i>${esc(S.map_empty)}</span>`;
  }
  $("legend").innerHTML = legend;

  const ranked = Object.entries(stats).sort((x, y) => value(y[1]) - value(x[1]));
  const max = ranked.length ? value(ranked[0][1]) : 1;
  const ol = $("ranking");
  ol.innerHTML = ranked.map(([code, a]) =>
    `<li data-code="${code}"${!pay || a.median >= D.threshold ? ' class="hi"' : ""}>` +
    `<span>${esc(regionName(code))}<span class="n">${pay ? a.n : money(a.median)}</span></span>` +
    `<span class="v">${pay ? money(a.median) : a.n.toLocaleString(LOCALE)}</span>` +
    `<span class="bar"><i style="width:${(value(a) / max) * 100}%"></i></span></li>`).join("");
  ol.querySelectorAll("li").forEach((li) =>
    hover(li, () => statTip(regionName(li.dataset.code), stats[li.dataset.code])));
}

// --- matrix -------------------------------------------------------------------
// The roles with most salaries against the experience bands, one median per
// cell. A cell sets the table below to that role and band.
const MATRIX_ROLES = 8;

function matrix() {
  const roles = D.roles.filter((r) => cell({ role: r.slug }) && roleTree().some((t) => t.slug === r.slug))
    .slice(0, MATRIX_ROLES);
  $("matrix").innerHTML = `<thead><tr><th></th>` +
    D.years.map((b) => `<th scope="col">${esc(yearsLabel(b))}</th>`).join("") + `</tr></thead><tbody>` +
    roles.map((r) => `<tr><th scope="row">${esc(r.name)}` +
      `<small>${cell({ role: r.slug }).n.toLocaleString(LOCALE)} ${S.people}</small></th>` +
      D.years.map((b) => {
        const a = cell({ role: r.slug, years: b });
        return a
          ? `<td><button class="s${shade(a.median)}" data-role="${r.slug}" data-years="${b}"` +
            ` aria-label="${esc(`${r.name}, ${yearsLabel(b)}: ${money(a.median)}`)}">${short(a.median)}</button></td>`
          : `<td class="na" title="${esc(S.map_empty)}">·</td>`;
      }).join("") + `</tr>`).join("") + `</tbody>`;
  $("matrix").querySelectorAll("button").forEach((btn) => {
    const r = D.roles.find((x) => x.slug === btn.dataset.role);
    hover(btn, () => statTip(`${r.name} · ${yearsLabel(btn.dataset.years)}`,
      cell({ role: btn.dataset.role, years: btn.dataset.years })));
    btn.onclick = async () => {
      hideTip();
      await applyFilters({ role: btn.dataset.role, years: [btn.dataset.years] }, "matrix");
      $("companies-card").scrollIntoView({ behavior: "smooth", block: "start" });
    };
  });
  $("matrix-legend").innerHTML = payLegend();
}

// --- pay -----------------------------------------------------------------------
// A row or summary of the companies table, its figures on the pay followed:
// on total, the t-prefixed ones stand in for the base ones. A table from
// before total was published has none, and stays on base.
const onTotal = () => state.pay === "total" && T[state.role]?.fields?.includes("tshare");
const paid = (a) => !onTotal() ? a : {
  ...a, median: a.total, p25: a.tp25, p75: a.tp75, share: a.tshare, hist: a.thist || a.hist,
};
const LABELS = {
  median: ["col_median", "col_total"], share: ["col_share", "col_share_total"],
  tip_median: ["tip_median", "tip_total"], tip_share: ["tip_share", "tip_share_total"],
};
const label = (k) => S[LABELS[k][onTotal() ? 1 : 0]];

// --- summary ------------------------------------------------------------------
// Everyone under the table's filters, before search: the figures the old
// experience and distribution cards gave, now for the case the reader picked.
function summary() {
  const t = T[state.role], row = at((state.loc ? T[placeFile()] : t)?.summary, tkey());
  const el = $("summary");
  if (!row) { el.innerHTML = `<p class="empty">${esc(S.none)}</p>`; return; }
  const a = paid(Object.fromEntries(t.summary_fields.map((f, i) => [f, row[i]])));
  const { low, step } = D.hist, max = Math.max(...a.hist.map((c) => c || 0));
  // Each band is a full-height column, so hovering above a short bar still
  // finds it.
  const bars = a.hist.map((c, i) => {
    const high = i > 0 && low + (i - 1) * step >= D.threshold;
    return `<span class="col" data-i="${i}"><i class="${high ? "hi" : ""}${c === null ? " wh" : ""}"` +
      ` style="height:${c ? Math.max(4, (c / max) * 100) : 4}%"></i></span>`;
  }).join("");
  const bar = ((1 + (D.threshold - low) / step) / a.hist.length) * 100;
  // The card at the top is everyone in Spain; under filters this one is a
  // part of it, and says which part, or the two read as contradicting.
  const on = Object.values(FILTERS).filter((f) => f.active());
  const scope = on.length ? `<p class="scope">` + esc(S.sum_scope)
    .replace("{filters}", () => `<b>${on.map((f) => esc(f.text())).join(" · ")}</b>`)
    .replace("{n}", grouped(a.n)).replace("{all}", grouped(D.cells["||"].n)) + `</p>` : "";
  el.innerHTML = scope +
    `<dl><dt>${label("median")}</dt><dd>${money(a.median)}</dd></dl>` +
    `<dl><dt>${S.sum_range}</dt><dd>${range(a)}</dd></dl>` +
    `<dl><dt>${label("share")}</dt><dd>${pct(a.share)}</dd></dl>` +
    `<dl><dt>${S.col_n}</dt><dd>${grouped(a.n)}</dd></dl>` +
    `<div class="dist" aria-hidden="true"><div class="bars">${bars}<span class="ref" style="left:${bar}%"></span></div>` +
    `<div class="axis"><span>${short(low)}</span>` +
    `<span style="left:${bar}%">${short(D.threshold)}</span>` +
    `<span>${short(D.hist.high)}+</span></div></div>`;
  el.querySelectorAll(".dist .col").forEach((col) => hover(col, () => bandTip(a, +col.dataset.i)));
}

// --- companies ------------------------------------------------------------------
const SORTS = {
  median: (a) => a.median,
  total: (a) => a.total,
  share: (a) => paid(a).share,
  n: (a) => a.n,
};

function levelsUrl(slug) {
  return state.role
    ? `https://www.levels.fyi/companies/${slug}/salaries/${state.role.split("/")[0]}/locations/spain`
    : `https://www.levels.fyi/companies/${slug}/salaries`;
}

// Every slot is always drawn, empty when a link is missing, so each logo sits
// in the same column on every row.
const ICONS = {
  web: `<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8">` +
    `<circle cx="12" cy="12" r="10"/><path d="M2 12h20M12 2c2.8 2.7 4.2 6 4.2 10s-1.4 7.3-4.2 10` +
    `c-2.8-2.7-4.2-6-4.2-10S9.2 4.7 12 2z"/></svg>`,
  levels: `<svg viewBox="0 0 24 24" aria-hidden="true" shape-rendering="crispEdges">` +
    `<path fill="currentColor" d="M0 24v-6h6v-6h6V6h6V0h6v24z"/></svg>`,
  linkedin: `<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M20.447 20.452h-3.554v-5.569` +
    `c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85` +
    ` 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 1 1 0-4.125 2.062 2.062 0 0 1 0 4.125z` +
    `m1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451` +
    `C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/></svg>`,
};
const iconLink = (url, kind, label) => url
  ? `<a href="${esc(url)}" target="_blank" rel="noopener" title="${label}" aria-label="${label}">${ICONS[kind]}</a>`
  : `<span></span>`;

// One file per role, with every combination of bands and arrangements in it,
// and one per role and place ("all~CT", "software-engineer~AN-malaga"), loaded
// when a place is picked; see company_filters() in site.py.
const T = {};
async function loadTable(name) {
  if (T[name]) return true;
  $("companies").innerHTML = `<tr><td class="empty">${esc(S.loading)}</td></tr>`;
  let r;
  try {
    r = await fetch(`/api/v1/companies/${name || "all"}.json?v=${window.DATA_V}`);
  } catch {
    // Offline or cut off: nothing is cached, so the retry fetches again.
    $("companies").innerHTML = `<tr><td class="empty">${esc(S.load_failed)} ` +
      `<button type="button" id="retry">${esc(S.retry)}</button></td></tr>`;
    $("retry").onclick = async () => { if (await loadTables()) { filterBar(); companies(); } };
    log("warn", "salary table unreachable", { table: name || "all" });
    return false;
  }
  const t = r.ok ? await r.json() : { cells: {}, summary: {}, years: {}, whole: [] };
  // A tab opened before a deploy holds the old company list, and the tables
  // number companies by their place in it: reload (the hash keeps the
  // filters), or, if this tab already did, fetch today's list.
  if (t.list_v && t.list_v !== D.list_v) {
    if (reloadStale()) return false;
    D = await (await fetch(`/api/v1/data.json?v=${t.list_v}`)).json();
  }
  T[name] = t;
  if (T[name].whole) T[name].whole = new Set(T[name].whole);
  log(r.ok ? "debug" : "warn", r.ok ? "salary table loaded" : "salary table unavailable", {
    table: name || "all",
  });
  return true;
}
function reloadStale() {
  try {
    if (sessionStorage.getItem("stale") === D.list_v) return false;
    sessionStorage.setItem("stale", D.list_v);
  } catch { return false; }
  log("info", "stale page reloaded", { list: D.list_v || "none" });
  location.reload();
  return true;
}
// The role's file first: its `places` name the place's file. False when one
// could not be reached, and the table shows the retry instead.
// A place the role has no salaries in (a region tapped on the map) has no
// file: the table is empty without asking for one.
const rolePlace = () => places().some((r) => r.code === state.loc || r.cities.some((c) => c[0] === state.loc));
async function loadTables() {
  return await loadTable(state.role) && (!state.loc || !rolePlace() || await loadTable(placeFile()));
}
// Keys list arrangements in lib.WORK_ARRANGEMENTS order, not the menu's.
const KEY_MODES = ["office", "hybrid", "remote"];
const modeKey = () => KEY_MODES.filter((m) => state.modes.includes(m)).join(",");
const tkey = (o = {}) => {
  const modes = KEY_MODES.filter((m) => (o.modes || state.modes).includes(m));
  return `${modes.join(",")}|${(o.years || state.years).join(",")}`;
};
// A key whose value repeats an earlier key's holds that key; see shared().
const at = (o, k) => { const v = o?.[k]; return typeof v === "string" ? o[v] : v; };
// A place's file holds rows only for companies that are also elsewhere; the
// ones whose salaries are all there (`whole`) keep the role file's rows.
function table(o) {
  const t = T[state.role], key = tkey(o);
  let rows = at(t?.cells, key) || [];
  if (state.loc) {
    const p = T[placeFile()];
    rows = p ? rows.filter((r) => p.whole.has(r[0])).concat(at(p.cells, key) || []) : [];
  }
  return rows.map((row) => Object.fromEntries(t.fields.map((f, i) => [f, row[i]])));
}

// A company's own [median, count] per experience band, under the role and
// arrangements chosen; null where nobody in the band reported. Unlike every
// other figure, a band of one person has its median: see company_years() in
// site.py.
const companyYears = (id) => {
  const p = state.loc && T[placeFile()];
  const per = (p && !p.whole.has(id) ? p : T[state.role])?.years?.[modeKey()]?.[id];
  // [median base, count, median total]: on total, the total takes the base's place.
  return bands().map((b, i) => {
    const y = per?.[i];
    return [b, y ? (onTotal() && y[2] != null ? [y[2], y[1]] : y) : null];
  });
};

function detail(a) {
  const years = companyYears(a.c);
  // 60k is always on the scale, so its line is drawn to it.
  const max = Math.max(D.threshold, ...years.map(([, y]) => y ? y[0] : 0));
  const h = (v) => (v / max) * 72;
  const bars = years.map(([, y]) => y
    ? `<div class="yb" title="n = ${y[1]}"><b>${short(y[0])}</b>` +
      `<i${y[0] >= D.threshold ? ' class="hi"' : ""} style="height:${h(y[0])}px"></i></div>`
    : `<div class="yb"><span class="na">–</span><i class="none"></i></div>`).join("");
  // On a phone the unit leaves each label for one caption under the axis.
  const labels = years.map(([b]) =>
    `<span${state.years.includes(b) ? ' class="on"' : ""}>${b.replace("-", "–")}<small> ${S.years_unit}</small></span>`).join("");
  const chart = `<div class="ybars"><div class="yplot">${bars}` +
    `<span class="ref" style="bottom:${h(D.threshold)}px"><em>${short(D.threshold)}</em></span></div>` +
    `<div class="yaxis">${labels}</div><p class="yunit">${S.years_axis}</p></div>`;
  // The links repeat here for phones, where the row has no room for them.
  return `<div class="detail">${years.some(([, y]) => y) ? chart : ""}` +
    split(a) + `<span class="links">${companyLinks(D.companies[a.c])}</span></div>`;
}

const companyLinks = (c) => iconLink(c.levels && levelsUrl(c.levels), "levels", "Levels.fyi") +
  iconLink(c.linkedin, "linkedin", "LinkedIn") + iconLink(c.web, "web", S.web);

// The median total, and how much of the pay behind it is base, bonus and
// stock: shares that add up, where three medians would not.
function split(a) {
  const parts = [[S.split_base, "b0"], [S.split_bonus, "b1"], [S.split_stock, "b2"]];
  return `<div class="split" title="${esc(S.split_tip)}"><dl><dt>${S.split_total}</dt>` +
    `<dd>${money(a.total)}</dd></dl>` +
    `<div class="mix">${parts.map(([, c], i) => a.mix[i] ? `<i class="${c}" style="width:${a.mix[i]}%"></i>` : "").join("")}</div>` +
    `<ul class="mix-key">${parts.map(([k, c], i) => `<li class="${c}${a.mix[i] ? "" : " nil"}">${k} <b>${a.mix[i]}%</b></li>`).join("")}</ul></div>`;
}

const opened = new Set();

// The asterisk opens a card about that company on a click or a tap, not a
// hover, so a phone gets it too: how many salaries it has in Spain and why
// its figure may be off. One card for every asterisk, under the one clicked,
// following it as the page scrolls; a second click, a click elsewhere,
// Escape or a redrawn table closes it. Not a scroll: a tap at the end of a
// flick scrolls the page just after the card opens.
const astTip = $("asterisk-tip");
let astAt = null;
function closeAsterisk() {
  if (!astAt) return;
  astAt.setAttribute("aria-expanded", "false");
  astTip.hidden = true;
  astAt = null;
}
function placeAsterisk() {
  if (!astAt) return;
  const b = astAt.getBoundingClientRect(), r = astTip.getBoundingClientRect();
  const x = Math.min(Math.max(8, b.right - r.width), innerWidth - r.width - 8);
  const y = b.bottom + 6 + r.height > innerHeight - 8 ? b.top - 6 - r.height : b.bottom + 6;
  astTip.style.left = `${x}px`;
  astTip.style.top = `${y}px`;
}
document.addEventListener("click", (e) => {
  if (e.target.closest("#asterisk-tip")) return;
  const ast = e.target.closest(".asterisk");
  const again = ast === astAt;
  closeAsterisk();
  if (!ast || again) return;
  const c = D.companies[+ast.dataset.c], one = c.n === 1;
  const fill = (s) => esc(s).replace("{name}", () => esc(c.name)).replace("{n}", c.n);
  astTip.innerHTML = `<b>${fill(one ? S.ast_title_1 : S.ast_title_n)}</b>` +
    `<p>${fill(one ? S.ast_body_1 : S.ast_body_n)}</p>`;
  astAt = ast;
  ast.setAttribute("aria-expanded", "true");
  astTip.hidden = false;
  placeAsterisk();
});
document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeAsterisk(); });
addEventListener("scroll", placeAsterisk, { passive: true });
addEventListener("resize", placeAsterisk);

// The rows whose company's name has the search in it, `q` lowercased.
const named = (rows, q) => q ? rows.filter((a) => D.companies[a.c].name.toLowerCase().includes(q)) : rows;

// An empty table says why and offers a way out: one button per active filter,
// each lifting just that one, or clearing the search when only it hides
// everything. A region tapped on the map can be empty for the role picked.
const EMPTY_WAYS = [
  ["role", () => !!state.role, { role: "" }],
  ["loc", () => !!state.loc, { loc: "" }],
  ["years", () => state.years.length > 0, { years: [] }],
  ["modes", () => state.modes.length > 0, { modes: [] }],
];
function emptyTable(searchOnly) {
  const q = state.q.trim();
  const ways = searchOnly ? [] : EMPTY_WAYS.filter(([, on]) => on());
  const text = searchOnly ? esc(S.empty_search).replace("{q}", () => esc(q))
    : ways.length ? esc(S.empty_text) : esc(S.none);
  const buttons = searchOnly ? `<button type="button" data-clear="q">${esc(S.clear_search)}</button>`
    : ways.map(([k]) => `<button type="button" data-clear="${k}">${esc(S["clear_" + k])}</button>`).join("");
  return `<tr><td class="empty"><p class="empty-title">${esc(S.empty_title)}</p><p>${text}</p>` +
    (buttons ? `<div class="empty-ways">${buttons}</div>` : "") + `</td></tr>`;
}
function wireEmpty() {
  $("companies").querySelectorAll("[data-clear]").forEach((b) => b.onclick = () => {
    const k = b.dataset.clear;
    if (k === "q") { state.q = ""; $("search").value = ""; companies(); return; }
    applyFilters(EMPTY_WAYS.find(([key]) => key === k)[2], "empty");
  });
}

function companies() {
  summary();
  const all = table();
  // With no salaries at all the table's own message says it; the summary
  // would only repeat it.
  $("summary").hidden = !all.length;
  const q = state.q.trim().toLowerCase();
  const by = SORTS[state.sort];
  // A company under min_ranked salaries goes after the rest whatever the
  // column and the direction: its "median" is one person's pay.
  // 3 until a refresh writes min_ranked into data.json.
  const thin = (a) => a.n < (D.min_ranked || 3);
  // Under min_ranked salaries in Spain, whatever the filters: the figure is
  // one or two people's pay, marked with an asterisk, and the note under the
  // table says so. A big company down to one salary under a filter gets none;
  // the note would be untrue of it.
  const few = (a) => D.companies[a.c].n < (D.min_ranked || 3);
  const rows = named(all, q).slice().sort((x, y) => thin(x) - thin(y) ||
      (state.asc ? -1 : 1) * (by(y) - by(x) || paid(y).median - paid(x).median));
  const shown = state.all ? rows : rows.slice(0, 15);
  const asterisk = (a) => `<button class="asterisk" type="button" data-c="${a.c}" ` +
    `aria-label="${esc(S.ast_label)}" aria-controls="asterisk-tip" aria-expanded="false">*</button>`;
  closeAsterisk();
  const hasTotal = !!T[state.role]?.fields?.includes("tshare");
  // The column followed leads: bold, with the asterisk when it has one; the
  // other pay is there to compare, quieter.
  const pay = (a, v, lead) => lead
    ? `<td class="pay lead${few(a) ? " few" : ""}"><b>${money(v)}</b>${few(a) ? asterisk(a) : ""}</td>`
    : `<td class="pay"><span>${money(v)}</span></td>`;
  const th = (k, label, tip, cls = "num") =>
    `<th class="${cls} sort${state.sort === k ? (state.asc ? " on asc" : " on") : ""}" data-sort="${k}"` +
    ` title="${esc(tip)}" aria-sort="${state.sort === k ? (state.asc ? "ascending" : "descending") : "none"}">` +
    `<span class="th-in"><span class="carets" aria-hidden="true"><i></i><i></i></span><span>${label}</span></span></th>`;
  // The share's heading reads base or total; both wordings take the same
  // cell, one hidden, so switching never makes the heading taller.
  const both = (k) => `<span class="swap">${LABELS[k].map((s, i) =>
    `<span${i === (onTotal() ? 1 : 0) ? "" : ' aria-hidden="true"'}>${S[s]}</span>`).join("")}</span>`;

  $("companies").innerHTML = !rows.length ? emptyTable(all.length > 0) :
    `<thead><tr><th class="chev"></th><th>${S.col_company}</th>` +
    th("median", S.col_median, S.tip_median, `pay${onTotal() ? "" : " lead"}`) +
    (hasTotal ? th("total", S.col_total, S.tip_total, `pay${onTotal() ? " lead" : ""}`) : "") +
    `${th("share", hasTotal ? both("share") : label("share"), label("tip_share"))}${th("n", S.col_n, S.tip_n)}</tr></thead><tbody>` +
    shown.map((a) => {
      const c = D.companies[a.c];
      const open = opened.has(a.c);
      return `<tr class="main${open ? " open" : ""}" tabindex="0" aria-expanded="${open}">` +
        `<td class="chev"><span>›</span></td>` +
        `<td class="co"><div class="co-in"><div><span class="name">${esc(c.name)}</span>` +
        `<span class="cities">${esc(c.cities.join(", "))}</span></div>` +
        `<span class="links">${companyLinks(c)}</span></div></td>` +
        pay(a, a.median, !onTotal()) + (hasTotal ? pay(a, a.total, onTotal()) : "") +
        `<td class="num">${pct(paid(a).share)}</td>` +
        `<td class="num">${a.n}</td></tr>` +
        `<tr class="det"${open ? "" : " hidden"}><td colspan="${hasTotal ? 6 : 5}">${open ? detail(a) : ""}</td></tr>`;
    }).join("") + `</tbody>`;
  $("few-note").hidden = !shown.some(few);
  $("pay-note").hidden = !hasTotal || !rows.length;
  if (!rows.length) wireEmpty();
  $("companies").querySelectorAll("tr.main").forEach((tr, i) => {
    tr.onkeydown = (e) => {
      // Keys on a link or the asterisk inside the row are theirs.
      if (e.target !== tr) return;
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); tr.click(); }
    };
    tr.onclick = (e) => {
      if (e.target.closest("a, .asterisk")) return;
      const id = shown[i].c, open = !opened.has(id);
      open ? opened.add(id) : opened.delete(id);
      tr.classList.toggle("open", open);
      tr.setAttribute("aria-expanded", open);
      const det = tr.nextElementSibling;
      det.hidden = !open;
      det.firstChild.innerHTML = open ? detail(shown[i]) : "";
      if (open) {
        track("company_open", { company: D.companies[id].name, role: state.role || null });
        starOpen();
      }
    };
  });
  $("companies").querySelectorAll("th.sort").forEach((t) =>
    // A second click on the same column flips the order; a new column starts
    // highest first.
    t.onclick = () => {
      state.asc = state.sort === t.dataset.sort ? !state.asc : false;
      state.sort = t.dataset.sort;
      // Sorting by a pay makes it the one followed; share and count keep it.
      const was = state.pay;
      if (state.sort === "median") state.pay = "base";
      if (state.sort === "total") state.pay = "total";
      if (state.pay !== was) writeHash();
      companies();
      track("sort", { by: state.sort, asc: state.asc, pay: state.pay });
    });

  const more = $("more");
  more.hidden = rows.length <= 15;
  more.textContent = state.all ? S.show_less : S.show_all.replace("{n}", rows.length);
}

// --- agents -------------------------------------------------------------------------
// The section shows one agent at a time and turns to the next every few
// seconds; picking one stops the turn. Nothing turns for readers
// who ask for less motion.
const AGENT_TURN_MS = 3000;
const STILL = matchMedia("(prefers-reduced-motion: reduce)").matches;

function agents() {
  const tabs = [...document.querySelectorAll(".agent-tab")];
  const names = [...document.querySelectorAll(".agent-name")];
  let at = 0, picked = false;
  const name = (k) => names.forEach((n) => { n.textContent = tabs[k].dataset.name; });
  const show = (k) => {
    at = k;
    document.querySelectorAll(".agent-stack .agent-tile").forEach((el, j) => el.classList.toggle("on", j === k));
    tabs.forEach((t, j) => t.setAttribute("aria-pressed", String(j === k)));
    name(k);
    $("agent-by").textContent = tabs[k].dataset.by;
    $("agent-get").href = tabs[k].dataset.url;
  };
  // Names differ in length: "Claude Code" wrapped a line the others did not,
  // so the page grew at every turn and the browser scrolled to make up for
  // it. Every box that holds a name keeps the height of its longest one.
  const steady = () => {
    const boxes = [...document.querySelectorAll(".agent-say, .agent-steps p")]
      .filter((b) => b.querySelector(".agent-name"));
    boxes.forEach((b) => { b.style.minHeight = ""; });
    const tall = boxes.map(() => 0);
    tabs.forEach((_, k) => {
      name(k);
      boxes.forEach((b, i) => { tall[i] = Math.max(tall[i], b.getBoundingClientRect().height); });
    });
    name(at);
    boxes.forEach((b, i) => { b.style.minHeight = `${tall[i]}px`; });
  };
  steady();
  document.fonts.ready.then(steady);
  let width = innerWidth;
  addEventListener("resize", () => { if (innerWidth !== width) { width = innerWidth; steady(); } });
  tabs.forEach((t, k) => { t.onclick = () => { picked = true; show(k); track("agent_pick", { agent: t.dataset.name }); }; });
  if (!STILL) setInterval(() => { if (!picked && !document.hidden) show((at + 1) % tabs.length); }, AGENT_TURN_MS);
  document.querySelectorAll(".copy-btn").forEach((b) => {
    b.onclick = async () => {
      try { await navigator.clipboard.writeText($(b.dataset.copy).textContent.trim()); } catch { return; }
      track("copy", { what: b.dataset.copy, agent: tabs[at].dataset.name });
      b.textContent = S.copied;
      setTimeout(() => { b.textContent = S.copy; }, 2000);
    };
  });
}

// --- star prompt ----------------------------------------------------------------
// Once a reader has opened a third company, a small card asks for a GitHub
// star; on a phone, where few are signed in to GitHub (the Reddit app's
// browser above all), it asks them to share the site instead. A star or a
// share is never asked again; closing waits a month. Until 2026-11-09 it came
// after 40 seconds for everyone: 3,621 sessions closed it in a month, 78
// clicked, 65 of them on phones.
const STAR_AFTER_OPENS = 3;
// A beat after that click, so the card does not land on the row opening.
const STAR_SHOW_MS = 1200;
const STAR_SNOOZE_DAYS = 30;
// A new key with each new card, so a reader who closed the old one sees the
// new one once. Whoever clicked through from an older card is never asked.
const STAR_KEY = "star-prompt-3";
const STAR_OLD_KEYS = ["star-prompt-2", "star-prompt"];
const PHONE = matchMedia("(hover: none), (max-width: 800px)").matches;

function store(value) {
  try {
    if (value !== undefined) return localStorage.setItem(STAR_KEY, value);
    return localStorage.getItem(STAR_KEY) ??
      (STAR_OLD_KEYS.some((k) => localStorage.getItem(k) === "starred") ? "starred" : null);
  } catch { return null; }
}

// Called with each company opened; shows the card after the third.
let starOpen = () => {};
function starPrompt() {
  const seen = store();
  if (seen === "starred" || seen === "shared" || (seen && Date.now() < +seen)) return;
  const pop = $("star"), mode = PHONE ? "share" : "star";
  pop.classList.toggle("share", PHONE);
  // Shown, clicked and closed go to PostHog, with the mode.
  const close = (value, action) => { pop.hidden = true; store(value); track("star_prompt", { action, mode }); };
  $("star-go").onclick = () => close("starred", "click");
  $("share-go").onclick = async () => {
    const url = location.origin + location.pathname;
    try {
      if (navigator.share) await navigator.share({ title: document.title, url });
      else {
        await navigator.clipboard.writeText(url);
        $("share-go").querySelector("span").textContent = S.share_copied;
        await new Promise((r) => setTimeout(r, 1200));
      }
    } catch { return; } // the share sheet closed without sharing: the card stays
    close("shared", "click");
  };
  $("star-close").onclick = () => close(String(Date.now() + STAR_SNOOZE_DAYS * 864e5), "close");
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !pop.hidden) $("star-close").click(); });
  let opens = 0;
  starOpen = () => {
    if (++opens !== STAR_AFTER_OPENS) return;
    setTimeout(() => {
      pop.hidden = false;
      track("star_prompt", { action: "shown", mode });
    }, STAR_SHOW_MS);
  };
}

// The topbar's star count is the one GitHub gave the build, once a day; this
// brings it up to the minute (ten, the CDN's cache). On any failure the
// built count stays.
async function freshStars() {
  const link = document.querySelector(".gh-stars"), span = link?.querySelector("span");
  if (!span) return;
  try {
    const { stars } = await (await fetch("/api/stars")).json();
    if (!Number.isInteger(stars)) return;
    const old = span.textContent, now = String(stars).replace(/\B(?=(\d{3})+(?!\d))/g, LANG === "es" ? "." : ",");
    if (old === now) return;
    span.textContent = now;
    for (const a of ["title", "aria-label"]) link.setAttribute(a, link.getAttribute(a).replace(old, now));
  } catch { /* offline or refused: keep the built count */ }
}

// --- render -------------------------------------------------------------------
async function main() {
  D = await (await fetch(`/api/v1/data.json?v=${window.DATA_V}`)).json();
  log("info", "salary site data loaded", { language: LANG });
  // The day the salaries were read, not the day the page was built.
  const asOf = new Date(`${D.data_as_of || D.generated}T00:00:00Z`);
  $("updated").textContent = S.updated.replace("{date}", asOf.toLocaleDateString(LOCALE,
    { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }));
  wire();
  agents();
  starPrompt();
  kpis(); map();
  // Again whenever the column changes width or the method opens, and once the fonts are in.
  // After the observer's turn: hugVeil resizes what it observes.
  new ResizeObserver(() => requestAnimationFrame(hugVeil)).observe(document.querySelector(".pitch"));
  document.fonts.ready.then(hugVeil);
  await loadTable("");
  matrix();
  const h = new URLSearchParams(location.hash.slice(1));
  const list = (k, known) => (h.get(k) || "").split(",").filter((v) => known.includes(v));
  const role = h.get("role") || "";
  state.role = roleTree().some((r) => r.slug === role || r.specs.some((x) => x.slug === role)) ? role : "";
  // A span is consecutive bands; anything else in the link falls back to any.
  const years = list("years", bands());
  const first = bands().indexOf(years[0]);
  const span = years.length && years.every((y, i) => bands()[first + i] === y);
  state.years = span && years.length < bands().length ? years : [];
  state.modes = list("work", MODES);
  if (h.get("pay") === "total") { state.pay = "total"; state.sort = "total"; }
  if (state.modes.length === MODES.length) state.modes = [];
  await loadTable(state.role);
  const loc = h.get("loc") || "";
  state.loc = places().some((r) => r.code === loc || r.cities.some((c) => c[0] === loc)) ? loc : "";
  filterBar();
  if (!await loadTables()) return;
  companies();
}
main();
freshStars();
