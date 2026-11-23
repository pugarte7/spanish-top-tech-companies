# Working context

Read this before touching the data pipeline. Several things about Levels.fyi
are counter-intuitive and were expensive to find. [CLAUDE.md](../CLAUDE.md)
holds the rules; this file holds why, and the details of the API.

## The rules and why

- **Spain only.** A German salary here is worse than no salary: the point is
  that other sources mix countries.
- **One median per company over every software engineer, and the bar applies
  to the median.** A mean over only the 60k+ rows made Minsait read 90k off
  two engineers while fourteen under 60k went unrecorded. Listing a company
  because any one row was at 60k+ kept companies with a 43k median on the
  list. Filter rows by role, aggregate, then filter companies by the
  aggregate.
- **No experience cut.** The old 5+ years filter existed only because the old
  fetcher stored seniors, which made "seniors earn 60k+" look like a finding
  when it was the sample.
- **Publish groups of five, rounded.** With three people, a median and its
  quartiles gave back all three salaries.
- **The world vouches for a small company.** A 300k entry-level mechanical
  engineer in Malaga was the only submission its "company" had anywhere. The
  count is summed over roles: per role it dropped Repsol, Endesa and
  Bankinter. Dropping a Spanish base above what the company pays abroad took
  real seniors at companies with a few salaries from cheaper countries, and
  was removed.
- **Only checkable sources.** Every figure comes from a source anyone can
  open; salaries told to the maintainer directly are not taken.

## Levels.fyi traps

**1. A company page silently serves another country.**
`/companies/<slug>/salaries` is scoped by the caller's IP and falls back to
the company's home country when there are no Spanish submissions. A guard on
currency passes Germany, the Netherlands, France and Ireland. Every
submission names its city: that is the guard. `locationMeta` only echoes the
URL back.

The check that matters is in `validate.py`, because every branch and pull
request has to pass it: a branch cut before the first cleanup carried 205
foreign bands back in, past a guard that lived only in the fetcher. CI must
fail on it too: the workflow sets `shell: bash` for `pipefail`, since
`validate.py | tee` reported `tee`'s exit code. Remember that before piping
anything else there.

**2. The per-location page answers in three voices** (`averages` with up to
twenty `samples` per rung, `percentiles` that fall back to another country,
and `median`, one real submission). None of them feeds the CSV any more: the
signed-in feed does. Levels.fyi's HTML pages are IP-scoped, serve GitHub's
runners nothing and answer the Mac 405; the fetchers that read them are not
run.

**3. A sample count does not mean a published figure.** Some companies return
`sampleSize > 0` with every percentile null and no samples.
`generatedOccupationSchema.sampleSize` is the company's global count whenever
`averages` is empty.

**4. Every money field in the payload is USD.** A record's own `exchangeRate`
converts to the currency its author was paid in (`baseSalaryCurrency`), so
it gives back the figure typed only for euro rows. Missing the conversion
once put 141 bands 16% high; using the record's rate for a dollar salary
listed 105k USD as 105k EUR. Non-euro rows convert at the median rate of the
five euro rows nearest in month in the same feed (`euro_rates()`,
`rate_near()`); `feed.json` keeps up to five rates per month so a week with
one dollar row can still be priced. A row that cannot be priced is dropped
and counted, never guessed. `tests/test_pipeline.py` asserts two published
euro figures.

**5. The submissions table is behind a sign-in.** The browser loads it from
`api.levels.fyi/v3/salary/search` with the visitor's Cognito id token; the
public page embeds a handful of records. Fever's page embedded one while its
table held 29 Spanish engineers.

**6. The feed is the run.** The same API without `companySlug` is a
country-wide feed per job family. `feed()` reads a role, `entries_by_company()`
files every employer it names and `write_role()` writes them, creating
employers never on file: that is what makes "add your salary on Levels.fyi
and it gets picked up" true. A feed row's `source_url` can point at a page
that answers 404 today; `validate.py` accepts it. Rows with `False` for both
company fields are skipped. `EXCLUDED_SLUGS` are skipped before filing.

**7. `total` lies, and half a feed looks like deletions.** `total` caps at 250
while the API keeps serving, so `feed()` pages until an empty page. A page
that fails, or an answer that does not decrypt, makes the whole feed `None`
and nothing is written. `offset` stops at 990 (`MAX_OFFSET`): a longer role
is read oldest first and continues from the last row's date with `sinceDate`,
a second early, deduped on uuid. When every row of a query shares one date
the cursor cannot move, and `read_role()` falls back to per-company reads and
returns the set it read as the scope. An empty scope means nothing was read
whole, not "no limit": `write_role()` tells `None` from an empty set, after
an empty set once replaced every company's rows.

## The API

- Query: `companySlug` (empty for the feed), `jobFamilySlug`,
  `countryIds[0]=226` (Spain), `offset`, `limit` (max 50), `sortBy=offer_date`,
  `sortOrder=ASC`, `sinceDate` (an ISO instant, inclusive). A query with no
  job family answers nothing.
- `offerDate` is the moment of submission, to the second, which is why it
  works as a cursor.
- Answer: `{"payload": "<base64>"}`: AES-128-ECB, key = first 16 characters of
  base64(MD5("levelstothemoon!!")), then zlib, then JSON with `total`,
  `hidden`, `rows`. openssl does the AES; the standard library has none.
- Rows: `uuid`, `location`, `level` (sometimes the string `"False"`),
  `yearsOfExperience` (a number or a bucket, which counts from its low end),
  `baseSalary` in USD, `exchangeRate`, `baseSalaryCurrency`, `offerDate`.
- Headers: `Authorization: Bearer`, `x-agent: levelsfyi_website`, the browser
  User-Agent. A bare `Mozilla/5.0` got 402.
- `X-RateLimit-Limit: 25` over a short window. 402/403/405/429/503 mean
  throttled; 401 is an expired token.

### The login

Cognito pool `us-west-2_fUcfzSGdv`, web client `76of0ich18hd8uehju7fniv2u1`,
no client secret. `fetch_spain.py --login` signs in by SRP (or takes a pasted
refresh token when the email is left empty) and stores the refresh token in
the macOS login Keychain (service `spanish-top-tech-companies`, account
`levels-refresh-token`), reading stdin so it never lands in shell history.
`refreshed()` mints an id token from it each run. On Actions `token()` signs
in from `LEVELS_EMAIL` and `LEVELS_PASSWORD` each run: a runner has no
Keychain and a secret cannot follow a rotating refresh token. A refused
refresh token stops the run, since falling back to the public page would
replace every table entry with the page's handful.

### Whole and incremental reads

A whole read replaces the role's stored Levels.fyi rows per company, which is
also how deleted and corrected submissions leave; rows from other sources and
other roles are never touched, and a company left with no rows is dropped. An
incremental read asks for the rows after the role's cursor (`after()`:
`sinceDate` one second past the newest `offerDate` seen) and
`write_role(append=True)` adds them: about 60 calls a run against 315.

`feed.json` (`{"roles": {role: {"since", "full"}}, "rates"}`) holds an
instant and a day per role, never a submission id. `full_due()` gives each
role a whole read every `FULL_WEEKS` (4), each in its own week of the cycle
(a hash of its slug). A role with nothing on file has no cursor and is asked
only on its whole read. `--full` reads everything whole; `--company` always
does and leaves the cursors alone. A run where no role had anything new
worked (exit 0); only one where nothing answered fails.

The global count behind `prune_unproven()` is one call per company-role pair
(`companySlug` + `jobFamilySlug`, no country), cached in `global.json` for
`GLOBAL_DAYS` (90). Pairs with five Spanish rows, and every pair of a company
with five Levels.fyi rows on file, are never looked up.

## The weekly refresh

`.github/workflows/refresh.yml`, Mondays (GitHub starts this repo's schedules
hours late).

- The private files live as one AES-256 tarball in the private repo.
  `private_data.sh pull` writes them beside `lib.DATA` (backing up what was
  there); `push` refuses
  when the repo moved since that machine's last pull.
- The workflow pulls, fetches, pushes the private files back before anything
  public moves (the cursors are past this week's rows by then), commits
  `data/` to `main` as github-actions[bot], dispatches `deploy.yml` with
  `reuse_jobs` (a `GITHUB_TOKEN` push starts no workflow), opens "Week of"
  and keeps "Companies to verify".
- Secrets: `LEVELS_EMAIL`, `LEVELS_PASSWORD`, `DATA_KEY` (also in the Keychain
  as account `data-key`), `DATA_DEPLOY_KEY`.
- It stops with nothing pushed on pulled data that does not validate, on any
  failed step, and on `scripts/guard.py`: Levels.fyi rows down at most 5%, listed companies
  down at most 10%. A failure opens "Refresh failed" with the run's link
  only. Exit 3 from `fetch_spain.py` opens "Refresh paused: ..." and every
  run is skipped while it is open; the repository variable
  `REFRESH_PAUSED=true` pauses it by hand.
- Against looking like a bot: pauses vary from `--delay` to 1.5 times it, and
  a scheduled run starts up to 45 minutes late at random.
- `usage.py` gets stars and forks there but not traffic, which needs admin
  rights the workflow token lacks.

By hand from the Mac: `scripts/weekly.sh` does the same, syncing the private
repo around it. `sh weekly run` starts the launchd job
(`com.pugarte7.spanish-top-tech-companies.weekly`, its own clone in
`~/.local/share/spanish-top-tech-companies`), `sh weekly status` and
`sh weekly log` report on it. `weekly.yml` opens the issue for a refresh
pushed from the Mac and, on Tuesdays, "No salary refresh this week" when none
landed.

## Site and MCP

- `site.py` builds `_site/`: the pages in both languages,
  `/api/v1/data.json`, `/api/v1/company-cells.json`, `/llms.txt`,
  `/llms-full.txt` and `/.well-known/skills/`. CI has no CSV and builds from
  the committed `data/`.
- `deploy.yml` builds and deploys on every push to `main` (`vercel build`,
  then `vercel deploy --prebuilt`); Vercel's own Git deployments are off. The
  function runs in Frankfurt (`fra1`): the default region made every call
  from Spain cross the Atlantic twice.
- PostHog is cookieless, in the EU, through the `/ingest` rewrites; the
  project must have cookieless tracking on or it drops every event.
- `api/mcp.js` reads the deployment's own JSON. `scripts/mcp-stdio.mjs` is
  the same `respond` over stdio. It speaks both protocol eras (2026-07-28
  and the `initialize` handshake back to 2024-11-05). Bad input is a JSON-RPC
  error, never a crash; `tests/mcp.test.mjs` checks it over stdio and HTTP.
- The job tools store nothing about the person. A posting's description is
  read for `keywords` and `years` and never stored. `api/_classify.js` holds
  the classification rules for both `jobs.mjs` and the server.
- `job_questions` reads forms only from allow-listed hosts. A board whose
  form needs an account returns `account_required`; one with no public form
  returns the description and an unread marker. Those are by design, not
  failures (`form_access` in PostHog tells them apart). A posting whose form
  cannot be read stays in `find_jobs`.
- Subsidiaries with their own Levels.fyi page are not merged into the
  parent: `company_salaries` returns `related_companies` with a note not to
  add them up. `UNRELATED` keeps out pairs that only share a word.
- The star ask is `application_guide`'s last step and the server
  instructions only: at most once a week, never after a yes. Per-call notes
  were opened 8 times in 5,950. Gating callers on a star is against GitHub's
  acceptable use policies.
- A "How did you hear about us?" answer is the person's, never the site.

## Jobs and boards

- `jobs.mjs` keeps postings a person in Spain could take: an office in
  Spain, remote from Spain or Europe, or remote naming no place. It runs in
  the Vercel build after `site.py`, never fails the build, and the index is
  never committed.
- The daily scheduled deploy crawls; a deploy for a push republishes
  production's `jobs.json` while it is under `JOBS_REUSE_HOURS` (36) old.
- A host answering 402/403/405/429/503 or 5xx is throttling: its boards are
  retried with backoff and after five refusals in a row the host is left for
  the run. A board that still fails keeps its postings from production's
  previous index for up to seven days (`boards.stale`). A board that
  answered keeps nothing: an empty list is a success and a 404 means gone.
- `--fixture tests/fixtures/jobs.json` writes the committed sample offline.
- `offers.py` merges each build's stated pay into `offers.csv` on the
  `offers` branch, a branch of its own so the daily commit neither redeploys
  nor races the refresh.
- `remote_boards.mjs` takes every board Common Crawl's URL index names on
  the ATS in its `SOURCES` (those whose URL carries the board) (read from its cluster index and
  block files; its search API times out) and reads each one. Workable is
  left out on purpose: it refuses anything faster than a board every 2.5s,
  hours of run for a handful of employers; its boards on file are
  `via: hand`. An ATS that refuses 25 boards in a row is left, marked
  incomplete, and the next run starts elsewhere in its list; so is one the
  run's `--minutes` cut short. A board is a candidate when the daily crawl
  would list one of its postings (`judge()` runs `jobs.mjs`'s own
  `entry()`): an office in Spain or remote work naming Spain or Europe,
  never a bare "Remote". Its pay is read as the crawl reads it, from the
  board's fields or the description.
- `remote_levels.py` keeps a candidate that states pay without asking
  Levels.fyi, and asks about the rest: `MIN_GLOBAL` submissions anywhere and
  one in Spain, what the listed companies are asked. Knowing an employer
  abroad alone used to keep a remote board: most of those postings had no
  pay and nothing of the foreign salaries could be shown. It guesses
  Levels.fyi's slug from the board's name, so a namesake can answer: the
  match counts only with Levels.fyi's domain in the postings or in the
  board's name. A refusal exits 3 and opens the refresh's pause issue. A
  board unseen for 45 days leaves (one kept for its pay, unseen stating
  it), unless its ATS was read incompletely or the entry is `via: hand`.
- `boards.mjs` probes only companies with no board that
  `data/boards-none.json` does not show as checked in the last 7 days;
  `--all` re-probes everyone (a few hours); `--render` loads the page in
  headless Chromium when its HTML names no board. A company's own board is
  kept even with no posting in Spain that day ("dormant").
- A posting on another company's account goes to the listed company its
  brand names (`ownerOf`): Glovo posts on Delivery Hero's SmartRecruiters.
- No adapter yet: Avature, Deel's boards, Personio, Jobvite, TalentClue,
  Beamery. Most companies still without a board run one of those or a site of
  their own.

## Known gaps

- **One-person medians** are listed in the companies table, with the count
  beside them.
- **Titles and specializations** are only as good as the taxonomy match:
  about three rows in four carry a usable specialization, and generic titles
  stay empty on purpose.
- **Old salaries.** Entries go back to 2018-11 and nothing is dropped for
  age.
- **The radar covers a fraction** and leans on GitHub organizations; name
  matches are weak evidence, so `fetch_radar.py` prints each for review.

## Commands

```bash
python3 scripts/fetch_taxonomy.py                 # regenerate taxonomy.py from /t
python3 scripts/fetch_spain.py --delay 3.0        # incremental read with a token
python3 scripts/fetch_spain.py --audit            # report, write nothing
python3 scripts/fetch_radar.py --dry-run          # review radar matches, write nothing
python3 tests/test_pipeline.py
python3 scripts/validate.py && python3 scripts/site.py --refresh
```

Python is standard library only, plus the `openssl` binary. `lib.py` is the
only code that reads or writes `companies.csv`, through a temporary file.
Every case in `tests/test_pipeline.py` is a bug this repository shipped: a
failure means one is back, not that the test needs updating.
