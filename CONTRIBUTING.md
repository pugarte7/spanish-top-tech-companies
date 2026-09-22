# Contributing

Two ways in. Pick whichever you're comfortable with.

## 0. Add your salary on Levels.fyi

The easiest way, and anonymous. Add it at [levels.fyi/salaries/add](https://www.levels.fyi/salaries/add) with your city in Spain and your years of experience. The list is rebuilt from Levels.fyi's Spanish submissions, so a software engineer with 5 or more years and 60k or more in base is picked up on the next run, and a company that is not here yet gets its row the first time one of its engineers qualifies.

## 1. Open an issue (no CSV)

Use [**Add a company**](../../issues/new?template=add-company.yml) or [**Add or update a salary**](../../issues/new?template=update-band.yml). Fill the form, we turn it into a PR. This is the right route if you're sharing your own numbers and would rather not use Levels.fyi.

**On anonymity:** anything you put in a public issue is public and tied to your GitHub account forever. If you're sharing your own salary, consider a throwaway account, or check whether your employer would care. We'd rather have the data than have you regret posting it.

## 2. Open a pull request

All the data is one file, [`companies.csv`](companies.csv): one row per salary, with the company's own columns repeated on each of its rows. A company is on the list only while it has at least one salary; a `Name,linkedin_id` row with the salary columns empty is how one is added by hand, and it stays only if the fetch finds something. The README is generated from it, and shows each company's average of those salaries.

Every row is **one software engineer in Spain with 5 or more years of experience and a base salary of 60.000 € or more**. Nothing else goes in: no other job families, nobody under five years or under 60k, and no averages. What their company calls the level does not matter. [METHODOLOGY.md](METHODOLOGY.md#who-counts) explains why.

```bash
git clone https://github.com/pugarte7/spanish-top-tech-companies
cd spanish-top-tech-companies
```

Nothing to install. The scripts use plain Python 3.9 or newer.

**A new salary for a company already listed:** copy one of its rows and change `base`, `total`, `years_experience`, `level`, `city`, `reported`, `source`, `source_url`, `date` and `notes`. Someone telling you their own salary is `source` `community`; an offer you received is `offer-letter`. Neither needs a URL.

**A new company:** add a line at the end with its name and LinkedIn company id, `Acme,1234567`, and let the scripts fill in the rest:

```bash
python3 scripts/resolve_slugs.py                 # finds its Levels.fyi page
python3 scripts/fetch_spain.py --company acme    # reads its qualifying salaries in Spain
```

The id is the `f_C` number in a LinkedIn job search filtered to that company. [`scripts/resolve_linkedin_ids.js`](scripts/resolve_linkedin_ids.js) turns a whole search's Company filter into these lines at once.

### Columns

| Column | What goes in it |
| --- | --- |
| `company` | The name shown in the README. Every row of a company uses the same spelling. |
| `linkedin_ids` | LinkedIn company ids, `\|`-separated when an employer has several (Amazon and AWS). |
| `linkedin_url` | The company's LinkedIn page, if it has a vanity URL. |
| `levels_slug`, `levels_status` | Its Levels.fyi page, and `resolved`, `review` or `unmatched` (not on Levels.fyi). Written by `resolve_slugs.py`. |
| `base` | Gross annual base salary in euros. 60000 or more. |
| `total` | Total compensation in euros, if known. |
| `years_experience` | Years of experience: a number, or a bucket like `5-10` or `11+`. 5 or more. |
| `level` | The level as the company names it (`L4`, `SDE II`, `Senior`). Informational only. |
| `city`, `reported` | Where in Spain, and the month the salary was reported, `YYYY-MM`. |
| `source`, `source_url`, `date` | Where the salary came from and when it was read, `YYYY-MM-DD`. |
| `notes` | Anything a reader of the CSV needs to trust it, such as the contract type. |
| `spain_submissions` | How many software-engineer submissions from Spain `fetch_spain.py` read for the company, qualifying or not. The README's Share column divides the Levels.fyi rows by it. Written by the fetcher; leave it empty on a hand-added company. |
| `website`, `careers_url`, `hq_city`, `hq_country`, `employees`, `sector`, `year_founded`, `about` | Company details from Levels.fyi. Written by `fetch_company.py`. |

### Fetching from Levels.fyi

**Qualifying salaries in Spain, per company** (must run from Spain, and needs your Levels.fyi session to see everything):

```bash
python3 scripts/fetch_spain.py --delay 3.0     # every company on file, plus any new ones, ~25 min
python3 scripts/fetch_spain.py --company glovo
python3 scripts/fetch_spain.py --audit         # report only, writes nothing
```

This is the only route for crowdsourced salaries. It reads `/companies/<slug>/salaries/software-engineer/locations/spain` and the "Latest Salary Submissions" table under it, and writes every submission from a Spanish city with 5 or more years of experience and a base of 60k or more. See [METHODOLOGY.md](METHODOLOGY.md#an-entry-must-prove-it-is-spanish) for why the city check is not optional. It also deletes any entry already on file whose source URL names no location, removes a company that comes back with nothing (unless a first-hand entry vouches for it), and leaves a company untouched when its page or table cannot be read. With a session it also reads Levels.fyi's feed of recent Spanish submissions and fetches every employer in it that is not on file yet, which is how new companies arrive.

The table is where most submissions are, and the browser only loads it for a signed-in visitor who has added a salary. Without a session the script reads the public page alone, which for most companies is a single record, and says so. To give it your session: sign in on levels.fyi, open the browser console and run `copy(localStorage.getItem("auth"))`, then

```bash
mkdir -p ~/.config/levels && pbpaste > ~/.config/levels/token && chmod 600 ~/.config/levels/token
```

or export it as `LEVELS_TOKEN`. The token is a login: it lives outside the repository, nothing prints it, and it expires after a day, so copy a fresh one before a run. Reading the table this way is not something Levels.fyi's terms allow, and the account could be closed for it; that risk is the maintainer's to take, not a contributor's.

Keep `--delay` at 2.5s or more. Levels.fyi answers 402, 403, 405, 429 and 503 when it decides you are a bot, and all five mean *slow down*, not *no such company*. A 401 means the token has expired.

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
- **One software engineer, with their years of experience.** Not an average for the whole team, and not a salary without the years.
- **No people in it.** No names, no teams, no identifying detail. See [METHODOLOGY.md](METHODOLOGY.md#sources).
- **Base salary, before tax, in euros.** If your source quotes total compensation (levels.fyi does), put it in `total` and leave `base` for base. Contract type, bonus and equity go in `notes`.

## Removals

If you're at one of these companies and something is wrong, open an issue and it gets fixed or removed. No argument needed.
