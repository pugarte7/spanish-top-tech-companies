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

**We link to sources, we do not copy them.** levels.fyi's terms don't allow republishing their dataset, so a `levels.fyi` source stores the aggregate band and a link to their page for that company. Don't paste their per-submission rows in.

Never include anything that identifies a person: no names, no team, no "the guy who joined in March". A band with `sample_size: 1` is fine; a band that points at someone is not.

## Freshness

`last_verified` is the day a human last confirmed the band, not the day it was first added. Anything older than **365 days** renders as ⚠️ in the README and shows up as a warning in `validate.py`.

Re-verifying is a real contribution: open the source, confirm the numbers, bump the date.

## Canonical role slugs

Use these so the tables stay comparable. Anything else validates but warns.

`data-engineer` · `analytics-engineer` · `data-scientist` · `data-analyst` · `machine-learning-engineer` · `ai-engineer` · `software-engineer` · `backend-engineer` · `frontend-engineer` · `fullstack-engineer` · `mobile-engineer` · `platform-engineer` · `devops-engineer` · `sre` · `security-engineer` · `qa-engineer` · `engineering-manager` · `data-engineering-manager` · `product-manager` · `product-designer`

## Levels

`intern` · `junior` · `mid` · `senior` · `staff` · `principal` · `lead` · `manager` · `director`

Map the company's internal ladder onto these rather than inventing new ones. If a company's "L5" is what everyone else calls senior, it goes in as `senior` and the internal name goes in `notes`.
