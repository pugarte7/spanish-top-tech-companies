# Contributing

Two ways in. Pick whichever you're comfortable with.

## 1. Open an issue (no YAML)

Use [**Add a company**](../../issues/new?template=add-company.yml) or [**Add or update a salary band**](../../issues/new?template=update-band.yml). Fill the form, we turn it into a PR. This is the right route if you're sharing your own numbers.

**On anonymity:** anything you put in a public issue is public and tied to your GitHub account forever. If you're sharing your own salary, consider a throwaway account, or check whether your employer would care. We'd rather have the data than have you regret posting it.

## 2. Open a pull request

```bash
git clone https://github.com/pugarte7/spanish-top-tech-companies
cd spanish-top-tech-companies
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
```

**New company:**

```bash
python3 scripts/new_company.py "Company Name" 1234567   # name + LinkedIn id
```

That writes `data/companies/company-name.yml` with `CHANGEME` everywhere. Replace all of them. [`_template.yml`](data/companies/_template.yml) documents every field.

**Existing company:** edit its file directly. One company per PR keeps reviews quick.

**Bulk import** from a spreadsheet:

```bash
python3 scripts/import_csv.py my-export.csv
```

Columns are documented at the top of [`scripts/import_csv.py`](scripts/import_csv.py). It merges into existing files rather than overwriting them.

**From Levels.fyi's public pages** (no key needed):

```bash
python3 scripts/fetch_levels_public.py            # all job families
python3 scripts/fetch_levels_public.py --dry-run  # just show the URLs
```

This reads the markdown routes Levels.fyi publishes for agents and asks attribution for. It gives Spain-wide benchmarks and top-paying-company medians, at level `all`, as total compensation. It cannot give per-level ladders, base-salary splits or sample sizes.

Those pages are served from a 12-hour CDN cache and return nothing when cold, so any single run picks up only part of the data. Running it repeatedly over a few days accumulates coverage; it never overwrites a good band with an empty one.

**Company details and per-level ladders** (no key, but must run from Spain):

```bash
python3 scripts/fetch_company.py --all          # every company already on file
python3 scripts/fetch_company.py --company glovo
```

Each Levels.fyi company page embeds the company's own record (website, careers page, LinkedIn, headquarters, headcount, industry, vesting) and a per-level pay ladder with submission counts.

Two things to know. Those pages are scoped by **your IP address** and ignore every location query parameter, so from outside Spain they return another country's figures in another currency; the script checks and skips rather than writing them. And the company details come from Levels.fyi, which gets some of them wrong (it lists Glovo in Milan and BBVA in Birmingham) — worth checking against reality before trusting.

It never overwrites a field a human has already filled in.

**From the Levels.fyi API** (needs a key, request one at [levels.fyi/api-access](https://www.levels.fyi/api-access/)):

```bash
export LEVELS_FYI_API_KEY=...
python3 scripts/fetch_levels.py --company Cabify --role data-engineer
python3 scripts/fetch_levels.py --dry-run --company Cabify      # see the calls, no key needed
```

It pulls per-level percentiles filtered to Spain, maps them onto our level ladder and merges them into the company file. Read [METHODOLOGY.md](METHODOLOGY.md#sources) first: the data is licensed, and a key is not permission to republish.

**Before you push:**

```bash
python3 scripts/validate.py   # must pass
python3 scripts/build.py      # regenerates README tables + exports/
```

Commit the regenerated `README.md` and `exports/` along with your data change. CI runs both and will tell you if they're out of sync.

## What makes a submission usable

- **A source.** A link, or `offer-letter` / `community` if you're reporting your own. No source, no merge.
- **A date.** `last_verified` is when you actually checked, not today's date by reflex.
- **The median, or a real range.** "Around 70k" is a `p50`. A range you saw in a job ad is `min`/`max`.
- **No people in it.** No names, no teams, no identifying detail. See [METHODOLOGY.md](METHODOLOGY.md#sources).
- **Base salary, before tax, in euros.** Bonus and equity have their own fields. If your source quotes total compensation (levels.fyi does), put it in `total_comp` and leave `base` for base.

## Working through the backlog

[`data/backlog.csv`](data/backlog.csv) holds LinkedIn company IDs that haven't been researched. To claim some, open an issue saying which rows you're taking so two people don't do the same work.

The IDs need resolving to names first — [`scripts/resolve_linkedin_ids.js`](scripts/resolve_linkedin_ids.js) explains how, since LinkedIn requires a logged-in session.

## Removals

If you're at one of these companies and something is wrong, open an issue and it gets fixed or removed. No argument needed.
