# Working context

Read this before touching the data pipeline. Several things about Levels.fyi
are counter-intuitive and cost a lot of time to discover: one has been paid for
twice, and one put every figure on the front page 16% over the truth.

## What this repository is

What companies in Spain pay software engineers with 5 or more years of
experience, on average, counting only salaries of 60.000 € or more in base.
Three things follow from that and all are load bearing:

- **Spain only.** A German salary in this list is worse than no salary, because
  the whole point is that other sources mix countries.
- **Averages of qualifying salaries only.** `companies.csv` keeps one row per
  engineer; the README shows one row per company, the mean of that company's
  salaries on file. Nothing else goes into the mean: an all-levels median, a
  ladder mean or an engineer under 5 years or under 60k answers a different
  question.
- **Seniority is years of experience.** 5 or more (`lib.SENIOR_YEARS`),
  whatever the company calls the level.

### How that rule was reached, 2026-09-15 and 16

Over two days the list went through four versions, and the maintainer rejected
the first three:

1. The best rung at senior or above per company, falling back to an
   all-levels figure and to other job families. Rejected: "we just need to
   track the software engineer roles" and "we cannot just do the average with
   many people".
2. Only ladder rungs or submissions whose names said senior. Rejected: "it
   doesnt matter if its not marked as senior. If it has more than 5 years we
   consider it senior." It had thrown away all 21 of Glovo's qualifying
   engineers because Glovo's ladder runs L1 to L5.
3. Every Spanish software engineer submission with 5+ years and a 60k+ base,
   each as its own README row. Kept as the data, but the maintainer wanted one
   row per company: "One entrie per company".
4. That company's mean over those same salaries. A mean over every 5+ year
   engineer, including those under 60k, was proposed and rejected: "you just
   need to calculate the avg for each company, with all the data entries for
   that company with 60k+ 5 years +". This one stands.

The entries come from the `samples` and `median` records on each company's
Spain page (trap 2). CONTEXT used to say individual submissions were not
reachable from the server HTML; the samples inside `averages` are.

The list publishes individual submissions, so to keep entries from pointing at
a person the fetcher stores no submission id, exact day, job title,
specialisation or years at company.

### The README is the product

The maintainer's words: the product is the repo's front page, not the CSV and
not the code. Every company, every salary and every link is in `README.md`.
Nothing a reader would want lives only in a side file.

This was learned the hard way. On 2026-09-11 the table was slimmed to one
figure per company with "the full data is in `exports/`", beside 243 YAML
files, a backlog CSV, a benchmarks JSON and two exports. On 2026-09-14 the
maintainer called that wrong, and it was rebuilt the other way round:

- `README.md`: every salary for every company, generated.
- `companies.csv`: the only data file. One row per salary, the company's own
  columns repeated on each of its rows, and a single row with the salary
  columns empty for a company with none.

Do not move salaries out of the README to make it shorter, and do not split the
CSV into per-company files or add a second data file.

### The standard the maintainer wants

A row should eventually mean: *I know someone in Spain doing this job and what
they earn, or they offered me the position.* Nothing on the list meets that yet:
every salary is crowdsourced from Levels.fyi. First-hand entries sort above
everything else, so the list visibly converges on the standard as they are
added, and the Source column names them.

Recording one: copy one of the company's rows in `companies.csv` (or add a row
with `company` and `linkedin_ids` for a new one), set `base`,
`years_experience`, `source` and `date`, and put the contract type in `notes`.
`community` = someone told you. `offer-letter` = you were offered it. Neither
needs a `source_url`. Then `python3 scripts/validate.py && python3 scripts/build.py`.

## Current state

```
261 companies · 104 with a qualifying salary · 452 salaries
```

- `companies.csv`: 609 rows. 452 salaries across 104 companies, reported
  between 2020-09 and 2026-09; 183 of them in the last twelve months.
- 157 companies have none: 43 whose Spanish engineers all fall short of the
  years or the pay, 95 with no Spanish data at all, and 19 the resolver never
  found a Levels.fyi page for.
- The README has two sections: one row per company with the average of its
  qualifying salaries, best average first, and the companies with nothing
  qualifying.
- Every company links to LinkedIn and to its open roles in Spain, and every
  salary to the Spain-scoped page it was read from.
- All entries were read from Levels.fyi on 2026-09-15.

How the move to one CSV was checked, 2026-09-14: all 299 YAML figures, all 242
backlog LinkedIn ids and every company field were compared with the CSV, and
the ranked figure, source link and LinkedIn link of all 261 companies matched
the old README exactly. Two things changed on purpose. `meta.yml` was a
duplicate of `facebook.yml`, figure for figure, and was folded into it. Six
employers filed under two LinkedIn ids (Amazon and AWS, Google and DeepMind,
Adevinta and Adevinta Spain, Allianz and Allianz Technology, Meta, Compound)
now keep both, and their jobs link searches both.

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

**2. The per-location page answers in three voices.**
On `/companies/<slug>/salaries/software-engineer/locations/spain`:

- `averages` — the company's own ladder, scoped to the location asked for. One
  entry per rung with a **mean** base and total, a submission count, and up to
  twenty `samples`: individual submissions, each with a city, years of
  experience, level, offer date and pay. **The samples are where the list's
  entries come from**, and they went unread for the first month of this
  project. A rung's `count` is usually higher than its samples; the rest are
  not published. Amazon's SDE I lists 20 samples against a count of 27.
- `percentiles` — an aggregate across every level. Falls back to another
  country when the Spanish sample is below their publication threshold.
  `percentiles.locationName` names the country **actually served**. Never an
  entry.
- `median` — one real submission for the location requested. **Stays Spanish
  even when the aggregate has given up**, and is often the only submission a
  small company has. It is frequently also one of the samples, so entries are
  deduplicated on `uuid`.

Every submission names its city, which is the guard that matters: a sample
outside Spain is skipped whatever page it came from. `locationMeta` is useless
as a guard — it just echoes the URL back.

`yearsOfExperience` is a number on samples and sometimes a bucket on the median
(`5-10`, `11+`). A bucket counts from its low end.

**3. A sample count does not mean a published figure.**
Some companies return `sampleSize > 0` with `locationName: null`, every
percentile `0`, and `estimatedSalary` all `null`. Alan is one: 2 submissions
each for engineering-manager, data-scientist and product-designer, and no
number attached to any of them. Levels.fyi has the data and does not publish
it. The individual submissions table on the site renders client-side and is not
reachable from the server HTML — only that one `median` record is.

So "the site shows salaries for this company" and "the pipeline can read an
entry" are different claims, and the second is often false.

`generatedOccupationSchema.sampleSize` looks like the Spanish submission count
and is not one. It equals the sum of the `averages` counts when there are
averages, and the **company's global count** when there are none: Amadeus
reports 429 next to an empty `averages` and a page that reads "Not enough
data". Only the `averages` counts are Spanish, and the list stores no counts
at all now.

**4. Every money field in the payload is USD.**
The page prints euros by multiplying by `locationExchangeRate`, and its own FAQ
text proves it: Glovo's Spanish median total of `79710.65` appears there as
"€68,551", which is `79710.65 x 0.86`.

METHODOLOGY.md had said this from the beginning and the country-page fetcher
had always done it. `fetch_spain.py` was written afterwards and did not, so all
141 bands it wrote went into files that said EUR at roughly 116% of the truth —
Glovo's headline read 84.2k where the site says 72.4k. Nothing caught it: the
numbers were plausible, they were Spain-scoped, and they passed every guard,
because the guards were all about *where* the money was earned and none about
what it was denominated in.

The lesson is narrower than the last two and worth stating anyway: a rule that
lives only in prose is not enforced. This one is now a case in
`tests/test_pipeline.py`, which asserts the two published euro figures above.

The median record also carries its own unrounded `exchangeRate`, and it
round-trips to the figure the person actually typed: Glovo's median base of
`64068.9615` at `0.85845` is exactly 55.000 €, where the page-wide rate rounded
to two places says 55.099 €. But that rate converts to the currency the person
was paid in, named in `baseSalaryCurrency`. Smile.io's was USD at a rate of 1,
and until 2026-09-15 its 105.000 USD was listed as 105.000 €; at the page's
rate it is 91.455 €. Use the record's rate only when its currency is EUR.
Samples carry no rate, so they use the page's, and an old euro salary can
drift a percent or two.

## Scripts

| Script | What it does | Safe? |
| --- | --- | --- |
| `fetch_spain.py` | Qualifying salaries in Spain, per company. Reads every sample and the median record, keeps Spanish ones with 5+ years and a 60k+ base, converts USD to EUR, records LinkedIn, deletes any entry whose source URL names no location, and leaves a company alone when its page cannot be read. | **Use this** |
| `fetch_company.py` | Company details only: website, HQ, headcount, sector, vesting. Writes no salary at all, by design. Only fills companies already in the CSV. | Yes |
| `resolve_slugs.py` | Company name → Levels.fyi slug, with verification and an alias table. Folds a company into the one already holding its slug. | Yes |
| `build.py` | Regenerates the README and rewrites `companies.csv` in canonical order. | Yes |
| `validate.py` | Column checks and sanity checks, including the location guard, the software-engineer page guard and the `spain_check` contradiction guard. | Yes |

`lib.py` is the only code that reads or writes `companies.csv`. Writes go to a
temporary file first, because an interrupted fetch must not truncate the only
copy of the data.

All Levels.fyi fetching **must run from Spain** — the pages are IP-scoped.

Rate limiting: 403/405/429/503 all mean throttled. Treating them as "not found"
is what originally wrote 56 false `unmatched` rows into the old backlog. Keep
`--delay` at 2.5s or more.

## Known gaps

- **157 companies have no qualifying salary.** 43 have Spanish submissions,
  but nobody with both 5 years and a 60k base. 95 have nothing Spanish at all,
  which is a fact about Levels.fyi's coverage of Spain, not about whether the
  company pays well here; a first-hand entry or a job ad (source #3 in
  METHODOLOGY.md) is the only way to reach them. 19 have no Levels.fyi page.
- **Not every submission is published.** A rung's samples stop short of its
  count, so a company can have more qualifying engineers than the list shows.
- **Old salaries.** Entries go back to 2020-09. The README shows the month, but
  nothing is dropped for age.
- **No first-hand data yet.** Every salary is crowdsourced. The repository's own
  standard is not met by a single row, which is the biggest gap on this list.
- **Duplicate slugs.** Levels.fyi files some employers twice (`meta` and
  `facebook` serve the same data). `companies.csv` holds one row group per
  employer and `validate.py` rejects a slug used twice; the list uses
  `facebook` for Meta.

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
