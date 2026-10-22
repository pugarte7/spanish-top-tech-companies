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
const state = { role: "", years: [], modes: [], q: "", all: false, sort: "median", asc: false };
const MODES = ["remote", "hybrid", "office"];
const cell = (o = {}) => D.cells[`${o.role || ""}|${o.region || ""}|${o.years || ""}`];
const regionName = (code) => D.regions[code]?.[LANG] || code;
const yearsLabel = (b) => `${b.replace("-", "–")} ${S.years_unit}`;

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
};
let menuOpen = null;
const expanded = new Set();

const roleTree = () => T[""]?.roles || [];
const bands = () => T[""]?.bands || D.years;
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
  if (k === "role") {
    state.role = v;
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
  await loadTable(state.role);
  companies();
}

function saveHash() {
  const h = new URLSearchParams();
  if (state.role) h.set("role", state.role);
  if (state.years.length) h.set("years", state.years.join(","));
  if (state.modes.length) h.set("work", state.modes.join(","));
  history.replaceState(null, "", h.toString() ? "#" + h : location.pathname);
}

document.addEventListener("click", (e) => {
  if (menuOpen && !e.target.closest(".filter")) { menuOpen = null; filterBar(); }
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && menuOpen) { menuOpen = null; filterBar(); }
});

function wire() {
  $("search").oninput = (e) => { state.q = e.target.value; companies(); };
  $("more").onclick = () => { state.all = !state.all; companies(); };
}

// Set several filters at once, as a link or a matrix cell does.
async function applyFilters(patch) {
  Object.assign(state, patch, { all: false });
  menuOpen = null;
  saveHash();
  filterBar();
  await loadTable(state.role);
  companies();
}

// --- KPIs ---------------------------------------------------------------------
function kpis() {
  const a = cell();
  $("k-median").textContent = a ? money(a.median) : "—";
  $("k-total").textContent = a ? money(a.total) : "—";
  $("k-share").textContent = a ? pct(a.share) : "—";
  $("k-people").textContent = a ? a.n.toLocaleString(LOCALE) : "—";
  $("k-companies").textContent = (D.company_cells["||"] || []).length.toLocaleString(LOCALE);
  $("eyebrow").textContent = S.all_roles;
}

// --- map ------------------------------------------------------------------------
// The map shows either pay or how many salaries each region has. Counts run
// from a handful to thousands, so their colour classes are on a log scale.
let mapMetric = "pay";

function map() {
  const svg = $("map");
  const stats = {};
  for (const code of Object.keys(D.regions)) {
    const a = cell({ region: code });
    if (a) stats[code] = a;
  }
  const pay = mapMetric === "pay";
  const value = (a) => pay ? a.median : a.n;
  const scale = pay ? (v) => v : Math.log;
  const unscale = pay ? (v) => v : Math.exp;
  const vals = Object.values(stats).map((a) => scale(value(a)));
  const lo = Math.min(...vals), hi = Math.max(...vals);
  const classes = vals.length ? 5 : 0;
  const step = (hi - lo) / classes || 1;
  const cls = (a) => Math.min(classes, 1 + Math.floor((scale(value(a)) - lo) / step));
  const fmt = pay ? short : (v) => Math.round(v).toLocaleString(LOCALE);

  $("map-sub").textContent = pay ? S.map_pay_sub : S.map_count_sub;
  $("map-metric").querySelectorAll("button").forEach((b) => {
    b.setAttribute("aria-pressed", b.dataset.m === mapMetric);
    b.onclick = () => { mapMetric = b.dataset.m; map(); };
  });

  svg.querySelectorAll(".region").forEach((p) => {
    const code = p.dataset.code, a = stats[code];
    p.classList.toggle("has", !!a);
    p.style.fill = a ? `var(--seq-${hi === lo ? classes : cls(a)})` : "";
    p.onmousemove = (e) => showTip(e, a ? statTip(regionName(code), a)
      : `<b>${esc(regionName(code))}</b><br>${esc(S.map_empty)}`);
    p.onmouseleave = hideTip;
  });

  let legend = "";
  if (classes && hi > lo) {
    for (let i = 1; i <= classes; i++) {
      const from = unscale(lo + step * (i - 1)), to = unscale(lo + step * i);
      legend += `<span><i style="background:var(--seq-${i})"></i>${fmt(from)}–${fmt(to)}</span>`;
    }
  }
  legend += `<span><i style="background:var(--empty)"></i>${esc(S.map_empty)}</span>`;
  $("legend").innerHTML = legend;

  const ranked = Object.entries(stats).sort((x, y) => value(y[1]) - value(x[1]));
  const max = ranked.length ? value(ranked[0][1]) : 1;
  const ol = $("ranking");
  ol.innerHTML = ranked.map(([code, a]) =>
    `<li data-code="${code}">` +
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
const SHADE_EDGES = [50000, 60000, 70000, 85000];
const shade = (v) => 1 + SHADE_EDGES.filter((t) => v >= t).length;

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
      await applyFilters({ role: btn.dataset.role, years: [btn.dataset.years] });
      $("companies-card").scrollIntoView({ behavior: "smooth", block: "start" });
    };
  });
  const edges = [0, ...SHADE_EDGES];
  $("matrix-legend").innerHTML = edges.map((v, i) => {
    const to = edges[i + 1];
    const label = !v ? `< ${short(to)}` : to ? `${short(v)}–${short(to)}` : `${short(v)}+`;
    return `<span><i class="s${i + 1}"></i>${label}</span>`;
  }).join("") + `<span><i class="na"></i>${esc(S.map_empty)}</span>`;
}

// --- summary ------------------------------------------------------------------
// Everyone under the table's filters, before search: the figures the old
// experience and distribution cards gave, now for the case the reader picked.
function summary() {
  const t = T[state.role], row = t?.summary?.[tkey()];
  const el = $("summary");
  if (!row) { el.innerHTML = `<p class="empty">${esc(S.none)}</p>`; return; }
  const a = Object.fromEntries(t.summary_fields.map((f, i) => [f, row[i]]));
  const { low, step } = D.hist, max = Math.max(...a.hist.map((c) => c || 0));
  const band = (i) => i === 0 ? `${S.under} ${short(low)}`
    : i === a.hist.length - 1 ? `${S.over} ${short(low + (i - 1) * step)}`
    : `${short(low + (i - 1) * step)}–${short(low + i * step)}`;
  // Each band is a full-height column, so hovering above a short bar still
  // finds it.
  const bars = a.hist.map((c, i) => {
    const high = i > 0 && low + (i - 1) * step >= D.threshold;
    return `<span class="col" data-i="${i}"><i class="${high ? "hi" : ""}${c === null ? " wh" : ""}"` +
      ` style="height:${c ? Math.max(4, (c / max) * 100) : 4}%"></i></span>`;
  }).join("");
  el.innerHTML =
    `<dl><dt>${S.col_median}</dt><dd>${money(a.median)}</dd></dl>` +
    `<dl><dt>${S.sum_range}</dt><dd>${range(a)}</dd></dl>` +
    `<dl><dt>${S.col_share}</dt><dd>${pct(a.share)}</dd></dl>` +
    `<dl><dt>${S.col_n}</dt><dd>${a.n.toLocaleString(LOCALE)}</dd></dl>` +
    `<div class="dist" aria-hidden="true"><div class="bars">${bars}</div>` +
    `<div class="axis"><span>${short(low)}</span>` +
    `<span style="left:${((1 + (D.threshold - low) / step) / a.hist.length) * 100}%">${short(D.threshold)}</span>` +
    `<span>${short(D.hist.high)}+</span></div></div>`;
  el.querySelectorAll(".dist .col").forEach((col) => {
    const i = +col.dataset.i, c = a.hist[i];
    hover(col, () => `<b>${band(i)} €</b><br>` + (c === null
      ? `${S.under} ${D.min_group} ${S.people}`
      : `${c.toLocaleString(LOCALE)} ${S.people} · ${share(c / a.n)}`));
  });
}

// --- companies ------------------------------------------------------------------
const SORTS = {
  median: (a) => a.median,
  share: (a) => a.share,
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
    `<path fill="#788995" d="M0 24v-6h6v-6h6V6h6V0h6v24z"/></svg>`,
  linkedin: `<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="#0a66c2" d="M20.447 20.452h-3.554v-5.569` +
    `c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85` +
    ` 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 1 1 0-4.125 2.062 2.062 0 0 1 0 4.125z` +
    `m1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451` +
    `C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/></svg>`,
};
const iconLink = (url, kind, label) => url
  ? `<a href="${esc(url)}" target="_blank" rel="noopener" title="${label}" aria-label="${label}">${ICONS[kind]}</a>`
  : `<span></span>`;

// One file per role, with every combination of bands and arrangements in it;
// see company_filters() in site.py.
const T = {};
async function loadTable(role) {
  if (T[role]) return;
  $("companies").innerHTML = `<tr><td class="empty">${esc(S.loading)}</td></tr>`;
  const r = await fetch(`/api/v1/companies/${role || "all"}.json?v=${window.DATA_V}`);
  T[role] = r.ok ? await r.json() : { fields: [], cells: {} };
}
// Keys list arrangements in lib.WORK_ARRANGEMENTS order, not the menu's.
const KEY_MODES = ["office", "hybrid", "remote"];
const tkey = (o = {}) => {
  const modes = KEY_MODES.filter((m) => (o.modes || state.modes).includes(m));
  return `${modes.join(",")}|${(o.years || state.years).join(",")}`;
};
function table(o) {
  const t = T[state.role];
  return (t?.cells[tkey(o)] || []).map((row) =>
    Object.fromEntries(t.fields.map((f, i) => [f, row[i]])));
}

// A company's own median per experience band, under the role and arrangements
// chosen; null where the band has fewer than MIN_GROUP people.
const companyYears = (id) => bands().map((b) =>
  [b, table({ years: [b] }).find((a) => a.c === id) || null]);

function detail(a) {
  const bands = companyYears(a.c);
  const max = Math.max(...bands.map(([, y]) => y ? y.median : 0)) || 1;
  const bars = bands.map(([b, y]) => `<div class="yb${state.years.includes(b) ? " on" : ""}">` +
    (y ? `<b>${short(y.median)}</b><i style="height:${(y.median / max) * 72}px"></i>`
       : `<span class="na">–</span><i class="none"></i>`) +
    `<span>${yearsLabel(b)}</span></div>`).join("");
  // A company with no band of MIN_GROUP people would show six empty bars.
  // The links repeat here for phones, where the row has no room for them.
  return `<div class="detail">${bands.some(([, y]) => y) ? `<div class="ybars">${bars}</div>` : ""}` +
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

function companies() {
  summary();
  const all = table();
  const q = state.q.trim().toLowerCase();
  const by = SORTS[state.sort];
  const rows = (q ? all.filter((a) => D.companies[a.c].name.toLowerCase().includes(q)) : all)
    .slice().sort((x, y) => (state.asc ? -1 : 1) * (by(y) - by(x) || y.median - x.median));
  const shown = state.all ? rows : rows.slice(0, 15);
  const th = (k, label, tip, cls = "num") =>
    `<th class="${cls} sort${state.sort === k ? (state.asc ? " on asc" : " on") : ""}" data-sort="${k}"` +
    ` title="${esc(tip)}" aria-sort="${state.sort === k ? (state.asc ? "ascending" : "descending") : "none"}">${label}</th>`;

  $("companies").innerHTML = !rows.length ? `<tr><td class="empty">${esc(S.none)}</td></tr>` :
    `<thead><tr><th class="chev"></th><th>${S.col_company}</th>` +
    th("median", S.col_median, S.tip_median, "pay") +
    `${th("share", S.col_share, S.tip_share)}${th("n", S.col_n, S.tip_n, "num hide-sm")}</tr></thead><tbody>` +
    shown.map((a) => {
      const c = D.companies[a.c];
      const open = opened.has(a.c);
      return `<tr class="main${open ? " open" : ""}" tabindex="0" aria-expanded="${open}">` +
        `<td class="chev"><span>›</span></td>` +
        `<td class="co"><div class="co-in"><div><span class="name">${esc(c.name)}</span>` +
        `<span class="cities">${esc(c.cities.join(", "))}</span></div>` +
        `<span class="links">${companyLinks(c)}</span></div></td>` +
        `<td class="pay"><b>${money(a.median)}</b></td>` +
        `<td class="num">${pct(a.share)}</td>` +
        `<td class="num hide-sm">${a.n}</td></tr>` +
        `<tr class="det"${open ? "" : " hidden"}><td colspan="5">${open ? detail(a) : ""}</td></tr>`;
    }).join("") + `</tbody>`;
  $("companies").querySelectorAll("tr.main").forEach((tr, i) => {
    tr.onkeydown = (e) => {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); tr.click(); }
    };
    tr.onclick = (e) => {
      if (e.target.closest("a")) return;
      const id = shown[i].c, open = !opened.has(id);
      open ? opened.add(id) : opened.delete(id);
      tr.classList.toggle("open", open);
      tr.setAttribute("aria-expanded", open);
      const det = tr.nextElementSibling;
      det.hidden = !open;
      det.firstChild.innerHTML = open ? detail(shown[i]) : "";
    };
  });
  $("companies").querySelectorAll("th.sort").forEach((t) =>
    // A second click on the same column flips the order; a new column starts
    // highest first.
    t.onclick = () => {
      state.asc = state.sort === t.dataset.sort ? !state.asc : false;
      state.sort = t.dataset.sort;
      companies();
    });

  const more = $("more");
  more.hidden = rows.length <= 15;
  more.textContent = state.all ? S.show_less : S.show_all.replace("{n}", rows.length);
}

// --- star prompt ----------------------------------------------------------------
// After a while on the page, a small card asks for a GitHub star. The star
// opens the repo, where the reader stars it themselves: a page cannot star a
// repo for someone. Closing it waits a month; a click, never again.
const STAR_DELAY_MS = 40_000;
const STAR_SNOOZE_DAYS = 30;
const STAR_KEY = "star-prompt";

function store(value) {
  try { return value === undefined ? localStorage.getItem(STAR_KEY) : localStorage.setItem(STAR_KEY, value); }
  catch { return null; }
}

function starPrompt() {
  const seen = store();
  if (seen === "starred" || (seen && Date.now() < +seen)) return;
  const pop = $("star");
  const close = (value) => { pop.hidden = true; store(value); };
  $("star-go").onclick = () => close("starred");
  $("star-close").onclick = () => close(String(Date.now() + STAR_SNOOZE_DAYS * 864e5));
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !pop.hidden) $("star-close").click(); });
  setTimeout(() => { pop.hidden = false; }, STAR_DELAY_MS);
}

// --- render -------------------------------------------------------------------
async function main() {
  D = await (await fetch(`/api/v1/data.json?v=${window.DATA_V}`)).json();
  // The day the salaries were read, not the day the page was built.
  const asOf = new Date(`${D.data_as_of || D.generated}T00:00:00Z`);
  $("updated").textContent = S.updated.replace("{date}", asOf.toLocaleDateString(LOCALE,
    { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }));
  wire();
  starPrompt();
  kpis(); map();
  await loadTable("");
  matrix();
  const h = new URLSearchParams(location.hash.slice(1));
  const list = (k, known) => (h.get(k) || "").split(",").filter((v) => known.includes(v));
  const role = h.get("role") || "";
  state.role = roleTree().some((r) => r.slug === role || r.specs.some((x) => x.slug === role)) ? role : "";
  // A span is consecutive bands; anything else in the link falls back to any.
  const years = list("years", bands());
  const at = bands().indexOf(years[0]);
  const span = years.length && years.every((y, i) => bands()[at + i] === y);
  state.years = span && years.length < bands().length ? years : [];
  state.modes = list("work", MODES);
  if (state.modes.length === MODES.length) state.modes = [];
  filterBar();
  await loadTable(state.role);
  companies();
}
main();
