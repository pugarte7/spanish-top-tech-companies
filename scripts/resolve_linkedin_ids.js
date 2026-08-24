// Resolve the LinkedIn company IDs in data/backlog.csv into names.
//
// The IDs come from the `f_C` parameter of a LinkedIn job search URL, and
// linkedin.com/company/<id> redirects to the login wall, so this has to run in
// a browser where you are already signed in.
//
// 1. Open your job search URL (the one with all the f_C ids).
// 2. Open the "Company" filter dropdown so the checkboxes render. Click
//    "Show more" until the whole list is expanded.
// 3. Open DevTools -> Console, paste this, press enter.
// 4. Copy the CSV it prints into data/backlog.csv.
//
// LinkedIn reshuffles its DOM regularly. If you get zero rows, inspect one
// checkbox and adjust the selector below.

(() => {
  const rows = [...document.querySelectorAll('input[type="checkbox"]')]
    .filter((input) => /^\d+$/.test(input.value))
    .map((input) => {
      const label =
        document.querySelector(`label[for="${CSS.escape(input.id)}"]`) ||
        input.closest("li")?.querySelector("label");
      const name = (label?.innerText || "")
        .split("\n")[0]
        .replace(/\s*\(\d[\d.,]*\)\s*$/, "") // trailing job count
        .trim();
      return { id: input.value, name };
    })
    .filter((row) => row.name);

  const seen = new Set();
  const unique = rows.filter((r) => !seen.has(r.id) && seen.add(r.id));

  const slug = (name) =>
    name
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "");

  const csv = [
    "linkedin_id,name,slug,status,notes",
    ...unique.map((r) => `${r.id},"${r.name.replace(/"/g, '""')}",${slug(r.name)},resolved,`),
  ].join("\n");

  console.log(`Resolved ${unique.length} companies.`);
  console.log(csv);
  copy?.(csv); // DevTools helper: puts it on your clipboard
  return unique.length;
})();
