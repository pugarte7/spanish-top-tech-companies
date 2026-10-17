# Contributing

Two ways in. Pick whichever you're comfortable with.

## 0. Add your salary on Levels.fyi

The easiest way, and anonymous. Add it at [levels.fyi/salaries/add](https://www.levels.fyi/salaries/add) with your city in Spain and your years of experience, in whichever job family fits. The dataset is rebuilt from Levels.fyi's Spanish submissions, so any role and any seniority is picked up on the next run — and a company that is not here yet arrives with it. The README's tables still list senior software engineers only: 5+ years, median of 50k+ to appear, 60k+ for the main table.

## 1. Open an issue (no CSV)

Use [**Add a company**](../../issues/new?template=add-company.yml) or [**Add or update a salary**](../../issues/new?template=update-band.yml). Fill the form, we turn it into a PR. This is the right route if you're sharing your own numbers and would rather not use Levels.fyi.

**On anonymity:** anything you put in a public issue is public and tied to your GitHub account forever. If you're sharing your own salary, consider a throwaway account, or check whether your employer would care. We'd rather have the data than have you regret posting it.

## 2. Open a pull request

All the data is one file, [`companies.csv`](companies.csv): one row per salary, with the company's own columns repeated on each of its rows. A company is on file while it has any salary on file; the README is generated from it and still lists senior software engineers only. A `Name,linkedin_id` row with the salary columns empty is how one is added by hand.

Every row is **one person in Spain, in any job family, at any seniority**, paid whatever they are paid — the file feeds the website as well as the README, so juniors and other roles belong in it now. What a company calls the level does not matter. Only the README is narrow: software engineers with 5+ years, median of 50.000 € or more to be listed, 60.000 € for the main table. [METHODOLOGY.md](METHODOLOGY.md#who-counts) explains why.

```bash
git clone https://github.com/pugarte7/spanish-top-tech-companies
cd spanish-top-tech-companies
```

Nothing to install. The scripts use plain Python 3.9 or newer.

**A new salary for a company already listed:** copy one of its rows and change the entry columns below — `role` (required; `software-engineer`, `data-scientist`… the taxonomy's slug), `base`, `total`, `years_experience`, `city`, `reported`, `source`, `source_url`, `date` — and any of `title`, `specialization`, `level`, `work_arrangement`, `employment_type`, `bonus`, `stock`, `currency`, `perspective` and `notes` you actually know. Someone telling you their own salary is `source` `community`; an offer you received is `offer-letter`. Neither needs a URL. A first-hand senior software-engineer row still has to be at 60k+ — it is the maintainer vouching that the company pays that.

**A new company:** add a line at the end with its name and LinkedIn company id, `Acme,1234567`, and let the scripts fill in the rest:

```bash
python3 scripts/resolve_slugs.py                 # finds its Levels.fyi page
python3 scripts/fetch_spain.py --company acme    # reads its senior salaries in Spain
```

The id is the `f_C` number in a LinkedIn job search filtered to that company. [`scripts/resolve_linkedin_ids.js`](scripts/resolve_linkedin_ids.js) turns a whole search's Company filter into these lines at once.

### Columns

| Column | What goes in it |
| --- | --- |
| `company` | The name shown in the README. Every row of a company uses the same spelling. |
| `linkedin_ids` | LinkedIn company ids, `\|`-separated when an employer has several (Amazon and AWS). |
| `linkedin_url` | The company's LinkedIn page, if it has a vanity URL. |
| `levels_slug`, `levels_status` | Its Levels.fyi page, and `resolved`, `review` or `unmatched` (not on Levels.fyi). Written by `resolve_slugs.py`. An employer with two Levels.fyi slugs keeps the canonical one here and the other in `lib.SLUG_ALIASES`; a slug nobody can put a company to goes in `lib.EXCLUDED_SLUGS`. |
| `role` | The taxonomy's slug for the job family: `software-engineer`, `product-manager`, `data-scientist`… Never free text; `scripts/taxonomy.py` is the catalog. |
| `base` | Gross annual base salary in euros. A first-hand senior software-engineer row must be 60000 or more; anything else is whatever was reported. |
| `total`, `bonus`, `stock` | Total compensation, annual bonus and annualised equity in euros, if known. |
| `currency` | The currency the person is actually paid in (`EUR`, `USD`…). Figures above are always euros; this marks, say, a remote job paid in dollars. |
| `years_experience` | Years of experience: a number, or a bucket like `5-10` or `11+`. Any value — the 5+ rule is the README's, not the file's. |
| `level` | The level as the company names it (`L4`, `SDE II`, `Senior`). Informational only. |
| `title`, `specialization` | The taxonomy's slugs, or empty: `title` only when the reported title confidently maps to an official one, `specialization` from the focus tag or a known title. Never free text. |
| `city`, `region` | Where in Spain: the city, and the autonomous community's ISO code (`CT`, `MD`…). |
| `work_arrangement`, `employment_type`, `perspective` | `office`/`hybrid`/`remote`; `full_time`/`contract`/…; `employee` or `offer`. |
| `reported` | The month the salary was reported, `YYYY-MM`. |
| `source`, `source_url`, `date` | Where the salary came from and when it was read, `YYYY-MM-DD`. A levels.fyi URL must name the company, the role's page and `/locations/spain`. |
| `notes` | Anything a reader of the CSV needs to trust it, such as the contract type. |
| `website`, `careers_url`, `hq_city`, `hq_country`, `employees`, `sector`, `year_founded`, `about` | Company details from Levels.fyi. Written by `fetch_company.py`. |
| `company_type`, `remote_policy`, `offices`, `stack`, `radar_slug`, `github_url`, `cif` | From Spain Tech Radar or typed by hand: product or consultancy, the stated remote policy, offices as `City, CC (lat,lon)`, and the stack, `\|`-separated. A hand-set value or a `-` ("checked, there is none") is never overwritten. |

### Fetching from Levels.fyi

**Every Spanish salary, per role** (must run from Spain, and needs your Levels.fyi session):

```bash
python3 scripts/fetch_spain.py --delay 3.0        # all 129 roles, ~30-45 min
python3 scripts/fetch_spain.py --role data-scientist
python3 scripts/fetch_spain.py --company glovo    # writes only that employer
python3 scripts/fetch_spain.py --audit            # report only, writes nothing
```

This is the only route for crowdsourced salaries. For each role it reads the country-wide feed — the same API that fills the "Latest Salary Submissions" table, with no company filter — paging until an empty answer rather than the reported total, and writes every submission naming a Spanish city, whatever the role, years or pay. See [METHODOLOGY.md](METHODOLOGY.md#an-entry-must-prove-it-is-spanish) for why the city check is not optional. A role's feed then replaces that role's stored Levels.fyi rows per company: first-hand rows and other roles are untouched, a feed that could not be read to the end changes nothing, and a company left with no rows at all is dropped. New companies arrive inside the feed — no separate discovery pass.

The feed only exists for a signed-in visitor who has added a salary. Without a session the script only runs with `--audit`: the public page alone is a single record for most companies, and writing it would replace the feed entries on file. To give it your session: sign in on levels.fyi, open the browser console and run `copy(localStorage.getItem("auth"))`, then

```bash
mkdir -p ~/.config/levels && pbpaste > ~/.config/levels/token && chmod 600 ~/.config/levels/token
```

or export it as `LEVELS_TOKEN`. The token is a login: it lives outside the repository, nothing prints it, and it expires after a day, so copy a fresh one before a run.

To stop copying one daily, give it the refresh token instead and it mints a fresh id token each run. Sign in on levels.fyi in a private window, run this in its console, then close the window without signing out, so that session stays its own and nothing revokes it:

```js
copy(localStorage.getItem(Object.keys(localStorage).find(k => k.startsWith("CognitoIdentityServiceProvider.76of0ich18hd8uehju7fniv2u1.") && k.endsWith(".refreshToken"))))
```

```bash
mkdir -p ~/.config/levels && pbpaste > ~/.config/levels/refresh_token && chmod 600 ~/.config/levels/refresh_token
```

When that file exists it wins over the token file, and a refused refresh token stops the run instead of falling back to the public page. Reading the table this way is not something Levels.fyi's terms allow, and the account could be closed for it; that risk is the maintainer's to take, not a contributor's.

Keep `--delay` at 2.5s or more. Levels.fyi answers 402, 403, 405, 429 and 503 when it decides you are a bot, and all five mean *slow down*, not *no such company*. A 401 means the token has expired.

**Company details from Spain Tech Radar** (public data, no key, only for companies that have salaries):

```bash
python3 scripts/fetch_radar.py            # fills offices, stack, careers page, type, CIF
python3 scripts/fetch_radar.py --dry-run  # print the matches, write nothing
```

It matches by domain, then LinkedIn, then exact name — every name match is printed for review. It fills empty fields only, so anything typed by hand (and a `-` meaning "there is none") is kept.

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
- **One person, a role, and their years of experience.** Not an average for the whole team, and not a salary without the years.
- **No people in it.** No names, no teams, no identifying detail — and the normalized fields (`title`, `specialization`) are the taxonomy's slugs or empty, never free text. See [METHODOLOGY.md](METHODOLOGY.md#sources).
- **Base salary, before tax, in euros.** If your source quotes total compensation (levels.fyi does), put it in `total` and leave `base` for base. Bonus and equity have their own columns; the contract type goes in `employment_type`, or `notes` for anything the column does not cover.

## Removals

If you're at one of these companies and something is wrong, open an issue and it gets fixed or removed. No argument needed.
