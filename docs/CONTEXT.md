# Working context

Read this before touching the data pipeline. Several things about Levels.fyi
are counter-intuitive and cost a lot of time to discover: one has been paid for
twice, and one put every figure on the front page 16% over the truth.

## What this repository is

A list of tech companies that pay senior software engineers 60.000 € a year or
more to work **from Spain**. Two things follow from that and both are load
bearing:

- **Spain only.** A German salary in this list is worse than no salary, because
  the whole point is that other sources mix countries.
- **Senior and above.** An all-seniority median includes juniors and answers a
  different question.

### The README is the product

The maintainer's words: the product is the repo's front page, not the CSV and
not the code. Every company, every salary figure and every link is in
`README.md`. Nothing a reader would want lives only in a side file.

This was learned the hard way. On 2026-09-11 the table was slimmed to one
figure per company with "the full data is in `exports/`", beside 243 YAML
files, a backlog CSV, a benchmarks JSON and two exports. On 2026-09-14 the
maintainer called that wrong, and it was rebuilt the other way round:

- `README.md`: every figure for every company, generated.
- `companies.csv`: the only data file. One row per salary figure, the
  company's own columns repeated on each of its rows, and a single row with
  the salary columns empty for a company with none.

Do not move figures out of the README to make it shorter, and do not split the
CSV into per-company files or add a second data file.

### The standard the maintainer wants

A row should eventually mean: *I know someone in Spain doing this job and what
they earn, or they offered me the position.* Nothing on the list meets that yet:
every figure is crowdsourced from Levels.fyi. First-hand entries sort above
everything else, so the list visibly converges on the standard as they are
added, and the Source column names them.

Recording one: copy one of the company's rows in `companies.csv` (or add a row
with `company` and `linkedin_ids` for a new one), set `role`, `level`,
`base_p50`, `source` and `date`, and put the contract type in `notes`.
`community` = someone told you. `offer-letter` = you were offered it. Neither
needs a `source_url`. Then `python3 scripts/validate.py && python3 scripts/build.py`.

## Current state

```
261 companies · 117 paying 60k+ · 159 with pay on file · 298 salary figures
```

- `companies.csv`: 400 rows. 298 are figures across 159 companies, 102 are
  companies with none: 83 that Levels.fyi was asked about and published nothing
  Spanish for, and 19 the resolver never found a Levels.fyi page for.
- The README has three sections: *60k and above* (117 companies), *Under 60k*
  (42) and *No pay on file* (102). Each paid company lists every figure it has,
  its best job family first, and the one it is ranked by is bold.
- Every company links to LinkedIn and to its open roles in Spain, and every
  figure to the Spain-scoped page it was read from.

How the move to one CSV was checked, 2026-09-14: all 299 YAML figures, all 242
backlog LinkedIn ids and every company field were compared with the CSV, and
the ranked figure, source link and LinkedIn link of all 261 companies matched
the old README exactly. Two things changed on purpose. `meta.yml` was a
duplicate of `facebook.yml`, figure for figure, and was folded into it. Six
employers filed under two LinkedIn ids (Amazon and AWS, Google and DeepMind,
Adevinta and Adevinta Spain, Allianz and Allianz Technology, Meta, Compound)
now keep both, and their jobs link searches both. The resolver's "matched as"
notes and `benchmarks.json`, neither of which reached the page, were dropped.

On 2026-09-11 the ranked figure became the **highest** rung at senior or above
rather than the first one that counts as senior, and a company with no
software-engineer figure at all started falling back to its best other job
family. That took 103 companies over 60k to 117. It also moved Amazon from its
senior rung (88.9k, 10 submissions) to its principal one (125.3k, 2): the bold
figure answers "the best senior-or-above rung pays this", not "you get this on
reaching senior".

The senior rungs and the sample counts arrived on 2026-09-09, when `averages`
was finally read (trap 2 below). The count of companies over 60k **fell** from
112 to 103 in the same pass, because every figure until then was USD wearing a
euro sign (trap 4).

## The four traps in Levels.fyi data

**1. A company page silently serves another country.**
`/companies/<slug>/salaries` is scoped by the caller's IP and falls back to the
company's home country when there are no Spanish submissions. An early guard
checked only that the page currency was EUR, which Germany, the Netherlands,
France and Ireland all pass. That put Dutch salaries on Adyen and TomTom,
German ones on Celonis, N26, FREE NOW and T-Systems, and US ones elsewhere.

This has now been enforced twice, and the second time is the instructive one.
The first sweep removed 682 foreign bands and added the guard in `validate.py`.
But the branch carrying all the Spain work had been cut *before* that sweep
landed, so it never received either, and it carried 205 of those bands back in
across 27 companies. Its own purge missed them for two independent reasons: it
only ran for companies where no Spanish figure was found (so any company that
did have one kept its foreign bands beside it), and it matched on the wording of
`notes` rather than on the source URL, which caught `reports this as` while
missing `Median across all levels` and `Common Range Average across all levels`
— 173 of the 205.

Both holes are closed, and the lesson is in where the fix lives: **the check
that matters is in `validate.py`**, because that is the one every branch and
every pull request has to pass. A guard that lives only in the fetcher protects
only the data that fetcher happens to write.

A guard also only bites if the build actually fails on it, and this one did not.
CI ran `python3 scripts/validate.py | tee validate.log`, and GitHub's default
shell is `bash -e` with no `pipefail`, so the step reported `tee`'s exit code
rather than validate's and stayed green no matter what validate found. The
workflow now sets `shell: bash`, which turns `pipefail` on. Worth remembering
before piping anything else in that file.

**2. The per-location page answers in three voices, and they disagree.**
On `/companies/<slug>/salaries/software-engineer/locations/spain`:

- `averages` — the company's own ladder, scoped to the location asked for. One
  entry per rung with a **mean** base and total, a submission count, and every
  name that rung answers to. **This is the richest source on the page and it
  went unread for the first month of this project.** It is the only one that
  says which rung a figure belongs to, so the only one that can produce a
  senior salary. Amazon serves a *United States* aggregate next to 50 Spanish
  submissions filed here across four rungs.
- `percentiles` — an aggregate. Falls back to another country when the Spanish
  sample is below their publication threshold. `percentiles.locationName` names
  the country **actually served**, which is the only reliable guard.
- `median` — one real submission for the location requested. **Stays Spanish
  even when the aggregate has given up.**

Each covers companies the others miss, so read all three. The aggregate alone
was 43 companies; adding `median` took it to 140; adding `averages` took it to
149 and turned 49 of those from an all-seniority blur into a measured senior
rung.

`averages` rungs are named by the company, not by seniority: `sde-iii`, `L3`,
`Grade 10`, `VS 2`. Each rung carries several titles and only one of them may
say what it is — Amazon's senior rung is `sde-iii`, `L6` **and** `Senior SDE` —
so search all of them. A rung whose names say nothing stays unmapped; there is
no fallback to ladder position, because "Glovo's L3 is probably senior" is a
guess and guesses are indistinguishable from measurements once they are in the
file.

`locationMeta` is useless as a guard — it just echoes the URL back.

**3. A sample count does not mean a published figure.**
Some companies return `sampleSize > 0` with `locationName: null`, every
percentile `0`, and `estimatedSalary` all `null`. Alan is one: 2 submissions
each for engineering-manager, data-scientist and product-designer, and no
number attached to any of them. Levels.fyi has the data and does not publish
it. The individual submissions table on the site renders client-side and is not
reachable from the server HTML — only that one `median` record is.

So "the site shows salaries for this company" and "the pipeline can read a
figure" are different claims, and the second is often false.

`generatedOccupationSchema.sampleSize` looks like the Spanish submission count
and is not one. It equals the sum of the `averages` counts when there are
averages, and the **company's global count** when there are none: Amadeus
reports 429 next to an empty `averages` and a page that reads "Not enough
data". Only the `averages` counts are a Spanish sample size, which is why a
band built from anything else carries none.

**4. Every money field in the payload is USD.**
The page prints euros by multiplying by `locationExchangeRate`, and its own FAQ
text proves it: Glovo's Spanish median total of `79710.65` appears there as
"€68,551", which is `79710.65 x 0.86`.

METHODOLOGY.md had said this from the beginning and `fetch_levels_public.py`
had always done it. `fetch_spain.py` was written afterwards and did not, so all
141 bands it wrote went into files that said EUR at roughly 116% of the truth —
Glovo's headline read 84.2k where the site says 72.4k. Nothing caught it: the
numbers were plausible, they were Spain-scoped, and they passed every guard,
because the guards were all about *where* the money was earned and none about
what it was denominated in.

The lesson is narrower than the last two and worth stating anyway: a rule that
lives only in prose is not enforced. This one is now a case in
`tests/test_pipeline.py`, which asserts the two published euro figures above.

A submission record also carries its own unrounded `exchangeRate`, and it
round-trips to the figure the person actually typed: Glovo's median base of
`64068.9615` at `0.85845` is exactly 55.000 €, where the page-wide rate rounded
to two places says 55.099 €. Use the record's rate for a single submission and
the page's for an aggregate.

## Scripts

| Script | What it does | Safe? |
| --- | --- | --- |
| `fetch_spain.py` | Per-company Spain pay. Verifies Spain, converts USD to EUR, writes a figure per named ladder rung plus one `all` figure, records LinkedIn, deletes any figure whose source URL names no location. `--role` reads any other job family. | **Use this** |
| `fetch_levels_public.py` | Spain country pages (`/t/<role>/locations/spain`). Genuinely Spain-scoped but lists only ~10 companies per role/location, so it is mostly for finding companies. Never overwrites a company-page or first-hand figure. | Yes |
| `fetch_company.py` | Company details only: website, HQ, headcount, sector, vesting. Writes no salary at all, by design. Only fills companies already in the CSV. | Yes |
| `resolve_slugs.py` | Company name → Levels.fyi slug, with verification and an alias table. Folds a company into the one already holding its slug. | Yes |
| `build.py` | Regenerates the README and rewrites `companies.csv` in canonical order. | Yes |
| `validate.py` | Column checks and sanity checks, including the location guard and the `spain_check` contradiction guard. | Yes |

`lib.py` is the only code that reads or writes `companies.csv`. Writes go to a
temporary file first, because an interrupted fetch must not truncate the only
copy of the data.

All Levels.fyi fetching **must run from Spain** — the pages are IP-scoped.

Rate limiting: 403/405/429/503 all mean throttled. Treating them as "not found"
is what originally wrote 56 false `unmatched` rows into the old backlog. Keep
`--delay` at 2.5s or more.

## Known gaps

- **102 companies have no figure.** For 83 of them Levels.fyi publishes nothing
  Spanish under `software-engineer`, no ladder, no aggregate, not even one
  submission. That is a fact about Levels.fyi's coverage of Spain, not about
  whether the company pays well here. The other 19 have no Levels.fyi page.

  The 93 companies with no software-engineer figure on 2026-09-10 were then
  asked for up to six other job families (`software-engineering-manager`,
  `data-scientist`, `product-manager`, `solution-architect`,
  `hardware-engineer`, `data-analyst`). **Nine answered**: Analog Devices and
  BCG with a small ladder, D-EDGE, HP, NovaKid, TransPerfect and Vestas with an
  aggregate, McKinsey and PepsiCo with one submission. Those nine, plus NCC
  Group through a country page, are ranked by that other family. The other 83
  have nothing Spanish under any family asked, and `spain_check_roles` lists
  every family that was, so the row can say so. Do not re-run that sweep
  hoping for a different answer; run it again in six months, or go at these
  companies through job ads, which is source #3 in METHODOLOGY.md and the only
  way to reach them. A figure from an ad goes in as a row with `source`
  `job-posting`.
- **No first-hand data yet.** Every figure is crowdsourced. The repository's own
  standard is not met by a single row, which is the biggest gap on this list.
- **Duplicate slugs.** Levels.fyi files some employers twice (`meta` and
  `facebook` serve the same data). `companies.csv` holds one row group per
  employer and `validate.py` rejects a slug used twice; the list uses
  `facebook` for Meta.
- **Warnings.** 0 errors, 0 warnings as of 2026-09-14.

## Commands

```bash
python3 scripts/fetch_spain.py --delay 3.0        # ~14 min, 242 companies
python3 scripts/fetch_spain.py --audit            # report, write nothing
python3 tests/test_pipeline.py
python3 scripts/validate.py && python3 scripts/build.py
```

No dependencies: everything is the Python standard library.

`tests/test_pipeline.py` runs first in CI. Every case in it is a bug this
repository actually shipped, so a failure there means one of them is back rather
than that the test needs updating.

`build.py` is idempotent; CI rebuilds and fails if the result differs from
what is committed, so always commit the regenerated `README.md` and
`companies.csv`.

## Conventions

Commit messages are at most five words, no AI co-author trailers. PR
descriptions are brief and human, no em dashes.
