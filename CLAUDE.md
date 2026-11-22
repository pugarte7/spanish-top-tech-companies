# spanish-top-tech-companies

What tech companies in Spain pay and which of them are hiring: the MCP server
at spanishtoptechcompanies.com/mcp (the core), the website and its JSON, built
from Levels.fyi submissions and the companies' own job boards. Read
[docs/CONTEXT.md](docs/CONTEXT.md) before changing the data pipeline: it holds
the Levels.fyi traps in detail.

After any data change: `python3 scripts/validate.py && python3 scripts/site.py
--refresh`, and commit the regenerated `data/`, never `companies.csv`.

## Privacy

- `companies.csv` is one row per person and private. It lives at `lib.DATA`
  (`~/.local/share/spanish-top-tech-companies-data/website/companies.csv`, or
  `STC_DATA`) beside `global.json`, `feed.json` and `usage.csv`,
  all kept encrypted in the private repo
  `pugarte7/spanish-top-tech-companies-data`: `scripts/private_data.sh pull`
  before editing by hand, `push` after (passphrase `DATA_KEY`, in the Keychain
  and in Actions).
- Never commit the CSV, link to it, or put one person's salary in anything
  public. Only aggregates are published, in `data/`; the digest and its issue
  carry company aggregates only.
- A row holds only `lib.ENTRY_COLUMNS`: role, specialization and title are
  taxonomy slugs or empty, never free text. No submission ids, exact days or
  teams. Keep the attribution, and remove anything someone asks to have
  removed.
- The Levels.fyi token and refresh token are a live login: never commit them,
  print them or put them in a tool call's visible output.
- The refresh's public log shows only each step's verdict; the scripts'
  output goes to an encrypted log in the private repo (`private_data.sh log`).

## What gets published

- Aggregates need `lib.MIN_GROUP` (5) people, quartiles included, and every
  euro figure is rounded to `lib.ROUND_EUR` (1.000 €). One minimum across the
  site, on purpose.
- The exception is the companies table and the MCP's company tools
  (`top_companies`, `company_salaries`, `find_jobs`' salary context, all from
  `/api/v1/company-cells.json`): every company with data, down to one salary,
  with its count and `few: true` under `MIN_GROUP`. `salary_stats`,
  `data.json`, the map, the matrix and the search pages keep `MIN_GROUP`.
- Companies under `lib.MIN_RANKED` (3) salaries sort after the rest and show
  their median greyed with an asterisk.
- Every verified company is shown, whatever it pays. No median floor.
- Unverified means no LinkedIn page and no website (`lib.verified()`; a `-`
  cell counts as none): rows stay in the CSV, nothing of it is published, and
  `scripts/review.py` lists it in `data/review.md` and the "Companies to
  verify" issue.
- A company with fewer than `MIN_GLOBAL` (5) submissions worldwide, summed
  over its roles, loses its Levels.fyi rows (`fetch_spain.prune_unproven()`).
  Rows from other sources are never screened. A missing or stale count judges nothing.
- A company stays on file while it has any row. `validate.py` refuses a
  company with no entries, not a low median.
- An unknown company gets close names offered and nothing about why.

## Company size and contacts

- `data/sizes.json` (public) maps a slug to `[bucket, employees]`, or
  `[null, employees, 1]` for a figure that is only one office or the Spanish
  subsidiary; `site.py` adds it to the built data.json for `company_size`.
- `contacts.json` (private, beside the CSV, in the private repo) holds the
  people `hiring_contact` gives: a recruiter, or the hiring manager or lead a
  posting is for (`jobs`). An email only where it was published for
  candidates, a LinkedIn profile otherwise; never guessed, never from a data
  broker, never behind a login. `deploy.yml` writes it to `api/_contacts.json`
  (git-ignored), bundled with the MCP function only.
- Never commit contacts, put them in a public issue or log, or publish them
  as a file. Remove anyone who asks.
- The limit is 3 messages a day per person, emails and LinkedIn together, a
  term of use: `MESSAGES_A_DAY` in `api/mcp.js` and `site.py`, the legal page,
  SKILL.md. The person sends every message; the server sends nothing.
- New companies are asked about through `instinct/` (brief and schema for the
  outside agent): `enrich.yml` opens one issue per company in the private
  repo and `scripts/enrich.py collect` checks and stores the answers. Change
  `brief.md` and `schema.json` together.

## The digest's lists

`lib.engineer_entries()` picks every software-engineer row with a base; the
weekly digest reports one median per company over those: 60k+
(`lib.THRESHOLD_EUR`), "need to improve" (from `lib.FLOOR_EUR`, 50k), or
unlisted. Filter rows by role, aggregate, then filter companies by the
aggregate. The bar and floor sort the digest only; the site ignores them.

Do not bring back: a mean, a mean over the 60k+ rows only, "any row at 60k+"
as the listing rule, a years-of-experience filter, other roles in these
medians, or dropping a Spanish base for being above what the company pays
abroad. Each was tried and rejected.

## Levels.fyi, in short

1. It serves another country's salaries when it has no Spanish data, and the
   currency stays EUR. Guard on each submission's own location.
   `validate.py` rejects a levels.fyi source URL without `/locations/` or that
   is not a software-engineer page: leave that in place.
   `scripts/fetch_spain.py` is the only script that writes pay.
2. A whole read pages a role's feed until an empty answer (`total` lies) and
   replaces that role's Levels.fyi rows; a feed not read to the end changes
   nothing. An incremental read (rows after the role's cursor in `feed.json`)
   only appends: never let it replace rows. Each role gets a whole read every
   `FULL_WEEKS` (4); `--full` forces it.
3. `sampleSize > 0` does not mean anything is published.
4. Every figure in the payload is USD. Use a record's own `exchangeRate` only
   when `baseSalaryCurrency` is EUR; other rows convert at the feed's euro
   rows nearest in month (`euro_rates()`).
5. The submissions table needs a sign-in. `fetch_spain.py` mints an id token
   from the Keychain (service `spanish-top-tech-companies`, stored with
   `--login`), from `LEVELS_EMAIL` and `LEVELS_PASSWORD` on Actions, or takes
   `LEVELS_TOKEN`. Without a token it refuses to write (`--audit` only); a
   refused token stops the run.

Keep `--delay` at 2.5s or more. 402/403/405/429/503 mean throttled, not "not
found"; 401 is an expired token. A blocked run exits 3 (`EXIT_BLOCKED`), which
pauses the refresh until its "Refresh paused" issue is closed.

## Where hand-made facts live

- `lib.py`: `SLUG_ALIASES`, `EXCLUDED_SLUGS`, `EXTRA_SPEC_ALIASES`,
  `CITY_FIXES`. `scripts/taxonomy.py` is generated by `fetch_taxonomy.py`:
  never edit it.
- Enrichment precedence: a value set by hand, then Spain Tech Radar
  (`fetch_radar.py`), then Levels.fyi (`fetch_company.py`, details only). No
  fetcher overwrites a filled field, and `-` means "checked, there is none".
- `data/careers.json` (slug to careers page) is where a company's board is
  set by hand; `data/boards.json` is written by `node scripts/boards.mjs` and
  a hand edit there is undone by the next `--all`. Santander UK and Juniper
  are left out of careers.json on purpose. A board another listed company
  holds is not given to a second one, unless the careers.json entry says
  `"shared": true` (a subsidiary on its parent's board, optionally narrowed
  by a `title` regex or a facet in `query`): its postings are then listed
  under both companies.
- ATS adapters live in `lib/ats/`; `scripts/jobs.mjs` crawls every board
  daily into `/api/v1/jobs.json`, which the MCP's job tools search.
- With `BROWSERBASE_API_KEY`, a host that still refuses after the retries
  (403, 405, 429, 503, a challenge, a dropped connection) gets one more try
  in a Browserbase cloud browser (`lib/ats/sources/browserbase.js`), and the
  hosts in `data/browser-hosts.json` go there from the first request. The
  daily crawl logs the hosts that needed it; `boards.mjs` adds them to the
  file. Slug guesses never use the browser. The key is an Actions secret and
  in the Keychain (service `browserbase`); never commit, print or log it.
  Test a "blocked" site with Node's fetch, not macOS curl.
- `data/remote-boards.json` adds employers with no salary in Spain to that
  crawl: a board with remote postings naming Spain or Europe, kept when
  Levels.fyi knows the employer (`MIN_GLOBAL` anywhere) or a posting states
  pay, or a board with an office or hybrid posting in Spain that states pay
  (Levels.fyi vouches for remote work only). `remote.yml` writes it twice a month (`scripts/remote_boards.mjs`,
  `scripts/remote_levels.py`). A Levels.fyi match needs its domain in the
  postings or in the board's name, never the name alone. `"via": "hand"`
  keeps an entry whatever a run finds; `"no"` in
  `data/remote-boards-none.json` strikes a board off. Nothing of these
  employers reaches `data.json` or a median.

## Site, README and MCP

- The README (Spanish `README.md`, English `README.en.md`) leads with the MCP
  and holds no salary data or tables. It follows the site: the mascot, the
  headline, the site's address, the `/mcp` link and nothing else to connect
  (no per-agent setup steps), the three steps, the video, the diagram and the
  questions, written as [docs/STYLE.md](docs/STYLE.md) says. It keeps a
  section that points to CONTRIBUTING.md, the code of conduct and SECURITY.md.
  Its mascot comes from `scripts/readme_mascot.mjs`, its diagram from
  `scripts/readme_flow.mjs`.
- The vertical video comes from `scripts/x_video.mjs` (`scripts/x_video/`),
  one per language (`--lang en`), with figures read from the MCP on the day
  it is made: the mp4s for social feeds stay out of the repository, and
  `docs/img/mcp-video.<lang>.gif` is the cut the READMEs show. It alone uses
  the card colours and the mascot in halftone: neither goes on the site.
- In the demo and in the agent's instructions the agent invents nothing: it
  fills in facts from the CV, asks for the rest, and never writes an opinion
  answer for the person.
- The site is a funnel into the MCP and shows no salaries: one page per
  language, `scripts/landing.py` with `web/landing.css`, `web/landing.js` and
  the mascot's renderer `web/mascot.js`. Its headline carries no figure, which
  would go stale. `vercel.json` sends the old salary and company URLs to it.
  `data/`, `/api/v1/` and the llms files are still published: the MCP reads
  them.
- Anything new on the site (a page, a section, an image, a line of copy)
  follows [docs/STYLE.md](docs/STYLE.md): colours, type, components, the
  mascot, motion and how the copy is written.
- The agent calls on the home page come from `/api/calls`, PostHog's count of
  `$mcp_tool_call` without `internal` ones, about a minute late, so there is
  no counter of our own to run. It needs `POSTHOG_PERSONAL_API_KEY` on the
  deployment; without it the page leaves the figure out.
- The tab icon and the link previews are drawn by `tests/site/og-image.mjs`
  (`npm run og`); run it after a change to the headline or the mascot.
- `api/mcp.js` is the only MCP implementation. `server.json`'s version must
  equal `SERVER.version` there.

## Automation

- `refresh.yml` (Mondays): pulls the private files, reads the feeds, pushes
  the private files back, commits "Refresh salaries" with `data/` to `main`,
  dispatches `deploy.yml` and opens the week's issue. `scripts/guard.py`
  stops it before any push. `scripts/weekly.sh` does the same by hand.
- `boards.yml` runs board discovery after each refresh.
- `listings.yml` keeps outside copies in step: a change under
  `hermes-plugin/` needs a version bump in `hermes-plugin/plugin.json`; a new
  `version:` in `skills/tech-pay-spain/SKILL.md` is published to ClawHub;
  `server.json` goes to the MCP Registry through `registry.yml`. A new place
  that keeps a copy gets a job there.
- `release.yml` tags `main` every Monday, one bullet per merged PR title, so
  keep titles short. A PR into `main` needs a label, which a hook enforces:
  `major` (breaks consumers: `data/` format, MCP tool names or arguments,
  removed URLs), `minor` (something new and visible), `patch` (the rest).
