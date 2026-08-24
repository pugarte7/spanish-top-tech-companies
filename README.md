# Spanish Top Tech Companies

Companies that pay **60.000 € gross or more, per year, to people working from Spain** — with the actual bands, the source they came from, and the date they were last checked.

Not a list of Spanish companies. A list of employers who put that money into a Spanish contract, whether they're headquartered in Madrid, have a hub in Barcelona, or hire you fully remote from Valencia through an employer of record.

<!-- BEGIN:STATS -->
**0 companies** above 60k · **0 salary bands** · 0 stale · 243 companies still unresearched · updated 2026-08-25
<!-- END:STATS -->

## What gets in

- Pays at least **60.000 € gross annual base** to at least one documented role and level, for someone living and working in Spain.
- Every band has a **source** and a **`last_verified` date**. Bands older than a year are marked ⚠️ rather than quietly left to rot.
- We use the **median**, not the top of the range — one outlier offer doesn't put a company on this list.

Full rules, including what "gross annual" means here and how contract type changes what actually reaches your bank account, are in [METHODOLOGY.md](METHODOLOGY.md).

## Companies

<!-- BEGIN:COMPANIES -->
_No companies documented yet._ Copy `data/companies/_template.yml`, fill it in, and run `python3 scripts/build.py`.
<!-- END:COMPANIES -->

## By role

<!-- BEGIN:BY_ROLE -->
_Nothing to show yet._
<!-- END:BY_ROLE -->

## Using the data

The tables above are generated. The source of truth is one YAML file per company in [`data/companies/`](data/companies/), and every build also writes:

- [`exports/companies.csv`](exports/companies.csv) — one row per company / role / level
- [`exports/companies.json`](exports/companies.json) — the full records

```bash
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
python3 scripts/validate.py && python3 scripts/build.py
```

## Contributing

Adding a company or a band is a pull request that touches one file, or an [issue form](../../issues/new/choose) if you'd rather not write YAML. Both are welcome, and you can contribute anonymously — see [CONTRIBUTING.md](CONTRIBUTING.md).

There are still **unresearched companies** sitting in [`data/backlog.csv`](data/backlog.csv). Claiming one is the easiest way to help.

## Caveats

These are ranges reported by other people, not offers you are guaranteed. Sample sizes are small, sources disagree, and a band from 2024 may be meaningless today. Check the `n` and the date before you use any of this in a negotiation.

## License

Code is [MIT](LICENSE). The dataset is [CC BY-SA 4.0](LICENSE-DATA) — use it, but credit this repo and keep it open.
