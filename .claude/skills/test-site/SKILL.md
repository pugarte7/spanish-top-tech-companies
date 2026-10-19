---
name: test-site
description: Test the salary website (web/app.js, web/style.css, scripts/site.py) in a real Chromium with Playwright, and take screenshots of it. Use after any change to the site, when asked to test, check, verify or screenshot the web, or before committing site changes.
---

# Testing the site

The site is static: `scripts/site.py` writes `_site/` from `companies.csv`,
and `web/app.js` draws everything in the browser. Python tests do not reach
that code; these do.

First time on a machine: `npm install && npx playwright install chromium`.

## Run the tests

```sh
npm run test:site
```

This rebuilds `_site/`, serves it on port 47123 and runs
`tests/site/site.spec.mjs` in Chromium, at desktop width and (tests tagged
`@mobile`) on a phone. Any script error, console error or failed request
fails the test it happened in. On a failure Playwright saves a screenshot
under `test-results/`; open it with Read before guessing at the cause.

One test: `npx playwright test -g "role menu"`. Watch it run:
`npx playwright test --headed`.

## Look at the page

Tests check behaviour; a screenshot checks how it looks. After a visual
change, take one and read it:

```sh
python3 scripts/site.py
npm run shoot -- "/es/#role=software-engineer" --click ".filter[data-k=role] .pick" --out test-results/role.png
npm run shoot -- /es/ --width 390 --dark --scroll 1600 --out test-results/bar.png
```

Options are in the header of `tests/site/shoot.mjs`: viewport size, dark
mode, clicks in order, scroll to a y offset or a selector, full page. Use
this instead of headless Chrome from the shell: Chrome's own `--screenshot`
renders a blank page once the window is scrolled, which hides exactly the
sticky-bar and overlap bugs worth looking for. `shoot.mjs` runs full
Chromium rather than Playwright's headless shell for the same reason: the
shell does not paint `backdrop-filter`, so blur and glass effects look wrong.

Check both themes and a phone width (390) when a change touches layout or
colour.

## When the site changes

Every user-visible feature has a test: filters, the role tree, the years
span, sorting, opening rows, the map toggle, logo alignment, no sideways
scroll on a phone. Add or update one in `tests/site/site.spec.mjs` in the
same change, asserting what a reader would see (text, order, `aria-*`
state, the URL hash), not implementation details. Spanish copy is the
default page; text assertions use it.

Then run `npm run test:site`, read any failure screenshot, and report the
result as it is.
