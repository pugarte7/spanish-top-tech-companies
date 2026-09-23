# Working context

Read this before touching the data pipeline. Several things about Levels.fyi
are counter-intuitive and cost a lot of time to discover: one has been paid for
twice, and one put every figure on the front page 16% over the truth.

## What this repository is

What companies in Spain pay software engineers with 5 or more years of
experience: the median over every such engineer on file, and the share of them
at 60.000 € or more in base, at companies where the median is; companies with
a median between 50k and 60k are shown apart, under "Need to improve". Three things
follow from that and all are load bearing:

- **Spain only.** A German salary in this list is worse than no salary, because
  the whole point is that other sources mix countries.
- **The median over every senior; the bar is applied to the median.**
  `companies.csv` keeps one row per engineer with 5+ years, paid whatever they
  are paid; the README shows one row per company, the median of those rows
  and the share of them at 60k+. Nothing else goes into the median: an
  all-levels figure, a ladder mean or an engineer under 5 years answers a
  different question. And nothing is trimmed from it: the 60k-filtered mean was
  tried and is why readers called the list cherry-picked.
- **Seniority is years of experience.** 5 or more (`lib.SENIOR_YEARS`),
  whatever the company calls the level, and with no upper limit.

### How that rule was reached, 2026-09-15, 16 and 22

Over two days the list went through four versions, the maintainer rejected the
first three, and a week later readers overturned the fourth:

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
   that company with 60k+ 5 years +".
5. The median over every 5+ year engineer, with the 60k bar deciding which
   companies are listed and shown as the share at 60k+. The maintainer posted
   the list on Reddit on 2026-09-22 and was told "use all the data and cut
   outliers" and that "si cortas los salarios por debajo de 60, todas las
   empresas donde al menos una persona cobre más de 60 van a parecer
   competitivas". Both correct: Minsait read 90k off two engineers while its
   fourteen seniors under 60k were not on file. The maintainer proposed a
   median and a 15-year cap; the numbers showed the cap changed no company's
   median by more than 2k, and the median over all seniors (Minsait 43.5k,
   BBVA 55k, Fever 66k, Glovo 75k, Revolut 87k) was the honest figure. The
   maintainer chose it, kept "only competitive companies" as the listing rule,
   and declined a minimum number of data points.
6. The listing rule itself. Version 5 listed a company if *any* senior was at
   60k+, which kept BBVA (median 55k) and Minsait (43.5k) on the list, at the
   bottom. The same reader: "el filtro de posiciones lo haces antes de
   calcular el promedio, pero el filtro de empresas lo tenés que hacer
   después", with the pseudocode
   `companies.map(|d| d.filter(yoe >= 5).median()).filter(|m| m >= 60k)`.
   The maintainer agreed the same day: a company is listed while its seniors'
   median base is at 60k+. 33 companies left (EPAM 53k, eDreams 52k,
   Thoughtworks 53.7k, adidas 48.9k, Ocado 57.9k, Freenow 59.8k, BBVA, Minsait,
   Accenture, Inditex...), 164 stayed, and "At 60k+" is 50% or more on the
   main table.
7. A second table. "I don't wanna lose all those companies": on 2026-09-23 the
   24 of the 33 with a median of 50k or more came back under "Need to
   improve", same columns, so a reader sees them and sees they are under 60k.
   `lib.FLOOR_EUR` = 50k decides what is on file at all; the nine under it
   (Accenture, Minsait, Inditex, NTT DATA, adidas, GFT, Ericsson, Atos, BSC)
   are gone. This one stands.

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

## Last run

The list has no fixed size: it is whatever the last signed-in run found.
The README's stats line is the authoritative count; this is the run behind it.

- 2026-09-22, signed in (trap 5), every company on file plus discovery (trap
  6): 259 employers read, none unreachable. 161 companies with a median at
  60k+ and 24 under "Need to improve" (50k to 60k), 2112 engineers with 5+
  years on file at them, 1551 of those at 60k+, reported between 2018-11 and
  2026-09. `companies.csv` has one row per senior and nothing else. The run
  read 197 companies with at least one senior at 60k+ (2236 rows); the 33
  with a median under the bar were dropped when the listing rule changed that
  evening, and on 2026-09-23 the 24 at 50k+ came back as the second table,
  Tiger Data was folded into Timescale, and Abracadabra and Data Native
  Systems were struck off. Earlier on the 22nd, under the 60k-filtered rule,
  the same 197 companies had 1575 rows.
- The day before, 2026-09-21, the list went from 452 salaries at 104 companies
  (public pages only) to 1468 at 149, and 112 companies with nothing on file
  were removed: 72 with nothing Spanish on Levels.fyi, 19 with no Levels.fyi
  page, 21 whose Spanish engineers all fall short. The maintainer's rule: "get rid of the companies
  that don't have Spanish data and I have not said that I know that they pay
  that", then "remove the nothing qualifies part". Discovery then turned up
  107 employers with a recent Spanish submission that had never been on file,
  43 of which had someone qualifying.
- The README is one table: one row per company with the median over its
  seniors, how many there are, and "At 60k+", the share of them at the bar.
  The share was added 2026-09-22 (first over every submission, juniors
  included, then over seniors only once the median rule landed) so BBVA's six
  of thirteen read as "happens, not the norm" rather than as a peer of
  companies where everyone is at the bar. Rows sorted by that share first for
  a day ("sorted first by ratio, then by salary", 2026-09-22); once the median
  decided the table and every main-table share was 50%+, that put one-person
  60k rows above N26 at 76.6k with 47 engineers ("the sorting is wrong"), so
  since 2026-09-23 they sort by median base first, then share; first-hand rows
  still come first. Every salary links to the Spain-scoped page it was read
  from; companies link to LinkedIn and to their open roles in Spain when a
  LinkedIn id or URL is known, which the discovered ones mostly are not yet.

How the move to one CSV was checked, 2026-09-14: all 299 YAML figures, all 242
backlog LinkedIn ids and every company field were compared with the CSV, and
the ranked figure, source link and LinkedIn link of all 261 companies matched
the old README exactly. Two things changed on purpose. `meta.yml` was a
duplicate of `facebook.yml`, figure for figure, and was folded into it. Six
employers filed under two LinkedIn ids (Amazon and AWS, Google and DeepMind,
Adevinta and Adevinta Spain, Allianz and Allianz Technology, Meta, Compound)
now keep both, and their jobs link searches both.

## The six traps in Levels.fyi data

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
data". Only the `averages` counts are Spanish, and the list stores no count
at all: the share at 60k+ is computed from the rows, which since 2026-09-22
are every senior read.

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
ten at 60k+ and a Staff engineer at 90k. Twenty-two companies were in
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
entries. The label for a full table read is `Spain (table)`; the other labels
in the run report mean the page's subset was all that could be read.

Two things to know before running it. This is against Levels.fyi's terms and
the account used can be closed; the maintainer chose it knowingly. And the
token is a live login: never commit it, never print it, and rotate it (sign
out and in) if it has been pasted anywhere it should not have been.

**6. The list only knows the companies it already has. Discovery fixes that.**
`targets()` reads slugs from `companies.csv`, so once the empty rows were
removed, a Netflix engineer in Spain adding a salary would never have been
seen. The same API without `companySlug` is a country-wide feed: the newest
250 Spanish software-engineer submissions, about three months' worth (July to
September 2026 on the day it was first read). Every signed-in full run reads
it and fetches each employer not on file; on 2026-09-21 that was 107
employers, most of them Spanish consultancies and small shops the hand-made
list had never heard of. That is what makes the README's "add your salary on
Levels.fyi and it gets picked up" true.

Two things about those employers. Levels.fyi answers 404 for the *page* of an
employer with a submission or two (42 of the 107), while the table still
returns them, so `spain_data()` reads the table alone when the page is gone;
rows carry their own euro rate, and a row in another currency is the only
thing the missing page rate costs. And they arrive with no LinkedIn id, so
their company name is plain text and the jobs cell is a dash until someone
fills `linkedin_ids` or `linkedin_url` by hand. A few feed rows carry `False`
for both company fields; they name nothing and are skipped.

## Scripts

| Script | What it does | Safe? |
| --- | --- | --- |
| `fetch_spain.py` | Senior salaries in Spain, per company. With a token, reads the country-wide feed for employers not yet on file, then each company's signed-in submissions table plus every sample and the median record on its page; keeps Spanish ones with 5+ years whatever the pay, converts USD to EUR, records LinkedIn, deletes any entry whose source URL names no location, removes a company whose median comes back under 60k unless a first-hand entry vouches for it, and leaves a company alone when its page or table cannot be read. | **Use this** |
| `fetch_company.py` | Company details only: website, HQ, headcount, sector, vesting. Writes no salary at all, by design. Only fills companies already in the CSV. | Yes |
| `resolve_slugs.py` | Company name → Levels.fyi slug, with verification and an alias table. Folds a company into the one already holding its slug. | Yes |
| `build.py` | Regenerates the README and rewrites `companies.csv` in canonical order. | Yes |
| `validate.py` | Column checks and sanity checks, including the location guard, the software-engineer page guard, and that every company has a salary on file. | Yes |

`lib.py` is the only code that reads or writes `companies.csv`. Writes go to a
temporary file first, because an interrupted fetch must not truncate the only
copy of the data.

All Levels.fyi fetching **must run from Spain** — the pages are IP-scoped.

Rate limiting: 403/405/429/503 all mean throttled. Treating them as "not found"
is what originally wrote 56 false `unmatched` rows into the old backlog. Keep
`--delay` at 2.5s or more.

## Known gaps

- **A company with its median under 50k is invisible.** Accenture has 16
  Spanish seniors on Levels.fyi at a median of 43k, Minsait 16 at 43.5k, and
  the list says nothing about them. Between 50k and 60k a company is shown
  under "Need to improve". A first-hand entry or a job ad (source #3 in
  METHODOLOGY.md) does not change that unless it moves the median.
- **One-person medians.** Nothing stops a company with a single senior on
  file from topping the table at "100% (1)". A minimum of three was offered
  and declined on 2026-09-22; the Engineers column is the reader's guard.
- **Discovery reaches three months back.** The feed caps at 250 rows. An
  employer whose only Spanish submission is older than that, and that was
  never on file, stays unknown until someone there submits again or adds it
  by hand.
- **The table caps at 250 rows.** Amazon and Glovo both hit it, so their
  oldest submissions are out of reach. Without a token the fetcher is back to
  the public page's subset and labels the result as such.
- **Old salaries.** Entries go back to 2020-01. The README shows the month, but
  nothing is dropped for age.
- **No first-hand data yet.** Every salary is crowdsourced. The repository's own
  standard is not met by a single row, which is the biggest gap on this list.
- **Duplicate slugs.** Levels.fyi files some employers twice (`meta` and
  `facebook` serve the same page; Timescale renamed itself Tiger Data and
  got a second slug). `lib.SLUG_ALIASES` maps the alias to the canonical
  slug; `spain_data()` reads both, dedupes on uuid, files everything under
  the canonical company and keeps each row's own page URL. `validate.py`
  rejects a row group filed under an alias. Added 2026-09-23 when the
  maintainer asked for Timescale and Tiger Data to be one row; it also fixed
  Meta, whose `facebook` table is empty while `meta`'s is not.
- **Struck-off slugs.** `lib.EXCLUDED_SLUGS` holds slugs the maintainer
  removed with a reason (`abracadabra`, `data-native-systems-sl`: nobody could
  say what company they are). Never fetched, never discovered, refused by
  `validate.py`. Discovered employers also arrive without LinkedIn; ten were
  typed into the CSV by hand on 2026-09-23 and the fetcher never overwrites a
  `linkedin_url` on file. Paradigma Digital followed, and every company on file now links somewhere.

## Commands

```bash
python3 scripts/fetch_spain.py --delay 3.0        # ~30 min with a token: every company on file, plus discovery
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
