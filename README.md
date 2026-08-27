# Spanish Top Tech Companies

Companies that pay software engineers 60.000 € gross a year or more to work from Spain.

<!-- BEGIN:STATS -->
**13 companies** · **288 salary bands** · 946 data points · newest data 2026-08-26
<!-- END:STATS -->

<!-- BEGIN:COMPANIES -->
| Company | Senior |
| --- | --- |
| [Datadog](https://www.levels.fyi/companies/datadog/salaries) | 109.5k* |
| [Celonis](https://www.levels.fyi/companies/celonis/salaries) | 105.6k |
| [Aily Labs](https://www.levels.fyi/companies/aily-labs/salaries) | 105.3k* |
| [N26](https://www.levels.fyi/companies/n26/salaries) | 91.8k |
| [Glovo](https://www.levels.fyi/companies/glovo/salaries) | 88.6k |
| [Microsoft](https://www.levels.fyi/companies/microsoft/salaries) | 88.5k* |
| [TomTom](https://www.levels.fyi/companies/tomtom/salaries) | 85.8k |
| [Amazon](https://www.levels.fyi/companies/amazon/salaries) | 84.3k* |
| [Semrush](https://www.levels.fyi/companies/semrush/salaries) | 71.7k* |
| [TravelPerk](https://www.levels.fyi/companies/travelperk/salaries) | 71.6k* |
| [FREE NOW](https://www.levels.fyi/companies/free-now/salaries) | 71.1k* |
| [Adevinta](https://www.levels.fyi/companies/adevinta/salaries) | 64.8k |
| [T-Systems](https://www.levels.fyi/companies/t-systems/salaries) | 64.1k* |

<sub>Gross annual base, software engineers. `*` on 8 of 13 rows means the figure is an all-seniority median, not a senior-specific one. Company names link to levels.fyi.</sub>
<!-- END:COMPANIES -->

## How to read this

Figures are **gross annual base salary in euros**, before IRPF and social security. Click a company to see the full breakdown on levels.fyi: per-level bands, total compensation, equity, and how many people reported each number.

A company is listed when its median reaches 60.000 €. The median decides, not the top of the range, so one unusual offer is not enough to get a company on the list.

Whether that money reaches you as a Spanish payroll salary, through an employer of record, or as a contractor rate changes what actually lands in your account. Those are different units and this table does not distinguish them — [METHODOLOGY.md](METHODOLOGY.md) explains why that matters.

## Adding a company

Send a pull request adding or editing one file in [`data/companies/`](data/companies/), or open an [issue](../../issues/new/choose) if you would rather not write YAML. Both are fine, and you can contribute anonymously.

The table above is generated. Do not edit it by hand; edit the data and run the build:

```bash
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
python3 scripts/validate.py && python3 scripts/build.py
```

CI runs both on every pull request and will tell you if the table is out of sync with the data.

Full instructions are in [CONTRIBUTING.md](CONTRIBUTING.md). The rules about sources, levels and what we will not publish are in [METHODOLOGY.md](METHODOLOGY.md).

There is also a backlog of companies that have not been researched yet in [`data/backlog.csv`](data/backlog.csv). Claiming one of those is the easiest way to help.

## Data

The table is the short version. Every band, level, source and date is in the exports, rebuilt on every change:

- [`exports/companies.csv`](exports/companies.csv) — one row per company, role and level
- [`exports/companies.json`](exports/companies.json) — the full records

### Attribution

Compensation bands marked `levels.fyi` are retrieved through the official [Levels.fyi Compensation API](https://www.levels.fyi/api-access/) and stored as aggregate percentiles with a link back to the source page.

> Data source: Levels.fyi (https://www.levels.fyi)

Their data is crowdsourced from people who submit their own compensation, and its reuse is governed by the [Levels.fyi Data License](https://www.levels.fyi/offerings/data/).

## Licence

Code is [MIT](LICENSE). The dataset is [CC BY-SA 4.0](LICENSE-DATA): use it, credit the repository, keep it open.

## Caveats

These are ranges reported by other people, not offers anyone is guaranteed. Sample sizes are small, sources disagree, and a band from two years ago may be meaningless today. Check the date on levels.fyi before using any of this in a negotiation.
