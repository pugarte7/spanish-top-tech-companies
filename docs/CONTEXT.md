# Working context

Read this before touching the data pipeline. Several things about Levels.fyi
are counter-intuitive and cost a lot of time to discover: one has been paid for
twice, and one put every figure on the front page 16% over the truth.

## What this repository is

What companies in Spain pay: the README answers it for software engineers
at any experience — the median over every such engineer on file, and the share of them at 60.000 € or more in base, at companies where
the median is; companies with a median between 50k and 60k are shown apart,
under "Need to improve". Since 2026-10-14 the file underneath holds every
Spanish submission in every Levels.fyi job family at every seniority, because
the same CSV feeds a website that answers it per role, specialization, title,
city, region and work arrangement. Three things follow from that and all are
load bearing:

- **Spain only.** A German salary in this list is worse than no salary, because
  the whole point is that other sources mix countries.
- **The median over every software engineer; the bar is applied to the
  median.** The README reads its slice through `lib.readme_entries()` —
  software-engineer rows with a base, any experience — and shows one row per
  company, the median of those rows and the share of them at 60k+. Nothing
  else goes into the median: an all-levels figure, a ladder mean or a product
  manager answers a different question. And nothing is trimmed from it: the
  60k-filtered mean was tried and is why readers called the list
  cherry-picked.
- **No experience cut since 2026-10-17.** Until then the README counted 5+
  years only. That cut existed because the old fetcher stored only seniors,
  which also made "5+ years earn 60k+" look like a finding when it was the
  sample. Once the feed carried every experience level the maintainer
  dropped it: "I think we no longer need to have the 5+ exp data. If they pay
  more than 60K lets count it in." Medians now include juniors and read
  lower than the seniors-only ones did.

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
   `lib.FLOOR_EUR` = 50k decided what was on file at all; the nine under it
   (Accenture, Minsait, Inditex, NTT DATA, adidas, GFT, Ericsson, Atos, BSC)
   were gone. The two-table rule stands; the on-file floor was lifted on
   2026-10-14, when the CSV became the website's dataset: a company now stays
   while it has any salary, and the floor only decides the README listing.
8. No experience cut. On 2026-10-17 the 5-year filter went: every software
   engineer on file counts toward the median, same bars, same two tables.
   Do not bring back a years filter without the maintainer asking for it.

The entries come from Levels.fyi's signed-in submissions API, read as one
country-wide feed per job family (traps 5 and 7). The earlier sources — the
`samples` and `median` records embedded in each company's Spain page (trap 2)
— are superseded by the feed, which carries the same submissions with more
fields.

The list publishes individual submissions, so the stored columns are the
normalized set in `lib.ENTRY_COLUMNS`: role, specialization and title are the
taxonomy's slugs or empty rather than free text, and a row still carries no
submission id, exact day, team, free-text title or years at company. The CSV
is public row by row; aggregates published elsewhere (the site, the MCP
server) exist only for groups of `lib.MIN_GROUP` people or more.

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
On `/companies/<slug>/salaries/<role>/locations/spain`:

- `averages` — the company's own ladder, scoped to the location asked for. One
  entry per rung with a **mean** base and total, a submission count, and up to
  twenty `samples`: individual submissions, each with a city, years of
  experience, level, offer date and pay. **The samples were where the list's
  entries came from**, and they went unread for the first month of this
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

Since 2026-10-14 none of these feeds the CSV — the signed-in feed (trap 7)
does, because it covers every role and keeps going past the page's subsets.
The page is still read once per role for its `locationExchangeRate`, the rate
for feed rows not paid in euros.

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
on levels.fyi while signed in, a Cognito id token good for about a day.

Since 2026-09-27 it mints that id token itself when
`~/.config/levels/refresh_token` exists, so a run needs nobody to paste one.
The site is Amplify v6 over Cognito pool `us-west-2_fUcfzSGdv`, web client
`76of0ich18hd8uehju7fniv2u1` (no client secret; both are the id token's `iss`
and `aud`), and it keeps the refresh token in localStorage under
`CognitoIdentityServiceProvider.76of0ich18hd8uehju7fniv2u1.<username>.refreshToken`.
`refreshed()` makes the call Amplify makes, `GetTokensFromRefreshToken`
against `cognito-idp.us-west-2.amazonaws.com`, and writes back a new refresh
token if the pool rotates them (it did not on 2026-09-27, so one refresh
token serves a laptop and CI alike). A refused refresh token (expired or revoked)
stops the run: falling back to the public page would replace every table
entry on file with the page's handful. Its lifetime is the pool's setting and
cannot be read off the token; it shows up as the day it is refused.
What the API does:

- Query: `companySlug` (empty for the country feed), `jobFamilySlug` (the
  role's slug), `countryIds[0]=226` (Spain), `offset`, `limit` (max 50, 400
  above it), `sortBy=offer_date`, `sortOrder=DESC`. `total` caps at 250 and
  lies — the API keeps serving rows past it (trap 7).
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

**6. The list only knows the companies it already has. The feed fixes that.**
`targets()` read slugs from `companies.csv`, so once the empty rows were
removed, a Netflix engineer in Spain adding a salary would never have been
seen. The same API without `companySlug` is a country-wide feed: every
Spanish submission in a job family, newest first. The old discovery pass read
its newest 250 rows — about three months — and fetched each employer not on
file; on 2026-09-21 that was 107 employers, most of them Spanish
consultancies and small shops the hand-made list had never heard of.

Since 2026-10-14 there is no discovery pass and no per-company loop: the feed
*is* the run. `feed()` reads one role to the end, `entries_by_company()`
files every employer it names, and `write_role()` replaces that role's stored
Levels.fyi rows per company — creating employers that were never on file.
That is what makes "add your salary on Levels.fyi and it gets picked up"
true, now for every role rather than software engineers only.

Two things about those employers. Levels.fyi answers 404 for the *page* of an
employer with a submission or two (42 of the 107 discovered in 2026-09),
while the feed still returns their rows — so a feed row's `source_url` can
point at a page that does not exist today, which validate.py accepts because
the URL still names the evidence's shape. And they arrive with no LinkedIn
id, so their company name is plain text and the jobs cell is a dash until
someone fills `linkedin_ids` or `linkedin_url` by hand. A few feed rows carry
`False` for both company fields; they name nothing and are skipped.

**7. The feed's `total` lies, and half a feed looks like deletions.**
The API answers `total: 250` at most but keeps serving rows past it — Amazon's
feed returned 100 more Spanish rows at offsets 250–349, and the data-scientist
feed gave 533 rows against a `total` of 250. `feed()` therefore pages until an
empty page, never until `total`, and a feed still answering after
`MAX_PAGES` (100) pages is treated as unread rather than complete. A page
that fails to load, or an answer that does not decrypt or parse, makes the
whole feed None: `write_role()` would otherwise read a truncated feed as
"these submissions were deleted".

That replacement is the other half of the model. `write_role()` drops the
role's stored Levels.fyi rows and writes the feed's — which is also how stale
rows leave — while first-hand entries and other roles' rows are never
touched. A company left with no rows at all is dropped; a hand-added row that
never had salaries survives. Companies are discovered with no LinkedIn id and
occasionally with a struck-off slug: `EXCLUDED_SLUGS` rows are skipped at
entry time, before they can be filed.

A feed row carries its own `exchangeRate` and `baseSalaryCurrency`, so euro
submissions convert back at their own rate to exactly the figure typed, and
non-euro rows go through the role page's `locationExchangeRate` — which is
all the public page is still read for. A row in a currency that cannot be
priced in euros is dropped and counted, never guessed.

## Scripts

| Script | What it does | Safe? |
| --- | --- | --- |
| `fetch_spain.py` | Every Spanish salary in every job family. With a token, reads each role's country-wide feed to the end — paging past the lying `total` — and replaces that role's stored Levels.fyi rows per company; keeps Spanish rows of any seniority whatever the pay, converts USD to EUR, normalizes role/specialization/title/location fields, deletes any entry whose source URL names no location, creates employers the feed names, drops a company left with no rows, and leaves everything untouched when a role's feed cannot be read. | **Use this** |
| `fetch_taxonomy.py` | Regenerates `taxonomy.py` from the public `/t` index: 129 roles, categories, specializations, titles and aliases. Generated file; do not edit by hand. | Yes |
| `fetch_radar.py` | Enriches salary-bearing companies from Spain Tech Radar's open dataset (offices, stack, careers page, type, CIF). Matches by domain, LinkedIn, then exact name; fills empty fields only. | Yes |
| `fetch_company.py` | Company details only: website, HQ, headcount, sector, vesting. Writes no salary at all, by design. Only fills companies already in the CSV. | Yes |
| `resolve_slugs.py` | Company name → Levels.fyi slug, with verification and an alias table. Folds a company into the one already holding its slug. | Yes |
| `build.py` | Regenerates the README and rewrites `companies.csv` in canonical order. | Yes |
| `validate.py` | Column checks and sanity checks, including the location guard, the role-page guard, and that every company has a salary on file. | Yes |
| `digest.py` | Markdown summary of what changed in `companies.csv` since a git revision (default `HEAD`), for the weekly issue. Rows have no submission id, so a new salary is a row that, minus its run date, was not there before. | Yes |
| `site.py` | Builds `_site/`: the page in Spanish and English, `/api/v1/data.json` (every aggregate of `lib.MIN_GROUP`+ people), `/llms.txt` and `/llms-full.txt` for agents that only read URLs. `SITE_URL` makes their links absolute. | Yes |
| `mcp_server.py` | MCP server (stdio, or stateless Streamable HTTP with `--http`) over `data.json` through `query.py`: `salary_stats`, `top_companies`, `company_salaries`, `list_filters`. Reads only the published aggregates, so it can never return a group under `MIN_GROUP`. `skills/tech-pay-spain/SKILL.md` tells agents (Hermes, any agentskills.io client) how to use it. | Yes |
| `api/mcp.js` | Vercel Function: the MCP server, public at `/mcp` through a rewrite in `vercel.json`; Vercel serves `_site/` as static files. A JS port of `query.py` and `mcp_server.py` that reads the deployment's own `data.json`; `tests/mcp.test.mjs` fails CI when the two answer differently. Built and deployed by `.github/workflows/deploy.yml` on every push to `website` (`vercel build` then `vercel deploy --prebuilt`; Vercel's own Git deployments are off). | Deployed by CI |
| `weekly.sh` | The Monday refresh launchd runs on the maintainer's Mac: taxonomy, salary feeds, company details, radar, test, validate, build, push. | Pushes to `main` |

`lib.py` is the only code that reads or writes `companies.csv`. Writes go to a
temporary file first, because an interrupted fetch must not truncate the only
copy of the data.

All Levels.fyi fetching **must run from Spain** — the pages are IP-scoped.

### The weekly refresh

It runs on the maintainer's Mac. On 2026-09-27 a GitHub-hosted runner minted
a token fine and got `unreadable` for both glovo and fever: HTML without the
page data, most likely Levels.fyi's bot protection answering Azure addresses.
So:

- launchd agent `com.pugarte7.spanish-top-tech-companies.weekly`
  (`~/Library/LaunchAgents/`) runs `scripts/weekly.sh` from its own clone in
  `~/.local/share/spanish-top-tech-companies` every Monday at 08:00 local.
  launchd runs a missed slot when the Mac wakes, not when it was off.
- `weekly.sh` resets that clone to `origin/main`, fetches, runs the tests,
  `validate.py` and `build.py`, and pushes "Refresh salaries YYYY-MM-DD".
  Its log is `~/Library/Logs/spanish-top-tech-companies/weekly.log`; a failure
  also raises a macOS notification.
- `sh weekly run` (repo root) starts the same launchd job by hand and follows
  its log; `sh weekly status` shows the job's last exit and the last refresh
  commit, `sh weekly log` the log.
- `.github/workflows/weekly.yml` opens an issue from that push with
  `scripts/digest.py` (companies in and out, table moves, median changes,
  every new salary, a draft post). It runs as github-actions[bot] because
  GitHub never notifies people of their own activity. On Tuesdays at 12:00
  UTC it opens "No salary refresh this week" if no refresh commit landed.

Rate limiting: 403/405/429/503 all mean throttled. Treating them as "not found"
is what originally wrote 56 false `unmatched` rows into the old backlog. Keep
`--delay` at 2.5s or more.

## Known gaps

- **A company with its median under 50k is off the README but on file.** Since
  2026-10-14 the CSV keeps them — Accenture's 16 Spanish seniors at a median
  of 43k are data for the website — while the README still shows nothing
  under the floor except "Need to improve" between 50k and 60k.
- **One-person medians.** Nothing stops a company with a single senior on
  file from topping the table at "100% (1)". A minimum of three was offered
  and declined on 2026-09-22; the Engineers column is the reader's guard. The
  website is stricter: it publishes no aggregate under `lib.MIN_GROUP`.
- **Titles and specializations are only as good as the taxonomy match.**
  Authors write free text; `title_slug()` and `specialization_slug()` store
  the official slug or leave the field empty rather than guess, so
  granularity varies — roughly three rows in four carry a usable
  specialization, and generic titles like "Software Engineer" stay empty on
  purpose.
- **Old salaries.** Entries go back to 2018-11. The README shows the month,
  but nothing is dropped for age.
- **No first-hand data yet.** Every salary is crowdsourced. The repository's own
  standard is not met by a single row, which is the biggest gap on this list.
- **Duplicate slugs.** Levels.fyi files some employers twice (`meta` and
  `facebook` serve the same page; Timescale renamed itself Tiger Data and
  got a second slug). `lib.SLUG_ALIASES` maps the alias to the canonical
  slug; feed rows under either are filed under the canonical company, each
  row keeping the page it was read from. `validate.py` rejects a row group
  filed under an alias. Added 2026-09-23 when the maintainer asked for
  Timescale and Tiger Data to be one row; it also fixed Meta, whose
  `facebook` table is empty while `meta`'s is not.
- **Struck-off slugs.** `lib.EXCLUDED_SLUGS` holds slugs the maintainer
  removed with a reason (`abracadabra`, `data-native-systems-sl`: nobody could
  say what company they are). Never fetched, never discovered, refused by
  `validate.py`. Discovered employers also arrive without LinkedIn; ten were
  typed into the CSV by hand on 2026-09-23 and the fetcher never overwrites a
  `linkedin_url` on file. Paradigma Digital followed, and every company on file now links somewhere.
- **The radar covers a fraction.** Spain Tech Radar matched 66 of the 208
  companies on file on 2026-10-14 — it leans on GitHub organizations, so
  banks and multinationals are underrepresented — and name matches are weak
  evidence, so `fetch_radar.py` prints every one for review.

## Commands

```bash
python3 scripts/fetch_taxonomy.py                 # regenerate taxonomy.py from /t
python3 scripts/fetch_spain.py --delay 3.0        # ~30-45 min with a token: every role's Spain feed
python3 scripts/fetch_spain.py --audit            # report, write nothing
python3 scripts/fetch_radar.py --dry-run          # review radar matches, write nothing
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
