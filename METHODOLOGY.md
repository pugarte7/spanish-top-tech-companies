# Methodology

## Who counts

The README shows **what each company pays a software engineer**: the median over every one on file for it, at any experience, and how many of them are at 60.000 € or more. The CSV underneath is wider: since 2026-10-14 it holds every Spanish submission the fetcher can read — every job family and every seniority — because the same file feeds the website. The README's slice of it:

- **A software engineer.** Levels.fyi's software-engineer family only. Other roles are in the file — product managers, data scientists, engineering managers and the rest — but they never enter the README's medians.
- **In Spain.** The submission names a Spanish city.
- **Any experience.** Until 2026-10-17 only engineers with 5 or more years counted. That cut dated from when the fetcher only stored seniors; once every experience level was on file, the maintainer dropped it. A company's median now includes its juniors, so it reads lower than a seniors-only median would.

Pay does not decide who is on file, and neither do role or seniority: every Spanish submission is a row. Only the README's filter is narrow.

The README then shows one row per company: the **median** base salary and median total compensation over all of its software engineers on file, how many that is, and **At 60k+**, the share of them with a base of 60.000 € or more. "46% (6)" says thirteen engineers reported and six are at 60k+, so 60k+ happens there and is not the norm; "100% (4)" says everyone who reported is. Levels.fyi's own figures, an all-levels median or a ladder mean, are never used: they mix countries and roles, and the median here is computed from the rows themselves.

A company is on the main table while the median base of its software engineers on file is 60k or more. One whose median is between 50k and 60k is listed under **Need to improve**, so it is visible and visibly under the bar. Under 50k a company no longer leaves the file — the website needs every salary — but it stays off the README. The order is: filter positions by role, compute the median, filter companies by the median. The bar is a property of a company, not of a salary, so it is applied after aggregating and never to the rows the median is of.

A median of one salary is one person's pay, so read the Engineers column before the number.

Each table is sorted by median base first and At 60k+ second, after any first-hand rows. Share first was the rule for a day, when shares ran from 4% to 100%; with the median deciding the table, every main-table share is 50% or more and the median is the number that separates rows. At 60k+ still tells one-person rows and lopsided companies apart.

### How the rule was reached

On 2026-09-16 the list became the **mean of each company's seniors at 60k+**, and only those. Readers pointed out, correctly, that filtering to 60k+ before averaging makes any company with one well-paid senior look competitive: Minsait showed 90k off two engineers while its fourteen other seniors, all under 60k, were not even on file. On 2026-09-22 the maintainer replaced it with the median over every senior, declined a 15-year cap on experience (it changed no company's median by more than 2k), and kept the 60k bar as the share column. For a day the listing rule was "at least one senior at 60k+", which still listed BBVA at a median of 55k; a reader put it plainly, the company filter has to be on the aggregate, and the rule became median ≥ 60k. Thirty-three companies left the main table that way. The next day the maintainer brought back the 24 of them with a median of 50k or more under "Need to improve" (EPAM, eDreams, BBVA, Thoughtworks, Freenow, Ocado...) rather than lose them; the nine under 50k (Accenture, Minsait, Inditex, NTT DATA, adidas...) stayed out. Earlier versions had published Levels.fyi's per-company averages across levels, every job family, only rungs whose names said senior, and every salary as its own row. All of those were replaced. On 2026-10-17 the 5-year cut went too: it existed because the old fetcher only stored seniors, and once the feed carried every experience level the maintainer counted every software engineer.

## What "gross annual" means here

Total gross for the year, **before IRPF and social security**, across however many payments the contract splits it into. If a company pays 14 payments of 4.500 €, that is 63.000 € and it goes in as 63000.

Excluded from the number: ticket restaurant, health insurance, remote stipends and other perks. They matter, they are not salary.

## Why contract type matters

Three people can all be told "70k" and take home very different amounts, so say which one a first-hand entry is in its `notes`:

| Contract | What it means |
| --- | --- |
| `spanish-payroll` | A Spanish contract with a Spanish entity. Social security is the employer's problem. |
| `eor` | Employed through an intermediary (Deel, Remote, Oyster…). Usually fine, but benefits and severance are the EOR's, not the company's. |
| `contractor` | You invoice them. The gross number is not comparable to a payroll gross. |
| `freelance` | Autónomo. Quota, IVA, and your own holidays come out of that number. |

A contractor rate and a payroll salary are different units. Don't compare them without adjusting.

## Sources

Every entry needs a source. In rough order of how much we trust them:

1. `offer-letter`: someone had it in writing
2. `levels.fyi`, `company-published`: self-reported to an aggregator, or official
3. `job-posting`: a published range
4. `community`: reported directly to this repo
5. `glassdoor`, `other`: treat with suspicion

A first-hand entry (`offer-letter`, `community`) sorts above any crowdsourced one, however large that one is.

### Where a Levels.fyi entry comes from

Entries come from the same API that fills the "Latest Salary Submissions" table on the site, read once per job family rather than once per company: `api.levels.fyi/v3/salary/search` scoped to Spain (`countryIds[0]=226`) and the family's slug, with no `companySlug`, is the country-wide feed — every Spanish submission in the family, newest first. The browser loads it with the visitor's Cognito session, and shows an anonymous visitor a wall of asterisks instead, so the fetcher runs with the maintainer's session and refuses to write without one.

The feed's `total` tops out at 250 but the API keeps serving rows past it, so [`scripts/fetch_spain.py`](scripts/fetch_spain.py) pages until an empty answer — that reaches back years, past the three months the old discovery feed covered. Each feed row is one submission with its own location, years, pay, currency and exchange rate, plus fields the old pipeline threw away: the focus tag (a specialisation), the title, work arrangement, contract type and whether it is an offer or a current employee. Rows carry a uuid; the same submission repeating across pages is deduped on it.

Each entry keeps the company, role, official specialisation and title slugs (the taxonomy's, never free text), level, base, total, bonus and equity in euros, the payment currency, years of experience, city and region, work arrangement, contract type, offer-vs-employee, and the month it was submitted. It deliberately leaves out the submission id, the exact day, the free-text title, the team and the years at the company: together with a company and a city, those start to point at a person.

The row's `source_url` still points at the company page that proves the claim — `/companies/<slug>/salaries/<role>/locations/spain` — and `validate.py` rejects a Levels.fyi entry citing any other page.

### An entry must prove it is Spanish

Levels.fyi does not refuse a location it has no data for. Ask a company page for Spain and, if nobody in Spain has submitted for that employer, it quietly answers with another country: Germany for Celonis and N26, the Netherlands for Adyen and TomTom, the United States for a great many more. The page currency is no defence, because every euro-zone country returns EUR.

Every submission names its city, and [`scripts/fetch_spain.py`](scripts/fetch_spain.py) skips any outside Spain, whatever page it came from. It also deletes any entry whose source URL names no location. `locationMeta` is not a substitute: it only echoes the URL back.

A company whose Spanish software engineers' median is under 50k is not listed. Listing another country's pay under its name would be worse than the gap, and that is the one thing this repository exists to get right.

### Which companies are on the list

A company is on file while it has any Spanish salary on file, in any role at any seniority — the website needs the long tail. The README's bars are unchanged: main table at a software-engineer median of 60k, "Need to improve" between 50k and 60k, and nothing under 50k or without software engineers is shown there at all. What still leaves the file is a company with no rows after a full role read — the feed says nobody there reports — and a slug struck off by hand.

Companies get on the list with the feed itself: every employer named in a role's Spanish feed is written, so adding a salary on Levels.fyi is the whole submission process. A company can also be added by hand as a `Name,linkedin_id` row; it lasts while a fetch finds salaries for it.

A few employers need a hand. Levels.fyi files some under two slugs (`timescale` and `tiger-data`, `facebook` and `meta`); `lib.SLUG_ALIASES` reads both into one company, each salary keeping the page it was read from. And a slug nobody can put a company to (`abracadabra`, `data-native-systems-sl`) is struck off in `lib.EXCLUDED_SLUGS`: never fetched, never discovered, refused by `validate.py`.

Companies with salaries are enriched from [Spain Tech Radar](https://www.spaintechradar.com) (`fetch_radar.py`, CC BY 4.0): offices with coordinates, stack, careers page, company type, CIF. It fills only empty fields, is matched by domain then LinkedIn then exact name — name matches are printed for review — and only companies with salaries are enriched, not the radar's whole 4,900-company inventory.

When two sources disagree, the order is: a value typed by hand, then the radar, then Levels.fyi. No fetcher overwrites a filled field, and a `-` cell means "checked, there is none", not missing.

Never include anything that identifies a person: no names, no team, no "the guy who joined in March". The CSV is public row by row, and the same field set applies: normalized values only. Anything the website or the API publishes on top is an aggregate of three people or more (`lib.MIN_GROUP`).

## Base salary versus total compensation

The 60k bar is base salary. Total compensation is base plus bonus plus annualised equity: a bigger number than base for the same job, shown beside it and never used against the bar.

## Currency

Levels.fyi publishes figures in **USD**; each page carries a `locationExchangeRate` that converts them to EUR, and that conversion is applied on the way in. A figure that skipped it would be roughly 16% too high, which is exactly what happened to all 141 bands `fetch_spain.py` wrote before 2026-09-09. The page's own FAQ text is the check: Glovo's Spanish median total of `79710.65` is published there as "€68,551".

The median record also carries the currency its author was paid in and the rate they typed it at, which round-trips to their exact figure: Glovo's median base of `64068.9615` at `0.85845` is exactly 55.000 €. That rate converts to *their* currency, so it is only used when that currency is EUR. Smile.io's submission was 105.000 USD at a rate of 1, and was listed as 105.000 € until 2026-09-15; it is 91.455 € at the page's rate.

Table rows carry their own currency and rate too and are converted the same way. Samples carry neither, so they go through the page's current rate, and an entry typed in euros years ago can drift a percent or two from what its author wrote.

## Why no salary data comes from company pages

A company page (`/companies/<slug>/salaries`) is **not filtered to Spain**. It shows that company's global figures, converted to whichever currency the reader's own location implies. `locationCurrency: EUR` therefore means nothing about where the money was earned: the Netherlands, Germany and Ireland are all euro countries too. [`scripts/fetch_company.py`](scripts/fetch_company.py) reads company details from it and nothing else.

Reading it as Spanish data put 682 foreign bands into this repository before it was caught: Booking.com's page reads EUR over Dutch figures, Adidas over United States figures, Revolut over British ones. A €367.000 product manager was the giveaway.

So the rule is: **a Levels.fyi source URL must name a location**, and `validate.py` fails the build otherwise.

It has had to be enforced twice. The first sweep removed the 682 bands above; a branch that had been cut before that sweep landed then carried 205 of them back in, across 27 companies, because the guard did not yet exist on it and the purge it did run matched on the wording of `notes` rather than on the URL. That is why the check lives in `validate.py`, where every branch and every pull request meets it, rather than in the fetcher that happens to be writing.

## Freshness

`reported` is the month an entry was submitted, and the README shows it, because a 2021 salary says less about today than a 2026 one. `date` is the day the entry was last read or confirmed; anything older than **365 days** is counted as stale in the README's summary line and shows up as a warning in `validate.py`.

Re-verifying is a real contribution: open the source, confirm the numbers, bump the date.
