# Methodology

## Who counts

The list shows **what each company pays, on average**, the software engineers on file for it. The data underneath is individual salaries: one software engineer in Spain, what they are paid, and how many years of experience they have. A salary is on file when all of these hold:

- **A software engineer.** Levels.fyi's software-engineer family only: engineering managers, data scientists, product managers and every other job family are out.
- **In Spain.** The submission names a Spanish city.
- **Senior, meaning 5 or more years of experience.** The level name does not matter. Companies call the same job L4, SDE II, IC3 or Senior, and an L4 with eight years is as senior as anyone; a "Senior" with two years is not. A bucket like `5-10` counts from its low end, so it qualifies, and `2-4` does not.
- **60.000 € or more in base salary.** Gross annual base, not total compensation.

The README then shows one row per company: the mean base salary and mean total compensation of its salaries on file, and how many salaries that is. Only qualifying salaries go into the mean. Nobody under 5 years or under 60k pulls it down, and Levels.fyi's own figures, an all-levels median or a ladder mean, are never used, because they mix juniors in with everyone else. A company is on the list only while it has at least one qualifying salary on file, or a first-hand one; one whose Spanish engineers all fall short, or that Levels.fyi has nothing Spanish for, is not listed at all.

An average of one salary is one person's pay, so read the Engineers column before the number.

The Share column puts the average in proportion: how many of the company's software engineers in Spain on Levels.fyi are the ones averaged. The fetcher stores how many Spanish submissions it read for each company (`spain_submissions`), qualifying or not, and the README divides the qualifying ones by it. "3% of 63" at BBVA says 63 engineers reported and two reach the bar, so 60k+ with 5 years is possible there and unlikely; "100% of 4" says everyone who reported does. Only Levels.fyi entries count towards the share, since the denominator is Levels.fyi's; a first-hand entry belongs to no submission set. For the largest employers the denominator is the 250 most recent submissions, the most the API returns.

This rule was set on 2026-09-16. Earlier versions of the list published Levels.fyi's per-company averages across levels, every job family, only rungs whose names said senior, and every qualifying salary as its own row. All of those were replaced.

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

Only one page carries a software engineer's own submission in Spain: a company's software-engineer page for the location, `/companies/<slug>/salaries/software-engineer/locations/spain`. [`scripts/fetch_spain.py`](scripts/fetch_spain.py) reads it, and `validate.py` rejects a Levels.fyi entry citing any other page.

The page carries submissions in three places:

- The **"Latest Salary Submissions" table** under the figures: every submission for that company, job family and country. The browser fills it from Levels.fyi's API using the visitor's own session, and shows an anonymous visitor a wall of asterisks instead. Since 2026-09-21 the fetcher reads this table with the maintainer's session, and it is where most entries come from.
- `averages`, the company's ladder embedded in the public page, lists up to twenty `samples` per level, each with a city, years of experience and pay. Only some companies get one.
- `median` is one more submission embedded in the page, and for most companies the only one an anonymous visitor can read.

Fever is the case that showed the difference. Its public page embedded one record, an L3 with six years at 48.7k, and the README said "none with 5+ years at 60k+"; the table had 29 Spanish software engineers, ten of them qualifying, with a Staff engineer at 90k base. Twenty-two companies were in the same state.

The API caps the table at 250 rows, newest first, so for the very largest employers a few old submissions are out of reach. `percentiles`, an aggregate across every level, is never an entry.

Each entry keeps the company, base, total compensation, years of experience, the level as its author filed it, the city and the month it was submitted. It deliberately leaves out the submission id, the exact day, the job title, the specialisation and the years at the company: together with a company and a city, those start to point at a person.

### An entry must prove it is Spanish

Levels.fyi does not refuse a location it has no data for. Ask a company page for Spain and, if nobody in Spain has submitted for that employer, it quietly answers with another country: Germany for Celonis and N26, the Netherlands for Adyen and TomTom, the United States for a great many more. The page currency is no defence, because every euro-zone country returns EUR.

Every submission names its city, and [`scripts/fetch_spain.py`](scripts/fetch_spain.py) skips any outside Spain, whatever page it came from. It also deletes any entry whose source URL names no location. `locationMeta` is not a substitute: it only echoes the URL back.

A company with nothing Spanish that qualifies is not listed. Listing another country's pay under its name would be worse than the gap, and that is the one thing this repository exists to get right.

### Which companies are on the list

A company is on the list only while it has a salary on file. Until 2026-09-21 a company with nothing sat under the table as "no Spain data" or "none with 5+ years at 60k+", 112 of them; the maintainer removed the section and the rows. The fetcher now removes a company that comes back empty unless a `community` or `offer-letter` entry vouches for it, and `validate.py` fails the build on an empty row that has stayed.

Companies get on the list by discovery. Each signed-in run reads Levels.fyi's country-wide feed, the newest 250 Spanish software-engineer submissions, about three months' worth, and fetches every employer in it that is not on file yet. So adding a salary on Levels.fyi is the whole submission process: a company nobody has heard of here gets its row the first time one of its engineers in Spain qualifies. A company can also be added by hand as a `Name,linkedin_id` row and fetched with `--company`; the row lasts only if something qualifies.

Never include anything that identifies a person: no names, no team, no "the guy who joined in March".

## Base salary versus total compensation

The 60k threshold is base salary. Total compensation is base plus bonus plus annualised equity: a bigger number than base for the same job, shown beside it and never used to qualify an entry.

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
