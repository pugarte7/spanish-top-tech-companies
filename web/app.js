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

let D;
const state = { role: "", region: "", years: "", q: "", all: false, allRoles: false, sort: "median" };
const key = (o = {}) => {
  const s = { ...state, ...o };
  return `${s.role}|${s.region}|${s.years}`;
};
const cell = (o) => D.cells[key(o)];
const regionName = (code) => D.regions[code]?.[LANG] || code;
const yearsLabel = (b) => `${b.replace("-", "–")} ${S.years_unit}`;

// --- tooltip ----------------------------------------------------------------
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
const statTip = (title, a) => `<b>${esc(title)}</b><br>${S.median} ${money(a.median)}<br>` +
  `<span class="t-sub">${S.range} ${short(a.p25)} – ${short(a.p75)} · ${a.n} ${S.people}</span>`;

// --- filters ------------------------------------------------------------------
function filters() {
  const sel = $("f-role");
  const groups = {};
  for (const r of D.roles) (groups[r.category] ||= []).push(r);
  const opt = (r) => `<option value="${r.slug}">${esc(r.name)}</option>`;
  sel.innerHTML = `<option value="">${esc(S.all_roles)}</option>` +
    (D.roles.length < 8 ? D.roles.map(opt).join("") : Object.keys(groups).sort().map((g) =>
      `<optgroup label="${esc(g)}">${groups[g].sort((x, y) => x.name.localeCompare(y.name))
        .map(opt).join("")}</optgroup>`).join(""));
  sel.value = state.role;
  sel.onchange = () => set({ role: sel.value });

  const seg = $("f-years");
  seg.innerHTML = [["", S.all_years], ...D.years.map((b) => [b, yearsLabel(b)])]
    .map(([v, l]) => `<button data-v="${v}">${esc(l)}</button>`).join("");
  seg.onclick = (e) => { const b = e.target.closest("button"); if (b) set({ years: b.dataset.v }); };

  $("f-region").onclick = () => set({ region: "" });
  $("search").oninput = (e) => { state.q = e.target.value; companies(); };
  $("more").onclick = () => { state.all = !state.all; companies(); };
  $("roles-more").onclick = () => { state.allRoles = !state.allRoles; rolesChart(); };
}

function set(patch) {
  Object.assign(state, patch, { all: false, allRoles: false });
  const h = new URLSearchParams();
  for (const k of ["role", "region", "years"]) if (state[k]) h.set(k, state[k]);
  history.replaceState(null, "", h.toString() ? "#" + h : location.pathname);
  render();
}

// --- KPIs ---------------------------------------------------------------------
function kpis() {
  const a = cell();
  $("k-median").textContent = a ? money(a.median) : "—";
  $("k-total").textContent = a ? money(a.total) : "—";
  $("k-share").textContent = a ? pct(a.share) : "—";
  $("k-people").textContent = a ? a.n.toLocaleString(LOCALE) : "—";
  $("k-companies").textContent = (D.company_cells[key()] || []).length.toLocaleString(LOCALE);
  const role = D.roles.find((r) => r.slug === state.role);
  $("eyebrow").textContent = [role ? role.name : S.all_roles,
    state.region && regionName(state.region), state.years && yearsLabel(state.years)]
    .filter(Boolean).join(" · ");
}

// --- map ------------------------------------------------------------------------
function map() {
  const svg = $("map");
  const stats = {};
  for (const code of Object.keys(D.regions)) {
    const a = cell({ region: code });
    if (a) stats[code] = a;
  }
  const meds = Object.values(stats).map((a) => a.median);
  const lo = Math.min(...meds), hi = Math.max(...meds);
  const classes = meds.length ? 5 : 0;
  const step = (hi - lo) / classes || 1;
  const cls = (m) => Math.min(classes, 1 + Math.floor((m - lo) / step));

  svg.classList.toggle("dim", !!state.region);
  svg.querySelectorAll(".region").forEach((p) => {
    const code = p.dataset.code, a = stats[code];
    p.classList.toggle("has", !!a);
    p.classList.toggle("sel", code === state.region);
    p.style.fill = a ? `var(--seq-${hi === lo ? classes : cls(a.median)})` : "";
    p.onmousemove = (e) => showTip(e, a ? statTip(regionName(code), a)
      : `<b>${esc(regionName(code))}</b><br>${esc(S.map_empty)}`);
    p.onmouseleave = hideTip;
    p.onclick = () => a && set({ region: state.region === code ? "" : code });
  });
  // Selected region on top so its outline is not hidden by neighbours.
  const sel = svg.querySelector(".region.sel");
  if (sel) svg.appendChild(sel);

  let legend = "";
  if (classes && hi > lo) {
    for (let i = 1; i <= classes; i++) {
      const from = lo + step * (i - 1), to = lo + step * i;
      legend += `<span><i style="background:var(--seq-${i})"></i>${short(from)}–${short(to)}</span>`;
    }
  }
  legend += `<span><i style="background:var(--empty)"></i>${esc(S.map_empty)}</span>`;
  $("legend").innerHTML = legend;

  const ranked = Object.entries(stats).sort((x, y) => y[1].median - x[1].median);
  const max = ranked.length ? ranked[0][1].median : 1;
  const ol = $("ranking");
  ol.innerHTML = ranked.map(([code, a]) =>
    `<li data-code="${code}" class="${code === state.region ? "sel" : ""}">` +
    `<span>${esc(regionName(code))}<span class="n">${a.n}</span></span>` +
    `<span class="v">${money(a.median)}</span>` +
    `<span class="bar"><i style="width:${(a.median / max) * 100}%"></i></span></li>`).join("");
  ol.querySelectorAll("li").forEach((li) => {
    li.onclick = () => set({ region: state.region === li.dataset.code ? "" : li.dataset.code });
    hover(li, () => statTip(regionName(li.dataset.code), stats[li.dataset.code]));
  });
}

// --- charts ---------------------------------------------------------------------
let W = 480, H = 230;
const PAD = { t: 22, r: 4, b: 26, l: 4 };
const roundTop = (x, y, w, h, r = 4) => {
  r = Math.min(r, w / 2, h);
  return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`;
};

// Charts draw at the box's own width so text stays at its real size.
function size(el) {
  W = Math.max(260, el.clientWidth || 480);
  H = W < 420 ? 200 : 230;
}

function yearsChart() {
  size($("years-chart"));
  const rows = D.years.map((b) => [b, cell({ years: b })]).filter(([, a]) => a);
  const el = $("years-chart");
  if (!rows.length) { el.innerHTML = `<p class="empty">${esc(S.none)}</p>`; return; }
  const max = Math.max(...rows.map(([, a]) => a.p75)) * 1.08;
  const ih = H - PAD.t - PAD.b, band = (W - PAD.l - PAD.r) / rows.length;
  const y = (v) => PAD.t + ih - (v / max) * ih;
  let g = `<line class="gridline" x1="0" x2="${W}" y1="${PAD.t + ih}" y2="${PAD.t + ih}"/>`;
  rows.forEach(([b, a], i) => {
    const bw = Math.min(56, band * 0.56), cx = PAD.l + band * i + band / 2;
    const off = state.years && state.years !== b ? " off" : "";
    g += `<g data-i="${i}">` +
      `<rect class="bar-hit" x="${cx - band / 2}" y="0" width="${band}" height="${H}"/>` +
      `<path class="bar${off}" d="${roundTop(cx - bw / 2, y(a.median), bw, PAD.t + ih - y(a.median))}"/>` +
      `<line class="whisker" x1="${cx}" x2="${cx}" y1="${y(a.p25)}" y2="${y(a.p75)}"/>` +
      `<line class="whisker" x1="${cx - 5}" x2="${cx + 5}" y1="${y(a.p75)}" y2="${y(a.p75)}"/>` +
      `<line class="whisker" x1="${cx - 5}" x2="${cx + 5}" y1="${y(a.p25)}" y2="${y(a.p25)}"/>` +
      `<text class="val" x="${cx}" y="${y(a.p75) - 7}" text-anchor="middle">${short(a.median)}</text>` +
      `<text x="${cx}" y="${H - 8}" text-anchor="middle">${esc(W < 420 ? b.replace("-", "–") : yearsLabel(b))}</text></g>`;
  });
  el.innerHTML = `<svg viewBox="0 0 ${W} ${H}">${g}</svg>`;
  el.querySelectorAll("g[data-i]").forEach((n) => {
    const [b, a] = rows[n.dataset.i];
    hover(n, () => statTip(yearsLabel(b), a));
    n.onclick = () => set({ years: state.years === b ? "" : b });
  });
}

function histChart() {
  const a = cell(), el = $("hist-chart");
  size(el);
  if (!a) { el.innerHTML = `<p class="empty">${esc(S.none)}</p>`; return; }
  const { low, step } = D.hist, counts = a.hist, minG = D.min_group;
  // Bands are 0: under `low`, i: [low + (i-1)·step, low + i·step), last: open.
  const label = (i) => i === 0 ? `${S.under} ${short(low)}`
    : i === counts.length - 1 ? `${S.over} ${short(low + (i - 1) * step)}`
    : `${short(low + (i - 1) * step)}–${short(low + i * step)}`;
  const max = Math.max(minG, ...counts.map((c) => c || 0)) * 1.08;
  const ih = H - PAD.t - PAD.b, band = (W - PAD.l - PAD.r) / counts.length;
  const y = (v) => PAD.t + ih - (v / max) * ih;
  let g = `<line class="gridline" x1="0" x2="${W}" y1="${PAD.t + ih}" y2="${PAD.t + ih}"/>`;
  counts.forEach((c, i) => {
    const x = PAD.l + band * i + 1, bw = band - 2;
    g += `<g data-i="${i}"><rect class="bar-hit" x="${x - 1}" y="0" width="${band}" height="${H}"/>`;
    if (c) g += `<path class="bar" d="${roundTop(x, y(c), bw, PAD.t + ih - y(c), 3)}"/>`;
    else if (c === null) g += `<rect class="withheld" x="${x + .5}" y="${y(minG - 1)}" width="${bw - 1}" height="${PAD.t + ih - y(minG - 1)}" rx="2"/>`;
    g += `</g>`;
  });
  // Axis labels every 20k, plus the bar at the threshold.
  for (let v = low; v <= D.hist.high; v += (W < 400 ? 4 : 2) * step) {
    const x = PAD.l + band * (1 + (v - low) / step);
    g += `<text x="${x}" y="${H - 8}" text-anchor="middle">${short(v)}</text>`;
  }
  const tx = PAD.l + band * (1 + (D.threshold - low) / step);
  g += `<line class="mark" x1="${tx}" x2="${tx}" y1="${PAD.t - 6}" y2="${PAD.t + ih}"/>` +
    `<text class="mark-label" x="${tx + 5}" y="${PAD.t}">${pct(a.share)} ≥ ${short(D.threshold)}</text>`;
  el.innerHTML = `<svg viewBox="0 0 ${W} ${H}">${g}</svg>`;
  el.querySelectorAll("g[data-i]").forEach((n) => {
    const i = +n.dataset.i, c = counts[i];
    hover(n, () => `<b>${label(i)} €</b><br>` +
      (c === null ? `${S.under} ${minG} ${S.people}` : `${c} ${S.people}`));
  });
}

function rolesChart() {
  const rows = D.roles.map((r) => [r, cell({ role: r.slug })]).filter(([, a]) => a)
    .sort((x, y) => y[1].median - x[1].median);
  const card = $("roles-card");
  card.hidden = state.role !== "" || rows.length < 2;
  if (card.hidden) return;
  const shown = state.allRoles ? rows : rows.slice(0, 12);
  const max = rows[0][1].median;
  const el = $("roles-chart");
  el.innerHTML = `<div class="roles">` + shown.map(([r, a]) =>
    `<div class="r" data-slug="${r.slug}"><span class="name">${esc(r.name)}<small>${a.n}</small></span>` +
    `<span class="v">${money(a.median)}</span>` +
    `<span class="track"><i style="width:${(a.median / max) * 100}%"></i></span></div>`).join("") + `</div>`;
  el.querySelectorAll(".r").forEach((n, i) => {
    hover(n, () => statTip(shown[i][0].name, shown[i][1]));
    n.onclick = () => set({ role: n.dataset.slug });
  });
  const more = $("roles-more");
  more.hidden = rows.length <= 12;
  more.textContent = state.allRoles ? S.show_less : S.show_all.replace("{n}", rows.length);
}

// --- companies ------------------------------------------------------------------
const SORTS = {
  median: (a) => a.median,
  vs: (a) => a.vs ?? -Infinity,
  share: (a) => a.share,
  n: (a) => a.n,
};
const signed = (v) => v == null ? "—" : (v > 0 ? "+" : v < 0 ? "−" : "") + Math.abs(Math.round(v * 100)) + "%";

function levelsUrl(slug) {
  return state.role
    ? `https://www.levels.fyi/companies/${slug}/salaries/${state.role}/locations/spain`
    : `https://www.levels.fyi/companies/${slug}/salaries`;
}

// Both slots are always drawn, empty when a link is missing, so each logo sits
// in the same column on every row.
const ICONS = {
  levels: `<svg viewBox="0 0 24 24" aria-hidden="true" shape-rendering="crispEdges">` +
    `<path fill="#788995" d="M0 24v-6h6v-6h6V6h6V0h6v24z"/></svg>`,
  linkedin: `<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="#0a66c2" d="M20.447 20.452h-3.554v-5.569` +
    `c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85` +
    ` 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 1 1 0-4.125 2.062 2.062 0 0 1 0 4.125z` +
    `m1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451` +
    `C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/></svg>`,
};
const iconLink = (url, kind, label) => url
  ? `<a href="${esc(url)}" rel="noopener" title="${label}" aria-label="${label}">${ICONS[kind]}</a>`
  : `<span></span>`;

function companies() {
  const all = D.company_cells[key()] || [];
  const q = state.q.trim().toLowerCase();
  const by = SORTS[state.sort];
  const rows = (q ? all.filter((a) => D.companies[a.c].name.toLowerCase().includes(q)) : all)
    .slice().sort((x, y) => by(y) - by(x) || y.median - x.median);
  const shown = state.all ? rows : rows.slice(0, 15);
  const lo = Math.min(...all.map((a) => a.p25)), hi = Math.max(...all.map((a) => a.p75));
  const x = (v) => ((v - lo) / (hi - lo || 1)) * 100;
  const th = (k, label, cls = "num", title = "") =>
    `<th class="${cls} sort${state.sort === k ? " on" : ""}" data-sort="${k}"${title ? ` title="${esc(title)}"` : ""}>${label}</th>`;

  $("companies").innerHTML = !rows.length ? `<tr><td class="empty">${esc(S.none)}</td></tr>` :
    `<thead><tr><th>${S.col_company}</th>${th("median", S.col_median, "")}` +
    `${th("vs", S.col_vs, "num", S.vs_tip)}<th class="num hide-sm">${S.col_total}</th>` +
    `${th("share", S.col_share)}${th("n", S.col_n, "num hide-sm")}</tr></thead><tbody>` +
    shown.map((a) => {
      const c = D.companies[a.c];
      const links = iconLink(c.levels && levelsUrl(c.levels), "levels", "Levels.fyi") +
        iconLink(c.linkedin, "linkedin", "LinkedIn");
      return `<tr><td class="co"><div class="co-in"><div><span class="name">${esc(c.name)}</span>` +
        `<span class="cities">${esc(c.cities.join(", "))}</span></div>` +
        `<span class="links">${links}</span></div></td>` +
        `<td class="med"><div class="medbar"><b>${money(a.median)}</b><span class="track">` +
        `<span class="rng" style="left:${x(a.p25)}%;width:${x(a.p75) - x(a.p25)}%"></span>` +
        `<span class="dot" style="left:${x(a.median)}%"></span></span></div></td>` +
        `<td class="num ${a.vs > 0 ? "vs-up" : "vs-down"}">${signed(a.vs)}</td>` +
        `<td class="num hide-sm">${money(a.total)}</td><td class="num">${pct(a.share)}</td>` +
        `<td class="num hide-sm">${a.n}</td></tr>`;
    }).join("") + `</tbody>`;
  $("companies").querySelectorAll(".medbar .track").forEach((t, i) =>
    hover(t, () => statTip(D.companies[shown[i].c].name, shown[i])));
  $("companies").querySelectorAll("th.sort").forEach((t) =>
    t.onclick = () => { state.sort = t.dataset.sort; companies(); });

  const more = $("more");
  more.hidden = rows.length <= 15;
  more.textContent = state.all ? S.show_less : S.show_all.replace("{n}", rows.length);
}

// --- render -------------------------------------------------------------------
function render() {
  $("f-role").value = state.role;
  $("f-years").querySelectorAll("button").forEach((b) =>
    b.setAttribute("aria-pressed", b.dataset.v === state.years));
  const chip = $("f-region");
  chip.hidden = !state.region;
  chip.textContent = state.region ? regionName(state.region) : "";
  hideTip();
  kpis(); map(); yearsChart(); histChart(); rolesChart(); companies();
}

async function main() {
  D = await (await fetch("/api/v1/data.json")).json();
  const h = new URLSearchParams(location.hash.slice(1));
  for (const k of ["role", "region", "years"]) state[k] = h.get(k) || "";
  if (!D.cells[key()]) Object.assign(state, { role: "", region: "", years: "" });
  $("updated").textContent = S.updated.replace("{date}", D.generated);
  filters();
  render();
}
let resizing;
addEventListener("resize", () => {
  clearTimeout(resizing);
  resizing = setTimeout(() => D && (yearsChart(), histChart()), 150);
});
main();
