# Contributing

Two ways in. Pick whichever you're comfortable with.

## 1. Open an issue (no YAML)

Use [**Add a company**](../../issues/new?template=add-company.yml) or [**Add or update a salary band**](../../issues/new?template=update-band.yml). Fill the form, we turn it into a PR. This is the right route if you're sharing your own numbers.

**On anonymity:** anything you put in a public issue is public and tied to your GitHub account forever. If you're sharing your own salary, consider a throwaway account, or check whether your employer would care. We'd rather have the data than have you regret posting it.

## 2. Open a pull request

```bash
git clone https://github.com/OWNER/spanish-top-tech-companies
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
- **Base salary, before tax, in euros.** Bonus and equity have their own fields.

## Working through the backlog

[`data/backlog.csv`](data/backlog.csv) holds LinkedIn company IDs that haven't been researched. To claim some, open an issue saying which rows you're taking so two people don't do the same work.

The IDs need resolving to names first — [`scripts/resolve_linkedin_ids.js`](scripts/resolve_linkedin_ids.js) explains how, since LinkedIn requires a logged-in session.

## Removals

If you're at one of these companies and something is wrong, open an issue and it gets fixed or removed. No argument needed.
