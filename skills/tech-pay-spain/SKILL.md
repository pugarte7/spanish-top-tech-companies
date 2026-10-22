---
name: tech-pay-spain
description: Answer what jobs pay in Spain (salario, sueldo, cuánto se cobra) by role, region, years of experience or company, from medians of real Spanish salaries. Use for salary questions, offer checks and negotiation prep about jobs in Spain.
license: CC-BY-SA-4.0
metadata:
  source: https://github.com/pugarte7/spanish-top-tech-companies
---

# Tech Pay Spain

Medians of yearly gross salaries in euros of people working in Spain, from
Levels.fyi submissions and first-hand reports. Every figure comes from 5 or
more people, the middle half from 10, and euro figures are rounded to the
nearest 1,000.

## Getting the numbers

1. If the `tech-pay-spain` MCP server is connected (remote: the site's `/mcp`,
   Streamable HTTP, no sign-in), use its tools:
   - `salary_stats(role, region, years)`: median base, middle half, median total, share at 60k+.
   - `top_companies(role, region, years, search, limit)`: companies ranked by median base.
   - `company_salaries(name)`: one company, overall and by role, region and years.
   - `list_filters()`: valid role slugs, region codes, experience buckets, data date.
2. Otherwise run it from a clone of the repository and talk to it over stdio:
   `python3 scripts/mcp_server.py` (Python 3.10+, no dependencies).
3. Without a shell, fetch `/llms-full.txt` from the published site for the
   national, per-role, per-region and per-experience tables, or
   `/api/v1/data.json` for every selection.

## Reading them right

- Base is gross yearly salary; total adds bonus and stock. Say which one you quote.
- Quote the median and the middle half (p25 to p75), never a mean.
- Experience is years, in buckets 0-1, 2-4, 5-7, 8-11, 12-19, 20+. "Senior"
  means years of experience, not a job title.
- No result means fewer than 5 people match. Widen the selection (drop the
  region, then the years) and say you did; never estimate a figure.
- Spain only. Do not mix in figures from other countries.
- Only companies whose median base over all their salaries reaches a floor
  (`company_floor_eur` in `list_filters`) are counted, so figures leave out
  the lowest-paying employers. Say so when quoting a figure for Spain.
- Give the data date and cite "Tech Pay Spain (Levels.fyi and first-hand
  reports), CC BY-SA 4.0".
- Answer in the user's language. Region names work in Spanish or English
  (Madrid, Cataluña, Catalonia, MD, CT).
