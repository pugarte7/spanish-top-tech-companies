# Methodology

## The threshold

A company is listed when **at least one documented role and level reaches 60.000 € gross annual base salary** for someone working from Spain.

"Reaches" means the **median** (`base.p50`). If a submission only has a min and a max, the midpoint is used. Never the max — otherwise a single unusual offer would be enough to list a company that pays most people far less.

Base salary only. Bonus and equity are recorded separately (`bonus_pct`, `equity`) because they are far less reliable and much harder to compare.

`total_comp` is optional and sits alongside `base`. It exists because levels.fyi reports total compensation as its headline figure, so a band copied from there would otherwise be misread as base. Never put a total-comp number in the `base` field.

## What "gross annual" means here

Total gross for the year, **before IRPF and social security**, across however many payments the contract splits it into. If a company pays 14 payments of 4.500 €, that is 63.000 € and it goes in as 63000.

Excluded from the number: ticket restaurant, health insurance, remote stipends, and anything else in `perks`. They matter, they're recorded, they are not salary.

## Why contract type is a field

Three people can all be told "70k" and take home very different amounts:

| `contract` | What it means |
| --- | --- |
| `spanish-payroll` | A Spanish contract with a Spanish entity. Social security is the employer's problem. |
| `eor` | Employed through an intermediary (Deel, Remote, Oyster…). Usually fine, but benefits and severance are the EOR's, not the company's. |
| `contractor` | You invoice them. The gross number is not comparable to a payroll gross. |
| `freelance` | Autónomo. Quota, IVA, and your own holidays come out of that number. |

A contractor rate and a payroll salary are different units. Don't compare them without adjusting.

## Sources

Every band needs at least one source. In rough order of how much we trust them:

1. `offer-letter` — someone had it in writing
2. `levels.fyi`, `company-published` — aggregated or official
3. `job-posting` — a published range, usually the band's full width
4. `community` — reported directly to this repo
5. `glassdoor`, `other` — treat with suspicion

**Every levels.fyi band on file today was read from their public pages, not from their API.** Only aggregate percentiles, per-rung averages and published medians are stored, never their individual submission rows. [`scripts/fetch_levels.py`](scripts/fetch_levels.py) speaks the documented [Compensation API](https://www.levels.fyi/api-access/) instead, which needs a key and would give per-level Spanish ladders — but nothing here has come through it yet, so treat that script as untested.

Bands that carry a range use the **interquartile range**: `min` is the 25th percentile and `max` is the 75th. Using p10–p90 would make every company look like it pays anything to anyone.

### A band must prove it is Spanish

Levels.fyi does not refuse a location it has no data for. Ask a company page for Spain and, if nobody in Spain has submitted for that employer, it quietly answers with another country: Germany for Celonis and N26, the Netherlands for Adyen and TomTom, the United States for a great many more. The page currency is no defence, because every euro-zone country returns EUR.

The per-location page carries `percentiles.locationName`, which names the country actually served rather than the one requested. [`scripts/fetch_spain.py`](scripts/fetch_spain.py) writes a band only when that field says Spain, and deletes any band whose source URL names no location — whether or not the company also has a Spanish figure of its own, because a Spanish software-engineer band says nothing about the Dutch product-designer band filed beside it. `locationMeta` is not a substitute: it only echoes the URL back.

A company with no Spanish figure is listed with no figure. That is the honest answer, and it is the one thing this repository exists to get right.

### Recording that there was nothing to find

"No figure" and "nobody has looked" are different facts and the table says which. When Levels.fyi answers a Spain-scoped page with nothing, the fetcher writes `spain_check` on the company:

```yaml
spain_check:
  date: '2026-09-10'
  roles: [software-engineer, data-scientist, product-manager]
  served: United States        # what came back instead, or 'no data'
```

The front page turns that into a **no Spain data** row linking to the page that came back empty, instead of a dash. A role leaves `roles` the moment it produces a Spanish band, and `validate.py` fails the build if a file ever claims both at once — this is a structural field precisely so the table never has to guess from the wording of a note.

A company with no `spain_check` and no bands is one nobody has been able to look up; those show as dashes, and as `not on Levels.fyi` where the resolver could not find a page at all.

Levels.fyi requires attribution on derived work, and their Data License governs what may be republished. Holding an API key is not by itself permission to redistribute, so check the terms before adding bulk-fetched data.

Their level names are per-company (`L4`, `IC3`, `Senior Engineer`), and each rung carries several: Amazon's senior rung is filed as `sde-iii` and also answers to `L6` and `Senior SDE`. The fetcher searches every one of them and maps the rung onto our ladder when a name says what it is, recording the original in `notes` so a wrong call is visible and fixable.

A rung whose names say nothing — `L3`, `Software Engineer II`, `Grade 10` — is left unmapped, and there is no fallback to ladder position. Deciding that Glovo's L3 is a senior engineer would be a guess, and a guess filed as data is indistinguishable from a measurement once it is in the file. Those companies get an `all` band instead.

Never include anything that identifies a person: no names, no team, no "the guy who joined in March". A band with `sample_size: 1` is fine; a band that points at someone is not.

## Levels and the `all` aggregate

The front page shows the **highest** rung a company publishes at senior or above, not the cheapest rung that counts as senior. Amazon files 88.909 € at senior and 125.275 € at principal, and the table shows the second. A measured rung always beats the all-seniority band, even when the band is the larger number: Unity's senior rung is 58.4k and its all-levels mean 70.7k, and reporting the mean as senior pay would trade a measurement for an average.

A company Levels.fyi publishes nothing for under `software-engineer` falls back to its best other job family, with that family printed beside the figure. Ten rows read that way today — data scientists at BCG, engineering managers at HP, a security analyst at NCC Group. The list is about engineers, so software engineering wins whenever there is any figure for it at all, however much larger another family's is.

A band at level `all` spans every seniority, so it is a weaker signal than a per-level band: a company with a high `all` figure may simply employ more senior people. Treat it as a starting point and replace it with per-level data when someone has it.

Four different things can be the figure shown, and `_computed.headline_kind` in [`exports/companies.json`](exports/companies.json) says which one a company's is:

| `headline_kind` | What the number is |
| --- | --- |
| `senior` | A measured senior rung from a company that publishes a level-by-level ladder for Spain. The strongest figure here. |
| `quartile` | The 75th percentile of Levels.fyi's Spanish interquartile aggregate. The closest this data gets to a senior figure without naming one. |
| `spread` | Every Spanish submission at that company averaged together, weighted by how many sit at each rung. Written when the ladder has Spanish data but none of its rung names says which is senior, so there is no quartile to take. |
| `single` | One person's reported salary. Not a band at all. |

The front page prints the figure and nothing else — the four used to carry a footnote mark each, which made the table harder to read than the distinction was worth. It lives in the exports now.

## Base salary versus total compensation

The 60k threshold applies to `base` when we know it. Where a company is known only through an aggregate that publishes total compensation, the threshold falls back to `total_comp`, because leaving the company out entirely would be less useful than listing it with the caveat visible. The tables print base and total compensation in separate columns, so which figure a row rests on is always visible: a row with `—` under *Base salary* rests on total comp.

Total compensation is base plus bonus plus annualised equity. It is a bigger number than base for the same job. Do not compare the two columns to each other.

## Where the Levels.fyi figures come from

Three public surfaces, none needing a key:

- **Per-location company pages** (`/companies/<slug>/salaries/<role>/locations/spain`) are where most figures now come from. Alone among the three they publish base salary next to total compensation, name the country actually served, and carry a per-rung ladder for the location asked about — the only public surface that can produce a senior salary rather than an all-seniority blur. [`scripts/fetch_spain.py`](scripts/fetch_spain.py) reads them.
- **Job-family pages** (`/t/<role>/locations/spain`) give Spain-wide percentiles and a top-paying-companies table. One median per company, across all levels, so those land at level `all`.
- **Company pages** (`/companies/<slug>/salaries`) give company details only here: website, careers page, LinkedIn, headquarters, headcount, industry, vesting.

Figures are published in **USD**; each page carries a `locationExchangeRate` that converts them to EUR, and that conversion is applied on the way in. A band that skipped it would be roughly 16% too high — which is exactly what happened to all 141 bands `fetch_spain.py` wrote before 2026-09-09, because that script was written after this rule and did not follow it. The page's own FAQ text is the check: Glovo's Spanish median total of `79710.65` is published there as "€68,551".

A submission record also carries its own unrounded `exchangeRate`, and that one round-trips to the figure the person actually typed in — Glovo's median base of `64068.9615` at `0.85845` is exactly 55.000 €, where the page-wide rate rounded to two places would say 55.099 €. Use the record's rate for a single submission and the page's for an aggregate.

### Why no salary data comes from company pages

A company page is **not filtered to Spain**. It shows that company's global figures, converted to whichever currency the reader's own location implies. `locationCurrency: EUR` therefore means nothing about where the money was earned — the Netherlands, Germany and Ireland are all euro countries too.

Reading it as Spanish data put 682 foreign bands into this repository before it was caught: Booking.com's page reads EUR over Dutch figures, Adidas over United States figures, Revolut over British ones. A €367.000 product manager was the giveaway.

So the rule is: **a Levels.fyi source URL must name a location**, as `/t/<role>/locations/spain` and `/companies/<slug>/salaries/<role>/locations/spain` both do. `validate.py` enforces it and fails the build otherwise.

It has had to be enforced twice. The first sweep removed the 682 bands above; a branch that had been cut before that sweep landed then carried 205 of them back in, across 27 companies, because the guard did not yet exist on it and the purge it did run matched on the wording of `notes` rather than on the URL. That is why the check lives in `validate.py`, where every branch and every pull request meets it, rather than in the fetcher that happens to be writing.

## Freshness

`last_verified` is the day a human last confirmed the band, not the day it was first added. Anything older than **365 days** renders as ⚠️ in the README and shows up as a warning in `validate.py`.

Re-verifying is a real contribution: open the source, confirm the numbers, bump the date.

## Canonical role slugs

Use these so the tables stay comparable. Anything else validates but warns.

`data-engineer` · `analytics-engineer` · `data-scientist` · `data-analyst` · `machine-learning-engineer` · `ai-engineer` · `software-engineer` · `backend-engineer` · `frontend-engineer` · `fullstack-engineer` · `mobile-engineer` · `platform-engineer` · `devops-engineer` · `sre` · `security-engineer` · `qa-engineer` · `engineering-manager` · `data-engineering-manager` · `product-manager` · `product-designer`

## Levels

`intern` · `junior` · `mid` · `senior` · `staff` · `principal` · `lead` · `manager` · `director`

Map the company's internal ladder onto these rather than inventing new ones. If a company's "L5" is what everyone else calls senior, it goes in as `senior` and the internal name goes in `notes`.
