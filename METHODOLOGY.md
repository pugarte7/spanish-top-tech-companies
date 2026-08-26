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

**levels.fyi bands come through their official API, never by scraping.** [`scripts/fetch_levels.py`](scripts/fetch_levels.py) calls the documented [Compensation API](https://www.levels.fyi/api-access/) and stores aggregate percentiles only: never their individual submission rows.

Bands retrieved that way use the **interquartile range**: `min` is the 25th percentile and `max` is the 75th. Using p10–p90 would make every company look like it pays anything to anyone.

Levels.fyi requires attribution on derived work, and their Data License governs what may be republished. Holding an API key is not by itself permission to redistribute, so check the terms before adding bulk-fetched data.

Their level names are per-company (`L4`, `IC3`, `Senior Engineer`). The fetcher maps them onto our ladder by name, falling back to seniority order when the name says nothing, and records the original in `notes` so a wrong guess is visible and fixable.

Never include anything that identifies a person: no names, no team, no "the guy who joined in March". A band with `sample_size: 1` is fine; a band that points at someone is not.

## Levels and the `all` aggregate

A band at level `all` is a median across every seniority, which is what Levels.fyi's public country pages publish. It is a weaker signal than a per-level band: a company with a high `all` figure may simply employ more senior people. Treat it as a starting point and replace it with per-level data when someone has it.

## Base salary versus total compensation

The 60k threshold applies to `base` when we know it. Where a company is known only through an aggregate that publishes total compensation, the threshold falls back to `total_comp`, because leaving the company out entirely would be less useful than listing it with the caveat visible. The tables print base and total compensation in separate columns, so which figure a row rests on is always visible: a row with `—` under *Base salary* rests on total comp.

Total compensation is base plus bonus plus annualised equity. It is a bigger number than base for the same job. Do not compare the two columns to each other.

## Freshness

`last_verified` is the day a human last confirmed the band, not the day it was first added. Anything older than **365 days** renders as ⚠️ in the README and shows up as a warning in `validate.py`.

Re-verifying is a real contribution: open the source, confirm the numbers, bump the date.

## Canonical role slugs

Use these so the tables stay comparable. Anything else validates but warns.

`data-engineer` · `analytics-engineer` · `data-scientist` · `data-analyst` · `machine-learning-engineer` · `ai-engineer` · `software-engineer` · `backend-engineer` · `frontend-engineer` · `fullstack-engineer` · `mobile-engineer` · `platform-engineer` · `devops-engineer` · `sre` · `security-engineer` · `qa-engineer` · `engineering-manager` · `data-engineering-manager` · `product-manager` · `product-designer`

## Levels

`intern` · `junior` · `mid` · `senior` · `staff` · `principal` · `lead` · `manager` · `director`

Map the company's internal ladder onto these rather than inventing new ones. If a company's "L5" is what everyone else calls senior, it goes in as `senior` and the internal name goes in `notes`.
