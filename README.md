# Spanish Top Tech Companies

A list of companies that pay 60.000 € gross per year or more to people working from Spain, with the salary bands, where they came from, and when they were last checked.

<!-- BEGIN:STATS -->
**0 companies** · **0 salary bands** · 0 data points · 243 companies not yet researched · last updated 2026-08-26
<!-- END:STATS -->

## Why

Salary information in Spain is scattered and mostly anecdotal. Aggregators like levels.fyi have good data but thin coverage of the Spanish market, job ads publish ranges so wide they say nothing, and Glassdoor mixes Spanish and foreign salaries for the same company without distinguishing them.

At the same time, "60k in Spain" is not one number. It depends on whether you are on a Spanish payroll, employed through an intermediary, or invoicing as a contractor. Those are different amounts of money in your account at the end of the month and they are usually quoted as if they were the same.

This list tries to fix both problems: put the bands somewhere public, and record enough context that you can tell what they actually mean.

It is not a job board. Links to careers pages are included because they are useful, but the point of the list is the compensation data, not the openings.

## What gets listed

A company is listed when at least one documented role and level reaches **60.000 € gross annual base salary** for someone living and working in Spain.

Both Spanish and foreign companies qualify. What matters is that the money reaches somebody on a Spanish contract, whether that is a company headquartered in Madrid, a foreign company with an office in Barcelona, or a fully remote employer hiring through an employer of record.

Every band needs a source and a date. Bands that have not been checked in over a year are marked as stale rather than quietly left to age.

## How to read the numbers

- All figures are **gross annual base salary in euros**, before IRPF and social security, however many payments the contract splits it into. Bonus, equity and total compensation have their own columns.
- The **median** decides whether a company is listed, not the top of the range. One unusual offer is not enough.
- **Data points** is how many salaries the band is built from. A band with three data points is a rumour with a decimal place. Treat single digits with suspicion.
- **Contract** matters as much as the number. A contractor rate and a payroll salary are not the same unit. See [METHODOLOGY.md](METHODOLOGY.md).

## Companies

<!-- BEGIN:COMPANIES -->
_No companies documented yet._ Copy `data/companies/_template.yml`, fill it in, and run `python3 scripts/build.py`.
<!-- END:COMPANIES -->

## Salary data

<!-- BEGIN:SALARIES -->
_No salary data yet._
<!-- END:SALARIES -->

## By role

<!-- BEGIN:BY_ROLE -->
_Nothing to show yet._
<!-- END:BY_ROLE -->

## Company details

<!-- BEGIN:PROFILES -->
_Nothing to show yet._
<!-- END:PROFILES -->

## Adding a company

Send a pull request adding or editing one file in [`data/companies/`](data/companies/), or open an [issue](../../issues/new/choose) if you would rather not write YAML. Both are fine, and you can contribute anonymously.

The tables above are generated. Do not edit them by hand; edit the data and run the build:

```bash
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
python3 scripts/validate.py && python3 scripts/build.py
```

CI runs both on every pull request and will tell you if the tables are out of sync with the data.

Full instructions are in [CONTRIBUTING.md](CONTRIBUTING.md). The rules about sources, levels and what we will not publish are in [METHODOLOGY.md](METHODOLOGY.md).

There is also a backlog of companies that have not been researched yet in [`data/backlog.csv`](data/backlog.csv). Claiming one of those is the easiest way to help.

## Data

Machine-readable exports are rebuilt on every change:

- [`exports/companies.csv`](exports/companies.csv) — one row per company, role and level
- [`exports/companies.json`](exports/companies.json) — the full records

### Attribution

Compensation bands marked `levels.fyi` are retrieved through the official [Levels.fyi Compensation API](https://www.levels.fyi/api-access/) and stored as aggregate percentiles with a link back to the source page.

> Data source: Levels.fyi (https://www.levels.fyi)

Their data is crowdsourced from people who submit their own compensation, and its reuse is governed by the [Levels.fyi Data License](https://www.levels.fyi/offerings/data/).

## Licence

Code is [MIT](LICENSE). The dataset is [CC BY-SA 4.0](LICENSE-DATA): use it, credit the repository, keep it open.

## Caveats

These are ranges reported by other people, not offers anyone is guaranteed. Sample sizes are small, sources disagree, and a band from two years ago may be meaningless today. Check the data points and the date before using any of this in a negotiation.
