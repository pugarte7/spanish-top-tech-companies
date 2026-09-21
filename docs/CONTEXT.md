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

The entries come from the signed-in submissions table (trap 5) and from the
`samples` and `median` records embedded in each company's Spain page (trap 2).
CONTEXT used to say individual submissions were not reachable from the server
HTML; the samples inside `averages` are, and the table is reachable with a
session token.

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
261 companies · 149 with a qualifying salary · 1468 salaries
```

- `companies.csv`: 1580 rows. 1468 salaries across 149 companies, reported
  between 2020-01 and 2026-09; 392 of them in the last twelve months.
- 112 companies have none: 21 whose Spanish engineers all fall short of the
  years or the pay, 72 with no Spanish data at all, and 19 the resolver never
  found a Levels.fyi page for.
- The README has two sections: one row per company with the average of its
  qualifying salaries, best average first, and the companies with nothing
  qualifying.
- Every company links to LinkedIn and to its open roles in Spain, and every
  salary to the Spain-scoped page it was read from.
- All entries were read from Levels.fyi on 2026-09-21, signed in (trap 5).
  The signed-in read took the list from 452 salaries at 104 companies to
  these figures in one run.

How the move to one CSV was checked, 2026-09-14: all 299 YAML figures, all 242
backlog LinkedIn ids and every company field were compared with the CSV, and
the ranked figure, source link and LinkedIn link of all 261 companies matched
the old README exactly. Two things changed on purpose. `meta.yml` was a
duplicate of `facebook.yml`, figure for figure, and was folded into it. Six
employers filed under two LinkedIn ids (Amazon and AWS, Google and DeepMind,
Adevinta and Adevinta Spain, Allianz and Allianz Technology, Meta, Compound)
now keep both, and their jobs link searches both.

## The five traps in Levels.fyi data

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
it on the page. The individual submissions table renders client-side and is not
in the server HTML — only that one `median` record is. The table is reachable
another way (trap 5).

So "the site shows salaries for this company" and "the pipeline can read an
entry" are different claims, and without a session the second is often false.

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
drift a percent or two. Table rows (trap 5) carry a rate and currency like the
median does.

**5. The public page is a subset. The table is behind a sign-in.**
Under the figures on every company page sits "Latest Salary Submissions", a
table of every submission for that company, job family and country. It is not
in the server HTML: the browser loads it from
`api.levels.fyi/v3/salary/search` with the visitor's Cognito id token as a
Bearer, and answers an anonymous request with 401. A fresh headless Chrome
confirmed what the anonymous visitor sees: `****** *****, ** | ****/**/**`
and "Unlock by Adding Your Salary!".

The maintainer, who works at Fever and had added a salary, could see 29
Spanish software engineers there. The page embedded one, an L3 with six years
at 48.7k, so the README said "none with 5+ years at 60k+" about a company with
ten who qualified and a Staff engineer at 90k. Twenty-two companies were in
that state (`Spain (aggregate)`), with Levels.fyi's own aggregate showing 60k+
bases existed at Aily Labs, Manychat, Perk, Factorial, Clarity AI, Fever,
Exoticca and Cabify.

Since 2026-09-21 `fetch_spain.py` reads the table when a token is in
`LEVELS_TOKEN` or `~/.config/levels/token`. The token is `localStorage.auth`
on levels.fyi while signed in, a Cognito id token good for about a day. What
the API does:

- Query: `companySlug`, `jobFamilySlug=software-engineer`,
  `countryIds[0]=226` (Spain), `offset`, `limit` (max 50, 400 above it),
  `sortBy=offer_date`, `sortOrder=DESC`. `total` caps at 250.
- Answer: `{"payload": "<base64>"}`. AES-128-ECB, key = first 16 characters
  of base64(MD5("levelstothemoon!!")), then zlib, then JSON with `total`,
  `hidden`, `rows`. The site's own JavaScript does the same unwrapping; it is
  obfuscation, and the token is the actual access control. openssl does the
  AES because the standard library has none.
- Each row looks like the `median` record: `uuid`, `location`, `level`,
  `yearsOfExperience` (number or bucket), `baseSalary` in USD, `exchangeRate`,
  `baseSalaryCurrency`, `offerDate`. Rows repeat the page's median and samples,
  so the uuid dedupe matters. `level` is sometimes the string `"False"`.
- Headers that work: `Authorization: Bearer`, `x-agent: levelsfyi_website`, the
  browser User-Agent. A bare `Mozilla/5.0` got HTTP 402. 401 is an expired
  token. `X-RateLimit-Limit: 25` over a short window; 2.5s between requests
  never came close.

A company whose table could not be read is left untouched, page and all:
writing the page's one record in its place would delete last run's table
entries. The label for a full table read is `Spain (table)`, and it is the only
label the README renders as "none with 5+ years at 60k+"; the page-only labels
render as "none published", because they are a statement about what an
anonymous visitor sees, not about the company.

Two things to know before running it. This is against Levels.fyi's terms and
the account used can be closed; the maintainer chose it knowingly. And the
token is a live login: never commit it, never print it, and rotate it (sign
out and in) if it has been pasted anywhere it should not have been.

## Scripts

| Script | What it does | Safe? |
| --- | --- | --- |
| `fetch_spain.py` | Qualifying salaries in Spain, per company. Reads the signed-in submissions table when a token is present, plus every sample and the median record on the page; keeps Spanish ones with 5+ years and a 60k+ base, converts USD to EUR, records LinkedIn, deletes any entry whose source URL names no location, and leaves a company alone when its page or table cannot be read. | **Use this** |
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

- **112 companies have no qualifying salary.** 21 have Spanish submissions,
  but nobody with both 5 years and a 60k base. 72 have nothing Spanish at all,
  which is a fact about Levels.fyi's coverage of Spain, not about whether the
  company pays well here; a first-hand entry or a job ad (source #3 in
  METHODOLOGY.md) is the only way to reach them. 19 have no Levels.fyi page.
- **The table caps at 250 rows.** Amazon and Glovo both hit it, so their
  oldest submissions are out of reach. Without a token the fetcher is back to
  the public page's subset and labels the result as such.
- **Old salaries.** Entries go back to 2020-01. The README shows the month, but
  nothing is dropped for age.
- **No first-hand data yet.** Every salary is crowdsourced. The repository's own
  standard is not met by a single row, which is the biggest gap on this list.
- **Duplicate slugs.** Levels.fyi files some employers twice (`meta` and
  `facebook` serve the same data). `companies.csv` holds one row group per
  employer and `validate.py` rejects a slug used twice; the list uses
  `facebook` for Meta.

## Commands

```bash
python3 scripts/fetch_spain.py --delay 3.0        # ~25 min with a token, 242 companies
python3 scripts/fetch_spain.py --audit            # report, write nothing
python3 tests/test_pipeline.py
python3 scripts/validate.py && python3 scripts/build.py
```

No dependencies: everything is the Python standard library, plus the
`openssl` binary for the table's AES (trap 5), present on macOS and Linux.

`tests/test_pipeline.py` runs first in CI. Every case in it is a bug this
repository actually shipped, so a failure there means one of them is back rather
than that the test needs updating.

`build.py` is idempotent; CI rebuilds and fails if the result differs from
what is committed, so always commit the regenerated `README.md` and
`companies.csv`.

## Conventions

Commit messages are at most five words, no AI co-author trailers. PR
descriptions are brief and human, no em dashes.
