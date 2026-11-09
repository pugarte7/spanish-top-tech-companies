// Draws the README's "apply with your agent" flow, docs/img/apply-flow.{es,en}.svg,
// in Excalidraw's style: rough.js strokes (Excalidraw's renderer) and
// Excalifont (OFL), embedded so GitHub's <img> shows it.
//
//     node scripts/readme_flow.mjs excalifont.woff2 [docs/img]
//
// The font is Excalifont's Latin file from @excalidraw/excalidraw
// (dist/prod/fonts/Excalifont), cut to the letters used here:
//     pyftsubset Excalifont-Regular-<hash>.woff2 --flavor=woff2 \
//       --text="<every string below, plus a-z A-Z 0-9 .,+>" --output-file=excalifont.woff2
import { readFileSync, writeFileSync } from "node:fs";
import rough from "roughjs";

const [fontFile, out = "docs/img"] = process.argv.slice(2);
const FONT = readFileSync(fontFile).toString("base64");

const TEXT = {
  es: {
    b0: ["Más de 400 portales", "1.000+ ofertas al día"],
    b1: ["Tu CV y", "lo que buscas"],
    b2: ["find_jobs", "ofertas con el", "sueldo de la empresa"],
    b3: ["job_questions", "el formulario", "de la oferta"],
    b4: ["El agente escribe", "la carta y", "las respuestas"],
    d: ["¿Das", "el sí?"],
    b5: ["La envía con", "su navegador"],
    b6: ["report_application", "enviada, fallida", "o en tus manos"],
    yes: "sí", no: "no", next: ["pasa a la", "siguiente oferta"],
  },
  en: {
    b0: ["400+ job boards", "1,000+ postings a day"],
    b1: ["Your CV and", "what you want"],
    b2: ["find_jobs", "postings with the", "company's salary"],
    b3: ["job_questions", "the posting's", "application form"],
    b4: ["The agent writes", "the cover letter", "and the answers"],
    d: ["You say", "yes?"],
    b5: ["It sends it with", "its own browser"],
    b6: ["report_application", "sent, failed or", "handed to you"],
    yes: "yes", no: "no", next: ["it moves on to", "the next posting"],
  },
};

// Excalidraw's palette on its own white card, like an Excalidraw export: one
// image that reads the same on a light or a dark page. A <picture> with a dark
// variant follows the viewer's system theme, not the page's, and showed light
// text on a white README.
const C = { paper: "#ffffff", ink: "#1e1e1e", tool: "#0c4a86", note: "#495057",
            you: "#ffec99", boards: "#ffd8a8", tool_fill: "#a5d8ff", agent: "#d0bfff", ask: "#ffc9c9", sent: "#b2f2bb" };

const W = 960, H = 600, BW = 205, BH = 112, GAP = 33, X0 = 20, Y0 = 20, Y1 = 190, Y2 = 400;
const col = (i) => X0 + i * (BW + GAP);

function draw(lang) {
  const t = TEXT[lang], c = C;
  const gen = rough.generator();
  let seed = 7;
  const opts = (extra = {}) => ({ seed: seed++, roughness: 1, bowing: 1, stroke: c.ink, strokeWidth: 2,
                                  fillStyle: "solid", ...extra });
  const parts = [];
  const shape = (d) => {
    for (const p of gen.toPaths(d)) {
      parts.push(`<path d="${p.d.replace(/-?\d+\.\d+/g, (n) => (+n).toFixed(1))}" stroke="${p.stroke}" stroke-width="${p.strokeWidth}" fill="${p.fill ?? "none"}" stroke-linecap="round" stroke-linejoin="round"/>`);
    }
  };
  // Solid fills, not hachure: hatching under the letters made them hard to read.
  const text = (x, y, lines, { size = 18, first = null, color = c.ink } = {}) => {
    const lh = size * 1.25, top = y - ((lines.length - 1) * lh) / 2;
    lines.forEach((line, i) => {
      const isTool = i === 0 && first;
      const s = isTool ? 17 : size;
      const fill = isTool ? first : color;
      parts.push(`<text x="${x}" y="${(top + i * lh).toFixed(1)}" font-size="${s}" fill="${fill}" text-anchor="middle" dominant-baseline="central">${line.replace(/&/g, "&amp;").replace(/</g, "&lt;")}</text>`);
    });
  };
  const box = (x, y, fill, lines, tool = false) => {
    const r = 18, w = BW, h = BH;
    const d = `M ${x + r} ${y} L ${x + w - r} ${y} Q ${x + w} ${y} ${x + w} ${y + r} L ${x + w} ${y + h - r} ` +
              `Q ${x + w} ${y + h} ${x + w - r} ${y + h} L ${x + r} ${y + h} Q ${x} ${y + h} ${x} ${y + h - r} ` +
              `L ${x} ${y + r} Q ${x} ${y} ${x + r} ${y}`;
    shape(gen.path(d, opts({ fill })));
    text(x + w / 2, y + h / 2, lines, { first: tool ? c.tool : null });
  };
  const arrow = (pts, label = null, at = null) => {
    shape(pts.length === 2 ? gen.line(...pts[0], ...pts[1], opts()) : gen.curve(pts, opts()));
    const [a, b] = pts.slice(-2), ang = Math.atan2(b[1] - a[1], b[0] - a[0]), L = 16, S = 0.45;
    for (const s of [S, -S]) {
      shape(gen.line(b[0], b[1], b[0] - L * Math.cos(ang + s), b[1] - L * Math.sin(ang + s), opts()));
    }
    if (label) text(at[0], at[1], [label], { size: 18, color: c.note });
  };

  // Where the postings come from, every day, above the tool that searches them.
  box(col(1), Y0, c.boards, t.b0);
  arrow([[col(1) + BW / 2, Y0 + BH + 4], [col(1) + BW / 2, Y1 - 6]]);
  box(col(0), Y1, c.you, t.b1);
  box(col(1), Y1, c.tool_fill, t.b2, true);
  box(col(2), Y1, c.tool_fill, t.b3, true);
  box(col(3), Y1, c.agent, t.b4);
  for (let i = 0; i < 3; i++) arrow([[col(i) + BW + 4, Y1 + BH / 2], [col(i + 1) - 6, Y1 + BH / 2]]);

  // The question, under the agent's draft.
  const cx = col(3) + BW / 2, cy = Y2 + BH / 2, dw = 92, dh = 64;
  arrow([[cx, Y1 + BH + 6], [cx, cy - dh - 6]]);
  shape(gen.polygon([[cx, cy - dh], [cx + dw, cy], [cx, cy + dh], [cx - dw, cy]], opts({ fill: c.ask })));
  text(cx, cy, t.d);

  box(col(2), Y2, c.sent, t.b5);
  box(col(1), Y2, c.tool_fill, t.b6, true);
  arrow([[cx - dw - 4, cy], [col(2) + BW + 6, cy]], t.yes, [(cx - dw + col(2) + BW) / 2, cy - 18]);
  arrow([[col(2) - 4, cy], [col(1) + BW + 6, cy]]);

  arrow([[cx, cy + dh + 4], [cx, H - 58]], t.no, [cx - 22, cy + dh + 20]);
  text(cx, H - 32, t.next, { size: 18, color: c.note });

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">
<rect width="${W}" height="${H}" rx="16" fill="${c.paper}"/>
<style>@font-face{font-family:Excalifont;src:url(data:font/woff2;base64,${FONT}) format("woff2")}text{font-family:Excalifont,"Comic Sans MS",cursive}</style>
${parts.join("\n")}
</svg>
`;
}

for (const lang of Object.keys(TEXT)) writeFileSync(`${out}/apply-flow.${lang}.svg`, draw(lang));
