# Contributing

Two ways in. Pick whichever you're comfortable with.

## 1. Open an issue (no CSV)

Use [**Add a company**](../../issues/new?template=add-company.yml) or [**Add or update a salary band**](../../issues/new?template=update-band.yml). Fill the form, we turn it into a PR. This is the right route if you're sharing your own numbers.

**On anonymity:** anything you put in a public issue is public and tied to your GitHub account forever. If you're sharing your own salary, consider a throwaway account, or check whether your employer would care. We'd rather have the data than have you regret posting it.

## 2. Open a pull request

All the data is one file, [`companies.csv`](companies.csv): one row per salary figure, with the company's own columns repeated on each of its rows. A company with no figure has a single row with the salary columns empty. The README tables are generated from it.

```bash
git clone https://github.com/pugarte7/spanish-top-tech-companies
cd spanish-top-tech-companies
```

Nothing to install. The scripts use plain Python 3.9 or newer.

**A new salary for a company already listed:** copy one of its rows and change `role`, `level`, the figures, `source`, `source_url`, `date` and `notes`. Someone telling you their own salary is `source` `community`; an offer you received is `offer-letter`. Neither needs a URL.

**A new company:** add a line at the end with its name and LinkedIn company id, `Acme,1234567`, and let the scripts fill in the rest:

```bash
python3 scripts/resolve_slugs.py                 # finds its Levels.fyi page
python3 scripts/fetch_spain.py --company acme    # reads its Spanish pay
```

The id is the `f_C` number in a LinkedIn job search filtered to that company. [`scripts/resolve_linkedin_ids.js`](scripts/resolve_linkedin_ids.js) turns a whole search's Company filter into these lines at once.

### Columns

| Column | What goes in it |
| --- | --- |
| `company` | The name shown in the README. Every row of a company uses the same spelling. |
| `linkedin_ids` | LinkedIn company ids, `\|`-separated when an employer has several (Amazon and AWS). |
| `linkedin_url` | The company's LinkedIn page, if it has a vanity URL. |
| `levels_slug`, `levels_status` | Its Levels.fyi page, and `resolved`, `review` or `unmatched` (not on Levels.fyi). Written by `resolve_slugs.py`. |
| `role`, `level` | A role slug from [METHODOLOGY.md](METHODOLOGY.md#canonical-role-slugs) and one of the levels listed there, or `all`. |
| `base_min`, `base_p50`, `base_max` | Gross annual base salary in euros. A range is the 25th to 75th percentile, or the range a job ad published. |
| `total_min`, `total_p50`, `total_max` | Total compensation, same shape. |
| `sample_size` | How many salaries the figure is built from, if known. |
| `source`, `source_url`, `date` | Where the figure came from and when it was checked, `YYYY-MM-DD`. |
| `notes` | Anything a reader of the CSV needs to trust the figure. |
| `spain_check_date`, `spain_check_roles`, `spain_check_served` | Written by `fetch_spain.py` when Levels.fyi had nothing for Spain. See [METHODOLOGY.md](METHODOLOGY.md#recording-that-there-was-nothing-to-find). |
| `website`, `careers_url`, `hq_city`, `hq_country`, `employees`, `sector`, `year_founded`, `about` | Company details from Levels.fyi. Written by `fetch_company.py`. |

### Fetching from Levels.fyi

**Spain-scoped pay, per company** (no key, but must run from Spain):

```bash
python3 scripts/fetch_spain.py --delay 3.0     # every resolved company, ~14 min
python3 scripts/fetch_spain.py --company glovo
python3 scripts/fetch_spain.py --audit         # report only, writes nothing
```

This is the main route, and the only one that gives base salary per company. It reads `/companies/<slug>/salaries/software-engineer/locations/spain` and writes a figure only when the page says the figures it served really are Spanish. See [METHODOLOGY.md](METHODOLOGY.md#a-band-must-prove-it-is-spanish) for why that check is not optional. It also deletes any figure already on file whose source URL names no location.

Keep `--delay` at 2.5s or more. Levels.fyi answers 403, 405, 429 and 503 when it decides you are a bot, and all four mean *slow down*, not *no such company*.

**Country job-family pages** (no key):

```bash
python3 scripts/fetch_levels_public.py            # all job families
python3 scripts/fetch_levels_public.py --dry-run  # just show the URLs
```

These give each job family's top-paying companies in Spain, one total compensation median per company across all levels. Mostly useful for finding companies that are not on the list yet. It never overwrites a figure from a company's own Spain page or a first-hand one.

**Company details**: website, HQ, headcount, sector, vesting (no key):

```bash
python3 scripts/fetch_company.py --all
python3 scripts/fetch_company.py --company glovo
```

Details only, deliberately. The same page carries a per-level pay ladder, and that ladder is **not** filtered to Spain: it is the company's global data shown in whatever currency your own IP implies, so `EUR` tells you nothing about where the money was earned. Reading it as Spanish once put 682 foreign bands in here, and a later branch put 205 more back.

The details themselves come from Levels.fyi, which gets some of them wrong (it lists Glovo in Milan and BBVA in Birmingham), so check them against reality before trusting. It never overwrites a field a human has already filled in.

### Before you push

```bash
python3 tests/test_pipeline.py   # regressions we have actually shipped
python3 scripts/validate.py      # must pass
python3 scripts/build.py         # regenerates the README and tidies companies.csv
```

Commit the regenerated `README.md` and `companies.csv` along with your change. `build.py` rewrites the CSV in a fixed order, so the diff shows only what changed. CI runs all three and fails if either file is out of date.

## What makes a submission usable

- **A source.** A link, or `offer-letter` / `community` if you're reporting your own. No source, no merge.
- **A date.** `date` is when you actually checked, not today's date by reflex.
- **The median, or a real range.** "Around 70k" is a `base_p50`. A range you saw in a job ad is `base_min` and `base_max`.
- **No people in it.** No names, no teams, no identifying detail. See [METHODOLOGY.md](METHODOLOGY.md#sources).
- **Base salary, before tax, in euros.** If your source quotes total compensation (levels.fyi does), put it in the `total_` columns and leave the `base_` ones for base. Contract type, bonus and equity go in `notes`.

## Removals

If you're at one of these companies and something is wrong, open an issue and it gets fixed or removed. No argument needed.
