// The mascot: mainland Spain with two eyes and six arms sending CVs, drawn on a
// canvas the way a hand would, each line put down twice and redrawn eight times
// a second ("Trazos", the rendering the maintainer chose on 2026-11-20). The
// scene is a pure function of time: stateAt(t) says where everything is and
// mountMascot(host, style, label) returns the function that paints it. web/landing.js
// drives it; nothing here touches the page.
// Spain's mainland from Natural Earth 1:50m (public domain), 300 units wide; no islands, Ceuta or Melilla.
const COAST = "M175 11.7Q178 11.2 178.9 12.6L179.1 12.9Q179.9 14.3 182.8 15.1L184.3 15.5Q187.2 16.4 187 19.2L186.9 19.9Q186.7 22.7 188.1 21.8L188.4 21.6Q189.8 20.7 192.6 21.8L199.9 24.7Q202.7 25.8 204.6 27.7L205 28.2Q206.9 30.1 209.9 29.8L210.8 29.7Q213.7 29.3 216.2 31L217.5 31.9Q219.9 33.6 222.9 33.6L233 33.6Q236 33.6 236.7 31.4L236.9 30.9Q237.6 28.7 240.4 29.6L250.3 32.6Q253.2 33.5 254 36.4L254.7 38.6Q255.6 41.4 258.3 40.5L258.9 40.3Q261.7 39.4 264.2 41.1L265.9 42.2Q268.4 43.9 270.7 43L271.2 42.8Q273.5 42 276.5 42.6L281.4 43.8Q284.3 44.5 286.9 42.9L287.5 42.5Q290.1 40.9 293.1 41.2L294.7 41.3Q297.7 41.6 298.7 43.6L299 44.1Q300 46.1 298.5 46.5L298.2 46.6Q296.6 47.1 296.5 48.4L296.4 48.7Q296.3 50 297.2 52.9L297.6 54Q298.6 56.8 296.2 58.6L273.1 75.6Q270.7 77.3 267.8 78.2L248.5 83.6Q245.6 84.4 243.5 86.5L240.1 89.8Q238 91.9 239.9 93.3L240.3 93.6Q242.2 95 239.5 96.3L237.9 97.1Q235.2 98.4 233.5 100.9L214.7 130Q213.1 132.5 213.7 135.5L215.4 143.9Q216 146.8 218.2 148.9L223.6 154.2Q225.7 156.3 223.4 158.2L210.8 168.2Q208.4 170.1 207.3 172.9L202.6 184.4Q201.4 187.2 201.9 189.6L202 190.2Q202.4 192.6 199.5 192.8L192.1 193.4Q189.2 193.7 186.7 195.5L184.1 197.4Q181.7 199.1 180.3 201.8L175.9 210.2Q174.5 212.9 172.5 215.1L170.6 217Q168.6 219.2 165.8 218L165 217.7Q162.2 216.5 159.5 217.7L157 218.9Q154.2 220.1 151.2 220.1L119.5 220Q116.5 220 114.2 222L111.3 224.6Q109.1 226.6 106.2 227.3L100.1 228.6Q97.2 229.2 95.9 231.9L94 235.5Q92.7 238.2 90 239.6L89 240.2Q86.4 241.6 83.7 240.3L79.1 237.9Q76.4 236.6 75.2 233.8L72.1 226.6Q71 223.8 69.7 223.2L69.4 223.1Q68.2 222.5 67.9 221.3L67.8 221Q67.5 219.7 69.4 217.4L70.3 216.2Q72.2 213.9 70.3 215.1L69.8 215.3Q67.9 216.5 65.8 214.4L58.4 207.2Q56.2 205.2 56.5 204L56.5 203.7Q56.7 202.5 55.5 203.6L55.3 203.9Q54.1 205 51.1 205.2L46.8 205.4Q43.8 205.6 43.2 202.7L42 195.9Q41.4 192.9 42.8 190.3L45.1 185.6Q46.5 182.9 49 181.2L50.4 180.3Q52.9 178.6 53.6 176.6L53.8 176.1Q54.5 174.1 52.9 174.2L52.5 174.2Q50.9 174.3 49.3 171.8L46.9 168.2Q45.3 165.7 45.8 162.8L46.2 160.6Q46.7 157.7 48.8 155.5L50.3 153.9Q52.4 151.7 52.9 149.6L53 149.1Q53.5 147 51.6 145.9L51.2 145.7Q49.4 144.5 47.9 141.9L42.1 130.8Q40.7 128.1 43.7 127.9L47.7 127.7Q50.7 127.5 52.2 125.8L52.5 125.5Q54.1 123.8 54.8 120.9L55.2 119.8Q56 116.9 54.5 114.8L54.2 114.4Q52.7 112.3 54.8 110.2L55.9 109Q58 106.8 57.6 103.9L55.6 89Q55.2 86 57.3 83.9L70 71Q72.1 68.8 71.2 67.7L71 67.4Q70 66.3 67.5 65.8L66.9 65.7Q64.4 65.3 63.8 62.4L63.2 59.8Q62.6 56.9 59.6 56.6L52.9 56Q50 55.7 47.6 57.5L46.2 58.5Q43.8 60.3 40.8 59.9L34.4 59.1Q31.4 58.7 29 59.7L28.4 60Q25.9 61 25.1 59.8L25 59.5Q24.2 58.3 25.2 56.6L25.4 56.2Q26.4 54.5 25 52.9L24.7 52.5Q23.2 50.8 20.5 52.1L11.9 56.1Q9.2 57.4 8.8 54.9L8.7 54.3Q8.3 51.8 10.3 49.6L11 48.8Q13 46.5 11.7 46.4L11.4 46.3Q10 46.2 11 44.4L11.2 44Q12.1 42.2 11.2 41.4L11 41.2Q10.1 40.4 10.1 38L10.1 37.5Q10.1 35.1 7.8 35.8L7.2 35.9Q4.8 36.6 5.9 33.8L6.3 33Q7.4 30.2 5 28.4L2.4 26.4Q0 24.6 0.6 21.8L0.8 21.2Q1.4 18.4 3.8 16.7L6.2 15.1Q8.7 13.4 11.6 13L18.1 11.9Q21.1 11.5 22.2 10.9L22.5 10.8Q23.6 10.2 23.5 8.2L23.5 7.7Q23.4 5.8 26.2 4.6L34 1.2Q36.8 0 39.5 1.2L49.3 5.4Q52 6.6 55 6.3L78.1 4Q81.1 3.7 84 4.4L109.8 10.2Q112.7 10.9 115.7 10.5L131.7 8.1Q134.7 7.7 137.5 8.6L145.2 11.3Q148.1 12.3 149.9 11.1L150.3 10.8Q152.1 9.7 155 10.6L162.1 12.8Q165 13.6 168 13.1Z";

// ---------- the scene: a pure function of time, so a recorder can step it ----------
const TOTAL = 8.4, INTRO = 1.3, N = 6, STEP = .85;
const GROUND = 470, STACK_X = 400, CENTER = { x: 400, y: 228 }, FACE = { x: 132, y: 112 }, SCALE = .74;
const POP = 6.25, POP_DELAY = [0, .12, .22, .30, .37, .43], POP_TIME = .38;
const BLINKS = [1.6, 4.1, 7.85], ORDER = [0, 4, 2, 3, 1, 5], BOX_ARM = 2, CHEER_ARM = 5;


function bezier(x1, y1, x2, y2) {
  return (u) => {
    if (u <= 0) return 0;
    if (u >= 1) return 1;
    let lo = 0, hi = 1, s = .5;
    for (let i = 0; i < 22; i++) {
      s = (lo + hi) / 2;
      (3 * (1 - s) * (1 - s) * s * x1 + 3 * (1 - s) * s * s * x2 + s * s * s < u) ? lo = s : hi = s;
    }
    return 3 * (1 - s) * (1 - s) * s * y1 + 3 * (1 - s) * s * s * y2 + s * s * s;
  };
}
const EASE = { out: bezier(.23, 1, .32, 1), inOut: bezier(.77, 0, .175, 1), linear: (u) => u, back: bezier(.34, 1.56, .64, 1), inQuad: (u) => u * u };
const mix = (a, b, k) => typeof a === "number" ? a + (b - a) * k : { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k };
const clamp01 = (u) => Math.max(0, Math.min(1, u));
const span = (t, a, b) => clamp01((t - a) / (b - a));
const pulse = (t, a, b) => t > a && t < b ? Math.sin((t - a) / (b - a) * Math.PI) : 0;
function track(keys) {
  return (t) => {
    if (t <= keys[0].t) return keys[0].v;
    for (let i = 1; i < keys.length; i++) {
      if (t <= keys[i].t) {
        const a = keys[i - 1], b = keys[i];
        return mix(a.v, b.v, (b.e || EASE.linear)(span(t, a.t, b.t)));
      }
    }
    return keys[keys.length - 1].v;
  };
}

// An arm: where it leaves from behind the body, where its hand idles, and the point it delivers to.
const pair = (ax, ay, rx, ry, gx, gy) => [
  { a: { x: ax, y: ay }, r: { x: rx, y: ry }, g: { x: gx, y: gy }, side: 1 },
  { a: { x: 800 - ax, y: ay }, r: { x: 800 - rx, y: ry }, g: { x: 800 - gx, y: gy }, side: -1 },
];
const PAIRS = [pair(366, 208, 270, 160, 150, 82), pair(360, 236, 252, 250, 90, 232), pair(370, 262, 284, 340, 122, 352)];
const ARMS = [...PAIRS.map((p) => p[0]), ...PAIRS.map((p) => p[1])];

const slab = (j) => ({ x: STACK_X, y: GROUND - 5 - j * 7.5 });
const handle = (boxX) => ({ x: boxX + 28, y: GROUND - 54 });
function releasePoint(a) {
  const d = Math.hypot(a.g.x - a.a.x, a.g.y - a.a.y), reach = Math.min(185, d - 55);
  return { x: a.a.x + (a.g.x - a.a.x) / d * reach, y: a.a.y + (a.g.y - a.a.y) / d * reach };
}

const TL = (() => {
  const move = EASE.inOut;
  const boxX = track([
    { t: 4.85, v: -90 }, { t: 5.4, v: 205, e: EASE.out }, { t: 5.55, v: 205 }, { t: 6.0, v: 300, e: EASE.inOut },
    { t: 7.2, v: 300 }, { t: 7.5, v: 205, e: EASE.inQuad }, { t: 7.82, v: -90 },
  ]);
  const lid = track([{ t: 6.0, v: 0 }, { t: 6.2, v: 1, e: EASE.back }, { t: 7.0, v: 1 }, { t: 7.2, v: 0, e: EASE.out }]);
  const hand = ARMS.map((a) => [{ t: 0, v: a.r }]);
  for (let i = 0; i < N; i++) {
    const k = ORDER[i], a = ARMS[k], s = i * STEP, at = slab(N - 1 - i), pick = { x: at.x - a.side * 8, y: at.y - 20 }, rel = releasePoint(a);
    // A small wind-up away from the target before the throw, and a follow-through after it.
    const wind = { x: rel.x + (a.a.x - rel.x) * .14, y: rel.y + (a.a.y - rel.y) * .14 }, past = { x: rel.x + (a.g.x - rel.x) * .12, y: rel.y + (a.g.y - rel.y) * .12 };
    hand[k].push({ t: s, v: a.r }, { t: s + .4, v: pick, e: move }, { t: s + .52, v: pick }, { t: s + .96, v: wind, e: move }, { t: s + 1.05, v: rel, e: EASE.out },
      { t: s + 1.16, v: past, e: EASE.out }, { t: s + 1.6, v: a.r, e: move });
  }
  const b = BOX_ARM, c = CHEER_ARM, up = { x: ARMS[c].r.x + 26, y: 138 };
  hand[b].push({ t: 5.1, v: ARMS[b].r }, { t: 5.55, v: handle(205), e: move }, { t: 7.5, v: handle(205) }, { t: 8.0, v: ARMS[b].r, e: move });
  hand[c].push({ t: 6.1, v: ARMS[c].r }, { t: 6.45, v: up, e: EASE.back }, { t: 6.95, v: up }, { t: 7.4, v: ARMS[c].r, e: move });
  const handAt = hand.map((keys) => track([...keys, { t: TOTAL, v: keys[0].v }]));
  const boxHand = handAt[b];
  handAt[b] = (t) => (t >= 5.55 && t <= 7.5) ? handle(boxX(t)) : boxHand(t);
  return { boxX, lid, hand: handAt };
})();

function stateAt(t) {
  const bob = Math.sin(t / 2.1 * 2 * Math.PI) * 3;
  const arms = ARMS.map((a, i) => {
    let h = TL.hand[i](t);
    // An idle hand drifts a little, so six arms at rest still look alive.
    const idle = clamp01(1 - Math.hypot(h.x - a.r.x, h.y - a.r.y) / 30), phase = t / TOTAL * 2 * Math.PI * 3 + i * 1.7;
    h = { x: h.x + Math.cos(phase) * 5 * idle, y: h.y + Math.sin(phase) * 6 * idle + bob * idle };
    return { anchor: { x: a.a.x, y: a.a.y + bob }, hand: h, side: a.side };
  });
  // The cheering hand waves while it is up.
  if (t > 6.45 && t < 6.95) arms[CHEER_ARM].hand.x += Math.sin((t - 6.45) * 4 * Math.PI) * 9;
  const boxX = TL.boxX(t);
  let focus = null;
  const papers = [], trails = [];
  for (let i = 0; i < N; i++) {
    const k = ORDER[i], a = ARMS[k], s = i * STEP, home = slab(N - 1 - i), h = arms[k].hand;
    const toward = Math.atan2(h.y - a.a.y, h.x - a.a.x), held = { x: h.x + Math.cos(toward) * 20, y: h.y + Math.sin(toward) * 20 };
    let p;
    if (t < s + .45) p = { ...home, flat: 1, o: 1, rot: 0, k: 1 };
    else if (t < s + 1.05) {
      const grab = EASE.out(span(t, s + .45, s + .56)), open = EASE.out(span(t, s + .52, s + .86));
      p = { ...mix(home, held, grab), flat: 1 - open, o: 1, rot: -a.side * 9 * open, k: 1 };
    } else if (t < s + 1.6) {
      const rel = releasePoint(a), gd = Math.hypot(a.g.x - rel.x, a.g.y - rel.y), dir = { x: (a.g.x - rel.x) / gd, y: (a.g.y - rel.y) / gd };
      const u = span(t, s + 1.05, s + 1.5), go = EASE.out(u);
      p = { ...mix({ x: rel.x + dir.x * 20, y: rel.y + dir.y * 20 }, a.g, go), flat: 0, o: 1 - span(t, s + 1.42, s + 1.6), rot: -a.side * 9 * (1 - go), k: 1 - .45 * go };
      trails.push({ x: p.x, y: p.y, angle: Math.atan2(dir.y, dir.x) * 180 / Math.PI, o: Math.sin(u * Math.PI) * (1 - u) * 2 });
    } else {
      const start = POP + POP_DELAY[N - 1 - i], u = span(t, start, start + POP_TIME);
      if (t < start) p = { ...home, flat: 1, o: 0, rot: 0, k: 1 };
      else {
        const at = mix({ x: boxX, y: GROUND - 50 }, home, u);
        p = { x: at.x, y: at.y - Math.sin(u * Math.PI) * 70, flat: .35 + .65 * EASE.out(u), o: span(u, 0, .18), rot: (1 - u) * -24, k: 1 };
      }
    }
    if (t >= s + .1 && t < s + 1.45) focus = p;
    papers.push(p);
  }
  if (t >= 4.9 && t < POP) focus = { x: boxX, y: GROUND - 35 };
  if (t >= POP && t < 7.2) focus = slab(3);
  let sent = 0;
  const targets = ARMS.map((a, k) => {
    const u = t - (ORDER.indexOf(k) * STEP + 1.45);
    if (u >= 0) sent++;
    return { bump: pulse(u, 0, .32), check: u < 0 ? 0 : EASE.out(span(u, 0, .18)) * (1 - span(u, 1.3, 1.7)), spark: u >= 0 && u < .4 ? u / .4 : -1 };
  });
  let blink = 0;
  for (const b of BLINKS) if (t >= b && t < b + .16) blink = Math.sin((t - b) / .16 * Math.PI);
  return {
    bob, arms, papers, trails, focus, targets, blink, sent, joy: t >= POP + .1 && t < 7.2,
    // The box lands with a little squash and a puff of dust, and its flaps overshoot when they open.
    box: { x: boxX, lid: TL.lid(t), squash: pulse(t, 5.38, 5.62), puff: t >= 5.36 && t < 5.9 ? (t - 5.36) / .54 : -1 },
    // The pile dips when a hand presses on it and when a sheet lands.
    press: Math.max(...ORDER.map((_, i) => pulse(t, i * STEP + .38, i * STEP + .56))),
  };
}
// The eyes trail what they follow instead of snapping to it, and the body leans the same way.
function gaze(t) {
  let x = 0, y = 0;
  for (const back of [0, .07, .14]) {
    const f = stateAt(Math.max(0, t - back)).focus;
    if (!f) continue;
    const dx = f.x - CENTER.x, dy = f.y - CENTER.y, d = Math.hypot(dx, dy) || 1, pull = Math.min(1, d / 130);
    x += dx / d * pull / 3; y += dy / d * pull / 3;
  }
  return { x, y };
}
// The entrance, once: the coast draws itself, the eyes open, the arms unfurl from behind, the props fade in.
const introAt = (t) => ({ line: EASE.inOut(span(t, 0, .85)), eyes: EASE.out(span(t, .6, .85)), arms: EASE.out(span(t, .75, INTRO)), props: span(t, .85, INTRO) });
const SETTLED = { line: 1, eyes: 1, arms: 1, props: 1 };

// ---------- drawing ----------
// Trazos: every line twice, freehand, redrawn `fps` times a second. A caller
// swaps ink, solid and paper for the page's dark theme.
const TRAZOS = { passes: 2, jitter: 2.3, width: .62, ink: "#000", solid: "#000", paper: "#fff", hatch: 8, fps: 8 };

const P = (x, y) => ({ x, y });
const circle = (cx, cy, rx, ry = rx, n = 22) => Array.from({ length: n }, (_, i) => P(cx + Math.cos(i / n * 6.2832) * rx, cy + Math.sin(i / n * 6.2832) * ry));
const seg = (a, b, n = 4) => Array.from({ length: n + 1 }, (_, i) => mix(a, b, i / n));
const ring = (corners, n = 3) => corners.flatMap((c, i) => seg(c, corners[(i + 1) % corners.length], n).slice(0, -1));
const curve = (a, c, b, n = 16) => Array.from({ length: n + 1 }, (_, i) => { const u = i / n, v = 1 - u; return P(v * v * a.x + 2 * v * u * c.x + u * u * b.x, v * v * a.y + 2 * v * u * c.y + u * u * b.y); });
const place = (pts, x, y, deg = 0, sx = 1, sy = sx) => { const c = Math.cos(deg * Math.PI / 180), s = Math.sin(deg * Math.PI / 180); return pts.map((p) => P(x + p.x * sx * c - p.y * sy * s, y + p.x * sx * s + p.y * sy * c)); };
const box4 = (x0, y0, x1, y1) => [P(x0, y0), P(x1, y0), P(x1, y1), P(x0, y1)];
function rng(seed) {
  let a = seed | 0;
  return () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
// The coast as points, so a pen can wobble it and the entrance can draw part of it.
const COAST_PTS = (() => {
  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  path.setAttribute("d", COAST);
  const length = path.getTotalLength(), n = 260;
  return Array.from({ length: n }, (_, i) => { const q = path.getPointAtLength(i / n * length); return P(q.x, q.y); });
})();

function makePen(ctx, st, seed) {
  let count = 0;
  const trace = (pts, closed, rnd, amp) => {
    const n = pts.length, a = rnd() * 6.28, b = rnd() * 6.28, f = .35 + rnd() * .25, ox = (rnd() - .5) * amp, oy = (rnd() - .5) * amp;
    ctx.beginPath();
    for (let i = 0; i <= (closed ? n : n - 1); i++) {
      const p = pts[i % n], x = p.x + ox + Math.sin(i * f + a) * amp * .6, y = p.y + oy + Math.cos(i * f * 1.3 + b) * amp * .6;
      i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
    }
  };
  const pen = {
    fill(pts, color) { trace(pts, true, () => .5, 0); ctx.fillStyle = color; ctx.fill(); },
    line(pts, w, o = {}) {
      if (pts.length < 2) return;
      ctx.lineCap = "round"; ctx.lineJoin = "round"; ctx.strokeStyle = o.color || st.ink;
      for (let pass = 0; pass < st.passes; pass++) {
        trace(pts, o.closed, rng(seed * 7919 + count * 104729 + pass * 31), st.jitter * (o.calm || 1));
        ctx.lineWidth = Math.max(.7, w * st.width * (pass ? .85 : 1));
        ctx.stroke();
      }
      count++;
    },
    shape(pts, w, fill = st.paper) { pen.fill(pts, fill); pen.line(pts, w, { closed: true }); },
    // Shadow: hatching, clipped to the shape.
    shade(pts, also) {
      ctx.save();
      trace(pts, true, () => .5, 0); ctx.clip();
      if (also) also();
      const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y), x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys), h = y1 - y0;
      for (let c = x0 - h; c < x1; c += st.hatch) pen.line([P(c, y1), P(c + h, y0)], 1.7, { calm: .5 });
      ctx.restore();
    },
  };
  return pen;
}

const STACK_SHIFT = [0, 3, -2, 2, -3, 1];
function drawScene(ctx, st, s, look, intro, seed) {
  const pen = makePen(ctx, st, seed), k = SCALE, ox = CENTER.x - 140 * k, oy = CENTER.y - 126 * k;
  const stretch = 1 + s.bob / 3 * .012, lean = look.x * 2.2 * Math.PI / 180, cl = Math.cos(lean), sl = Math.sin(lean);
  // Body space to the scene: scale, breathe, lean, bob.
  const body = (p) => {
    const x = 400 + (ox + p.x * k - 400) * (2 - stretch) - 400, y = 300 + (oy + p.y * k - 300) * stretch - 300;
    return P(400 + x * cl - y * sl, 300 + x * sl + y * cl + s.bob);
  };
  ctx.lineCap = "round";

  // --- floor, the mascot's shadow on it ---
  ctx.globalAlpha = intro.props;
  pen.shade(circle(400, GROUND + 6, 128 - s.bob * 3, 9, 26));
  pen.line(seg(P(60, GROUND + 2), P(740, GROUND + 2), 12), 3);

  // --- letterboxes the CVs go into; the flag goes up when one lands ---
  s.targets.forEach((g, i) => {
    const at = ARMS[i].g, z = 1 + g.bump * .18, put = (pts) => place(pts, at.x, at.y, 0, z);
    if (g.spark >= 0) {
      ctx.globalAlpha = intro.props * (1 - g.spark);
      for (let a = 0; a < 8; a++) { const c = Math.cos(a * Math.PI / 4), n = Math.sin(a * Math.PI / 4), r0 = 30 + g.spark * 12; pen.line([P(at.x + c * r0, at.y + n * r0), P(at.x + c * (r0 + 8), at.y + n * (r0 + 8))], 3.2); }
      ctx.globalAlpha = intro.props;
    }
    pen.shape(put([P(-19, -10), P(-10, -19), P(23, -19), P(14, -10)]), 3.6);
    const side = put([P(14, -10), P(23, -19), P(23, 6), P(14, 15)]);
    pen.fill(side, st.paper); pen.shade(side); pen.line(side, 3.6, { closed: true });
    pen.shape(put(ring(box4(-19, -10, 14, 15), 2)), 3.6);
    pen.line(put([P(-13, -2), P(8, -2)]), 3.4);
    if (g.check > .05) {
      const flag = (pts) => place(pts, at.x + 25 * z, at.y + 2 * z, 0, z, z * g.check);
      pen.line(flag([P(0, 0), P(0, -24)]), 3.2);
      pen.fill(flag(box4(0, -24, 11, -15)), st.solid);
    }
  });

  // --- the box: a carton seen from the front-left, with a taped lid that opens into two flaps ---
  const b = s.box, sx = 1 + b.squash * .07, sy = 1 - b.squash * .1, bx = (pts) => place(pts, b.x, GROUND, 0, sx, sy);
  if (b.x > -80) {
    if (b.puff >= 0) {
      ctx.globalAlpha = intro.props * (1 - b.puff);
      const grow = 1 + b.puff * .6;
      for (const d of [-1, 1]) { pen.line(curve(P(b.x + d * 46 * grow, GROUND - 4), P(b.x + d * 58 * grow, GROUND - 6), P(b.x + d * 62 * grow, GROUND - 16 * grow), 6), 3); pen.line([P(b.x + d * 54 * grow, GROUND - 1), P(b.x + d * 68 * grow, GROUND - 1)], 3); }
      ctx.globalAlpha = intro.props;
    }
    pen.shade(bx([P(-44, 4), P(60, 4), P(72, -4), P(40, -4)]));
    const side = bx([P(36, -50), P(50, -61), P(50, -11), P(36, 0)]), top = bx([P(-36, -50), P(-22, -61), P(50, -61), P(36, -50)]);
    pen.fill(side, st.paper); pen.shade(side); pen.line(side, 4.4, { closed: true });
    pen.fill(top, st.paper);
    if (b.lid > .05) { pen.shade(top); pen.shade(top); }
    pen.line(top, 4.4, { closed: true });
    pen.shape(bx(ring(box4(-36, -50, 36, 0), 3)), 4.6);
    const phi = b.lid * 150 * Math.PI / 180, vx = Math.cos(phi) * 34, vy = -Math.sin(phi) * 30;
    if (b.lid > .05) {
      pen.shape(bx([P(36, -50), P(50, -61), P(50 - vx, -61 + vy), P(36 - vx, -50 + vy)]), 4);
      pen.shape(bx([P(-36, -50), P(-22, -61), P(-22 + vx, -61 + vy), P(-36 + vx, -50 + vy)]), 4);
    } else pen.line(bx([P(14, -61), P(0, -50), P(0, -38)]), 3);
    ctx.save();
    ctx.translate(b.x, GROUND); ctx.scale(sx, sy);
    ctx.fillStyle = st.solid; ctx.textAlign = "center"; ctx.font = '600 20px Antonio, "Arial Narrow", sans-serif';
    ctx.fillText("CV", 0, -13);
    ctx.restore();
  }
  ctx.globalAlpha = 1;

  // --- arms, from behind ---
  const hands = s.arms.map((a) => {
    const h = mix(a.anchor, a.hand, intro.arms), dx = h.x - a.anchor.x, dy = h.y - a.anchor.y, len = Math.hypot(dx, dy) || 1, bow = (16 + len * .13) * a.side;
    if (intro.arms > .02) pen.line(curve(a.anchor, P(a.anchor.x + dx / 2 - dy / len * bow, a.anchor.y + dy / 2 + dx / len * bow), h), 7);
    return h;
  });

  // --- body: a paper-coloured gap around it so the arms read as behind, a shadow down the south-east, the coast ---
  const coast = COAST_PTS.map(body), filled = clamp01(intro.line * 2 - 1);
  ctx.globalAlpha = filled;
  ctx.lineJoin = "round"; ctx.strokeStyle = st.paper; ctx.lineWidth = 18;
  ctx.beginPath(); coast.forEach((p, i) => i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)); ctx.closePath(); ctx.stroke();
  pen.fill(coast, st.paper);
  pen.shade(coast, () => {
    ctx.beginPath(); ctx.rect(0, 0, 800, 500);
    coast.forEach((p, i) => i ? ctx.lineTo(p.x - 15, p.y - 12) : ctx.moveTo(p.x - 15, p.y - 12));
    ctx.closePath(); ctx.clip("evenodd");
  });
  ctx.globalAlpha = 1;
  const shown = Math.round(coast.length * intro.line);
  if (shown >= coast.length) pen.line(coast, 6.5, { closed: true }); else pen.line(coast.slice(0, shown), 6.5);

  // --- two eyes: the dark oval, a big shine and a small one ---
  if (intro.eyes > 0) {
    ctx.globalAlpha = intro.eyes;
    const z = .9 + .1 * intro.eyes, lx = look.x * 6, ly = look.y * 6, open = 1 - s.blink * .92;
    for (const side of [-1, 1]) {
      const cx = FACE.x + side * 30 * z + lx, cy = FACE.y + ly;
      if (s.joy) { pen.line(curve(P(cx - 17, cy + 8), P(cx, cy - 22), P(cx + 17, cy + 8), 10).map(body), 6.6, { color: st.solid }); continue; }
      pen.fill(circle(cx, cy, 20 * z, 30 * z * open, 26).map(body), st.solid);
      if (open > .5) {
        pen.fill(circle(cx + 6 + look.x * 3, cy - 12 + look.y * 3, 7, 7 * open, 14).map(body), st.paper);
      }
    }
    ctx.globalAlpha = 1;
  }

  // --- the pile, the sheets in the air and the lines they leave behind ---
  s.trails.forEach((tr) => {
    ctx.globalAlpha = clamp01(tr.o) * intro.props;
    for (const [y, x0, x1] of [[-9, -24, -38], [0, -28, -48], [9, -24, -36]]) pen.line(place([P(x0, y), P(x1, y)], tr.x, tr.y, tr.angle), 3.2);
  });
  const lying = s.papers.map((p, i) => ({ p, i })).filter(({ p }) => p.o > 0 && p.flat > .7);
  const top = lying.reduce((best, c) => !best || c.p.y < best.p.y ? c : best, null);
  s.papers.forEach((p, i) => {
    if (p.o <= 0) return;
    ctx.globalAlpha = p.o * intro.props;
    if (p.flat > .7) {
      const x = p.x + STACK_SHIFT[i], y = p.y + s.press * 2;
      if (top && top.i === i) pen.shape(place([P(-28, -3), P(-18, -10), P(38, -10), P(28, -3)], x, y, p.rot, p.k), 2.6);
      pen.shape(place(ring(box4(-28, -3, 28, 3), 2), x, y, p.rot, p.k), 2.8);
      return;
    }
    const sxp = p.k * (1 + p.flat * .5), syp = p.k * (1 - p.flat * .9), put = (pts) => place(pts, p.x, p.y, p.rot, sxp, syp);
    pen.shape(put(ring([P(-17, -22), P(9, -22), P(17, -14), P(17, 22), P(-17, 22)], 2)), 3.8);
    if (p.flat < .45) {
      pen.line(put([P(9, -22), P(9, -14), P(17, -14)]), 2.2);
      pen.fill(put(box4(-11, -16, -3, -7)), st.solid);
      for (const [y, x0, x1] of [[-14, 0, 6], [-9, 0, 9], [0, -11, 11], [6, -11, 11], [12, -11, i % 2 ? 3 : 8]]) pen.line(put([P(x0, y), P(x1, y)]), 2.3);
    }
  });
  ctx.globalAlpha = 1;

  // --- hands: a ball with a little shadow inside ---
  hands.forEach((h) => {
    if (intro.arms <= .15) return;
    const ball = circle(h.x, h.y, 9.5, 9.5, 16);
    pen.fill(ball, st.paper);
    pen.line(curve(P(h.x + 5.5, h.y - 2), P(h.x + 5, h.y + 5), P(h.x - 2, h.y + 5.5), 5), 2, { calm: .4 });
    pen.line(ball, 4.2, { closed: true });
  });
}

// Puts the scene's canvas in `host` and returns paint(state, look, intro, t).
function mountMascot(host, st, label) {
  const canvas = document.createElement("canvas"), w = 1600, h = 1000;
  canvas.width = w; canvas.height = h;
  canvas.setAttribute("role", "img"); canvas.setAttribute("aria-label", label);
  host.replaceChildren(canvas);
  const ctx = canvas.getContext("2d");
  return (s, look, intro, t) => {
    ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalAlpha = 1; ctx.fillStyle = st.paper; ctx.fillRect(0, 0, w, h);
    ctx.setTransform(w / 800, 0, 0, h / 500, 0, 0);
    drawScene(ctx, st, s, look, intro, st.jitter ? Math.floor(t * st.fps) + 1 : 0);
  };
}
