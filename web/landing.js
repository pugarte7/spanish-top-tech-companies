// The home page's behaviour (scripts/landing.py writes the page, whole without
// this): the mascot at work, the agent's logo swapping in the
// sentence, the three live figures, the copy button and the theme switch.
// web/mascot.js is loaded before it and draws the mascot.

const LANG = document.body.dataset.lang;
const still = matchMedia("(prefers-reduced-motion: reduce)").matches;
const grouped = (n) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, LANG === "es" ? "." : ",");
// PostHog exists only on Vercel's deployments; anywhere else nothing is sent.
const send = (event, props) => window.posthog?.capture(event, props);
const dark = () => document.documentElement.dataset.theme === "dark";

// --- mascot ---------------------------------------------------------------------
// Black on white by day, white on black by night: the page's two inks.
const style = () => ({ ...TRAZOS, ...(dark() ? { ink: "#f4f4f4", solid: "#f4f4f4", paper: "#0a0a0a" } : {}) });
const loaded = performance.now();
let stopScene = () => {};
// `enter` plays the entrance (the coast drawing itself) once, on load.
function scene(host, enter) {
  const paint = mountMascot(host, style(), document.body.dataset.mascot);
  // The pointer takes the eyes while it is over the scene; a tap makes it smile.
  let pointer = null, cheer = -1, eased = { x: 0, y: 0 };
  const fine = matchMedia("(hover: hover) and (pointer: fine)").matches;
  host.onpointermove = (e) => {
    if (!fine) return;
    const box = host.getBoundingClientRect();
    const dx = (e.clientX - box.left) / box.width * 800 - CENTER.x, dy = (e.clientY - box.top) / box.height * 500 - CENTER.y;
    const d = Math.hypot(dx, dy) || 1, pull = Math.min(1, d / 130);
    pointer = { x: dx / d * pull, y: dy / d * pull };
  };
  host.onpointerleave = () => { pointer = null; };
  host.onpointerdown = () => { cheer = performance.now(); };
  const render = (t) => {
    const at = ((t % TOTAL) + TOTAL) % TOTAL, s = stateAt(at), want = pointer || gaze(at);
    const k = pointer ? .25 : 1;
    eased = { x: eased.x + (want.x - eased.x) * k, y: eased.y + (want.y - eased.y) * k };
    if (cheer > 0 && performance.now() - cheer < 700) s.joy = true;
    paint(s, eased, SETTLED, t);
  };
  if (still) { render(.98); return () => {}; }
  let frame, visible = true;
  const watch = new IntersectionObserver(([entry]) => { visible = entry.isIntersecting; });
  watch.observe(host);
  const tick = (now) => {
    const t = (now - loaded) / 1000;
    if (!document.hidden && visible) enter && t < INTRO ? paint(stateAt(0), eased, introAt(t), t) : render(t - INTRO);
    frame = requestAnimationFrame(tick);
  };
  frame = requestAnimationFrame(tick);
  return () => { cancelAnimationFrame(frame); watch.disconnect(); };
}

function mascot(enter) {
  stopScene();
  const host = document.querySelector("[data-scene]");
  if (host) stopScene = scene(host, enter);
}

// --- the swapping logo ------------------------------------------------------------
// 3.5 s each: at 2.2 the maintainer found it changed too fast.
function rotate(el) {
  const items = [...el.children];
  let i = 0;
  setInterval(() => {
    const gone = items[i];
    gone.removeAttribute("data-on"); gone.setAttribute("data-out", "");
    setTimeout(() => gone.removeAttribute("data-out"), 340);
    i = (i + 1) % items.length;
    items[i].setAttribute("data-on", "");
  }, 3500);
}

// --- figures ------------------------------------------------------------------------
// A figure shows once it is known and rolls the digits that change after that.
function show(key, n) {
  const el = document.querySelector(`[data-stat="${key}"] b`);
  if (!el || !Number.isInteger(n)) return;
  const text = grouped(n), old = el.dataset.shown || "";
  if (text === old) return;
  el.innerHTML = [...text].map((c, k) => `<i${old && old[k] !== c ? ' class="roll"' : ""}>${c}</i>`).join("");
  el.dataset.shown = text;
}

const read = async (url) => (await fetch(url)).json();

// /api/calls is PostHog's count of tool calls. Asked once a minute with the
// other figures: every answer is an Edge Request on Vercel's bill, cached or
// not, and asking every second spent the Hobby plan's million in a month. With
// no count (no key on the deployment, PostHog down) the figure stays as it is,
// or its column is taken away.
let asking = false;
async function calls() {
  if (asking) return;   // a slow answer is not asked for twice
  asking = true;
  try { show("calls", (await read("/api/calls")).calls); } catch { /* keep what is shown */ }
  asking = false;
  const el = document.querySelector('[data-stat="calls"]');
  if (el) el.hidden = !el.querySelector("b").dataset.shown;
}

// The postings and the companies change when the job boards are read again,
// the stars when someone gives one: asked once a minute, so a page left open
// keeps up with all three.
async function slow() {
  try {
    const jobs = await read("/api/v1/jobs-summary.json");
    show("postings", jobs.postings); show("companies", jobs.companies);
  } catch { /* the index is written after the build: none on a local one */ }
  for (const key of ["postings", "companies"]) {
    const el = document.querySelector(`[data-stat="${key}"]`);
    if (el) el.hidden = !el.querySelector("b").dataset.shown;
  }
  // Until it answers the page shows the count it was built with.
  try {
    const { stars } = await read("/api/stars"), el = document.querySelector("[data-stars]");
    if (el && Number.isInteger(stars)) el.textContent = grouped(stars);
  } catch { /* keep the count shown */ }
}

function figures() {
  const all = () => { calls(); slow(); };
  all();
  setInterval(() => { if (!document.hidden) all(); }, 60000);
  // Back on the tab after a while away: up to date at once.
  document.addEventListener("visibilitychange", () => { if (!document.hidden) all(); });
}

// --- copy, theme, clicks ----------------------------------------------------------
// Only the buttons: on 2026-11-20 <body> matched too, and any click wrote "Copiado" over the page's name.
for (const button of document.querySelectorAll("button[data-copy]")) {
  button.onclick = async () => {
    try { await navigator.clipboard.writeText(button.dataset.copy); } catch { return; }
    send("copy", { what: "mcp" });
    const label = button.querySelector("span");
    label.textContent = document.body.dataset.sayCopied;
    setTimeout(() => { label.textContent = document.body.dataset.sayCopy; }, 1600);
  };
}

document.getElementById("theme").onclick = () => {
  const theme = dark() ? "light" : "dark";
  document.documentElement.dataset.theme = theme;
  try { localStorage.setItem("theme", theme); } catch { /* private mode: the choice lasts the visit */ }
  send("theme", { theme });
  mascot(false);
};

for (const link of document.querySelectorAll("[data-track]")) {
  link.addEventListener("click", () => send(link.dataset.track));
}

document.querySelectorAll("[data-rot]").forEach((el) => { if (!still) rotate(el); });
// The box in the scene is lettered in Antonio; draw once it is there.
document.fonts.load('600 20px "Antonio"').catch(() => {}).then(() => mascot(true));
figures();
