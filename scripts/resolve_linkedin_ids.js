// Turn the LinkedIn company IDs in data/backlog.csv into company names.
//
// The IDs come from the `f_C` parameter of a LinkedIn job search URL.
// linkedin.com/company/<id> redirects to the login wall, so this has to run in
// a browser where you are already signed in.
//
//   1. Open your job search URL (the long one with all the f_C ids).
//   2. Click the "Company" filter so its dropdown opens.
//   3. Open DevTools (Cmd+Option+I) -> Console, paste this, press Enter.
//   4. It expands the list, then prints CSV and copies it to your clipboard.
//
// It reports how many of the 243 it found. If the number looks short, scroll
// the dropdown to the bottom and run it again.

(async () => {
  const EXPECTED = 243;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  // LinkedIn paginates the filter list behind "Show more" buttons.
  for (let round = 0; round < 40; round++) {
    const more = [...document.querySelectorAll('button, [role="button"]')].find((b) =>
      /show more|ver más|mostrar más/i.test(b.textContent || "")
    );
    if (!more || more.disabled) break;
    more.click();
    await sleep(350);
  }

  const clean = (s) =>
    (s || "")
      .split("\n")[0]
      .replace(/\s*\(\s*[\d.,]+\s*\)\s*$/, "") // trailing result count
      .replace(/\s+/g, " ")
      .trim();

  const rows = new Map();
  for (const input of document.querySelectorAll('input[type="checkbox"]')) {
    const id = (input.value || "").trim();
    if (!/^\d+$/.test(id)) continue;
    const label =
      document.querySelector(`label[for="${CSS.escape(input.id)}"]`) ||
      input.closest("li, fieldset, div")?.querySelector("label");
    const name = clean(label?.innerText || input.getAttribute("aria-label"));
    if (name && !rows.has(id)) rows.set(id, name);
  }

  if (!rows.size) {
    console.warn(
      "Found nothing. Make sure the Company filter dropdown is open, then re-run.\n" +
        "If it still finds nothing, LinkedIn changed its markup: right-click a\n" +
        "company checkbox, Inspect, and send the HTML to update the selector."
    );
    return;
  }

  const slug = (name) =>
    name
      .toLowerCase()
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "");

  const csv = [
    "linkedin_id,name,slug,status,notes",
    ...[...rows].map(([id, name]) => `${id},"${name.replace(/"/g, '""')}",${slug(name)},resolved,`),
  ].join("\n");

  console.log(`Resolved ${rows.size} of ~${EXPECTED} companies.`);
  if (rows.size < EXPECTED) {
    console.warn("Short of the full list — scroll the dropdown to the bottom and run again.");
  }
  console.log(csv);
  try {
    copy(csv);
    console.log("Copied to your clipboard.");
  } catch {
    console.log("Select the CSV above and copy it manually.");
  }
})();
