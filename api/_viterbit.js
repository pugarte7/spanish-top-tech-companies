// Viterbit careers sites (Capitole, Prosegur, Tracasa): the application page,
// /<posting>/apply/, is a server-rendered form, the employer's own questions
// included. Cloudflare turns the MCP's address away there, so scripts/jobs.mjs
// reads each form in the daily crawl, through the cloud browser, and stores
// what this returns in jobs.json; api/mcp.js serves it from there.

const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
const decode = (s) => String(s ?? "")
  .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
  .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
  .replace(/&([a-z]+);/gi, (m, name) => ENTITIES[name.toLowerCase()] ?? m);
const text = (html) => decode(String(html).replace(/<(script|style|svg)\b[\s\S]*?<\/\1>/gi, " ")
  .replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();

/** The application page of a Viterbit posting. */
export const viterbitApplyUrl = (url) => new URL("apply/", String(url).replace(/\/?$/, "/")).href;

/** True for a page Viterbit serves. */
export const isViterbit = (page) => /assets\.viterbit\.com/.test(page);

const TYPES = { text: "text", email: "email", tel: "phone", file: "file", checkbox: "checkbox", radio: "select",
                select: "select", textarea: "textarea" };
/** Lists longer than this (the country picker) are left to the browser. */
const MAX_OPTIONS = 60;
/** Fields Viterbit keeps hidden or fills itself. */
const SKIP = /^(socialProfiles|_token|company)$/;

/**
 * The fields of a Viterbit application page, in order, as
 * `{ key, label, required, type, options, preselected?, consent? }`, or null
 * when the page has no application form (the posting closed). A radio group
 * comes with its first option already chosen (`preselected`).
 */
export function viterbitFields(page) {
  const start = page.indexOf('<form name="apply"');
  if (start < 0) return null;
  const end = page.indexOf("</form>", start);
  const form = page.slice(start, end < 0 ? undefined : end);
  // A field's label: the last whole <label> before its control that wraps no
  // control itself (a radio's option label does).
  const labels = [...form.matchAll(/<label\b[^>]*>([\s\S]*?)<\/label>/g)]
    .filter((m) => !/<(input|select|textarea)\b/.test(m[1]) && text(m[1]))
    .map((m) => ({ end: m.index + m[0].length, text: text(m[1]) }));
  const labelBefore = (at) => labels.filter((l) => l.end <= at).at(-1)?.text ?? "";
  const fields = new Map();
  for (const c of form.matchAll(/<(input|select|textarea)\b([^>]*)>/g)) {
    const attrs = c[2];
    const kind = c[1] === "input" ? /\btype="([a-z]+)"/.exec(attrs)?.[1] ?? "text" : c[1];
    const name = /\bname="apply\[([^\]]+)\](?:\[([^\]]+)\])?/.exec(attrs);
    if (kind === "hidden" || /\bhidden="hidden"/.test(attrs) || !name || SKIP.test(name[1])) continue;
    const key = name[1] === "questions" ? `question_${name[2]}`
      : name[2] && name[2] !== "file" ? `${name[1]}_${name[2]}` : name[1];
    // What follows the control up to the next tag: a radio's option, the notice of a checkbox.
    const after = form.slice(c.index + c[0].length);
    if (kind === "radio") {
      const option = text(/^[^<]*/.exec(after)[0]);
      const field = fields.get(key) ?? { key, label: labelBefore(c.index), required: false, type: "select", options: [] };
      field.required ||= /\brequired\b/.test(attrs);
      if (option) field.options.push(option);
      if (option && /\bchecked\b/.test(attrs)) field.preselected = option;
      fields.set(key, field);
      continue;
    }
    if (fields.has(key)) continue;
    const field = { key, label: "", required: /\brequired\b/.test(attrs), type: TYPES[kind] ?? "text", options: [] };
    if (kind === "checkbox") {
      field.label = text(after.slice(0, Math.max(after.indexOf("</label>"), 0))).slice(0, 400) || labelBefore(c.index);
      if (key === "terms") field.consent = true;
    } else {
      field.label = labelBefore(c.index).slice(0, 400);
    }
    if (kind === "select") {
      const body = after.slice(0, Math.max(after.indexOf("</select>"), 0));
      field.options = [...body.matchAll(/<option\b[^>]*value="([^"]*)"[^>]*>([\s\S]*?)<\/option>/g)]
        .filter((m) => m[1] !== "").map((m) => text(m[2])).filter(Boolean);
      if (/\bmultiple\b/.test(attrs)) field.type = "multiselect";
    }
    if (field.options.length > MAX_OPTIONS) field.options = [];
    field.label ||= key;
    fields.set(key, field);
  }
  return [...fields.values()];
}
