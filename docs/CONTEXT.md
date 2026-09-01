# Working context

Written 2026-08-31, at the end of a long session. Read this before touching the
data pipeline; several things about Levels.fyi are counter-intuitive and cost a
lot of time to discover.

## What this repository is

A list of tech companies that pay senior software engineers 60.000 € a year or
more to work **from Spain**. Two things follow from that and both are load
bearing:

- **Spain only.** A German salary in this list is worse than no salary, because
  the whole point is that other sources mix countries.
- **Senior and above.** An all-seniority median includes juniors and answers a
  different question.

### The standard the maintainer wants

A row should eventually mean: *I know someone in Spain doing this job and what
they earn, or they offered me the position.* Nothing on the list meets that yet
— all 144 figures are crowdsourced from Levels.fyi. The `Source` column exists
to make that visible, and first-hand entries sort above everything else so the
list visibly converges on the standard as they are added.

Recording one:

```csv
name,role,level,base_p50,contract,sample_size,source,source_date
Example Company,software-engineer,senior,78000,spanish-payroll,1,community,2026-08-31
```

`community` = someone told you. `offer-letter` = you were offered it. Then
`python3 scripts/import_csv.py file.csv`.

## Current state

Branch `worktree-resolve-similar-names`, 10 commits ahead of `main`, pushed. No
PR opened yet.

```
262 companies · 112 paying 60k+ · 144 with pay on file · 528 data points
```

- `data/companies/*.yml` — 151 files (150 companies plus `_template.yml`)
- `data/backlog.csv` — 243 rows, 223 resolved to a Levels.fyi slug, 20 not on
  Levels.fyi at all
- Front page rows: 3 measured senior, 41 upper-quartile estimates (`*`), 100
  single submissions (`†`), 118 with no figure
- Every row links to LinkedIn; figures link to Levels.fyi

The front page is one table: company, senior figure, data points, source. The
old per-role tables, benchmarks and 900 lines of company profiles were removed
deliberately — Levels.fyi presents that better and the full data is in
`exports/`.

## The three traps in Levels.fyi data

**1. A company page silently serves another country.**
`/companies/<slug>/salaries` is scoped by the caller's IP and falls back to the
company's home country when there are no Spanish submissions. The old guard
checked only that the page currency was EUR, which Germany, the Netherlands,
France and Ireland all pass. This put Dutch salaries on Adyen and TomTom,
German ones on Celonis, N26, FREE NOW and T-Systems, and US ones elsewhere.
Those bands have been purged. `fetch_company.py` still has this flaw — prefer
`fetch_spain.py`.

**2. The per-location page answers in two voices, and they disagree.**
On `/companies/<slug>/salaries/software-engineer/locations/spain`:

- `percentiles` — an aggregate. Falls back to another country when the Spanish
  sample is below their publication threshold. `percentiles.locationName` names
  the country **actually served**, which is the only reliable guard.
- `median` — one real submission for the location requested. **Stays Spanish
  even when the aggregate has given up.**

Reading only the aggregate loses most of the data: Stripe, Spotify, Scopely and
Amadeus all serve a US or Indian aggregate next to a Barcelona or Madrid
submission. Using both took Spain coverage from 43 companies to 140.

`locationMeta` is useless as a guard — it just echoes the URL back.

**3. A sample count does not mean a published figure.**
Some companies return `sampleSize > 0` with `locationName: null`, every
percentile `0`, and `estimatedSalary` all `null`. Alan is one: 2 submissions
each for engineering-manager, data-scientist and product-designer, and no
number attached to any of them. Levels.fyi has the data and does not publish
it. The individual submissions table on the site renders client-side and is not
reachable from the server HTML — only that one `median` record is.

So "the site shows salaries for this company" and "the pipeline can read a
figure" are different claims, and the second is often false.

## Scripts

| Script | What it does | Safe? |
| --- | --- | --- |
| `fetch_spain.py` | Per-company Spain pay. Verifies Spain, writes base + total comp, records LinkedIn. | **Use this** |
| `fetch_levels_public.py` | Spain country pages (`/t/<role>/locations/spain`). Genuinely Spain-scoped but lists only ~10 companies per role/location, so it tops out around 47 companies. | Yes |
| `fetch_company.py` | Per-level ladders from the unscoped company page. **Trap 1 applies.** | No, not without a location guard |
| `fetch_levels.py` | Official Compensation API. Needs a key. | Yes |
| `resolve_slugs.py` | Company name → Levels.fyi slug, with verification and an alias table. | Yes |
| `import_csv.py` | Bulk-load salaries from CSV. How first-hand entries get in. | See caveat below |
| `build.py` | Regenerates the README table and `exports/`. | Yes |
| `validate.py` | Schema and sanity checks. | Yes |

All Levels.fyi fetching **must run from Spain** — the pages are IP-scoped.

Rate limiting: 403/405/429/503 all mean throttled. Treating them as "not found"
is what originally wrote 56 false `unmatched` rows into the backlog. Keep
`--delay` at 2.5s or more.

## Known gaps

- **118 companies have no figure.** Levels.fyi publishes nothing Spanish for
  them. `data/job-postings-seed.csv` is scaffolded for the LinkedIn job-ad
  route, which is source #3 in METHODOLOGY.md and the only way to reach these.
- **`import_csv.py` footgun.** It only guards on `name` being present, and
  writes the company skeleton *before* `merge_level` runs, so a row with no
  role/level still creates a `.yml` with `website: https://CHANGEME`. Do not
  run it over the blank seed file. A guard skipping rows with no role/level
  would fix it.
- **`fetch_company.py` is still unsafe** for the reason in trap 1.
- **`Kubernetes (Official)`** is in `backlog.csv` but is a project, not an
  employer. Probably delete the row.
- **Duplicate slugs.** Levels.fyi files some employers twice (`meta` and
  `facebook`). `build.py` merges them via the resolver's `matched as` note,
  uppercase acronyms, and slug identity. If a company shows twice, that merge
  is where to look.
- **Warnings.** 1018 of them, all pre-existing metadata gaps (no `work_model`,
  non-canonical role slugs). 0 errors.

## Commands

```bash
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt

python3 scripts/fetch_spain.py --delay 3.0        # ~14 min, 243 companies
python3 scripts/fetch_spain.py --audit            # report, write nothing
python3 scripts/validate.py && python3 scripts/build.py
```

`build.py` is idempotent; CI rebuilds and fails if the result differs from
what is committed, so always commit the regenerated `README.md` and `exports/`.

## Conventions

Commit messages are at most five words, no AI co-author trailers. PR
descriptions are brief and human, no em dashes.
