# spanish-top-tech-companies

What tech companies in Spain pay, by role, region and experience: the website
spanishtoptechcompanies.com, its JSON and its MCP server, built from Levels.fyi
submissions. Read [docs/CONTEXT.md](docs/CONTEXT.md) before
changing anything in the data pipeline — it records why several
obvious-looking approaches are wrong.

**One median per company, over every software engineer.** `companies.csv` holds
individual salaries: since 2026-10-14 each row is one person in Spain in any
of Levels.fyi's job families, at any seniority, paid whatever they are paid —
the file feeds the website. `lib.engineer_entries()` picks every
software-engineer row with a base, at any experience, and the weekly digest
reports one median per company over those and which list it is on (median at
`lib.THRESHOLD_EUR` 60k: "60k+"; between `lib.FLOOR_EUR` 50k and the bar:
"need to improve"; under the floor: on file but unlisted). Until 2026-11-01
the README showed those lists as tables. The bar never trims the rows the
median is of. Filter positions by role, aggregate, then filter companies by
the aggregate, in that order. No mean, and never another role in these
medians.

How this was reached: on 2026-09-16 the maintainer rejected averages across
levels, a filter on titles that said senior, and set "the mean of the 60k+
seniors only". On 2026-09-22, after readers called that cherry-picking
(Minsait read 90k off two engineers while fourteen seniors under 60k went
unrecorded), the maintainer chose the median over every senior, the share at
60k+ as the second column, and no 15-year cap (it changed
nothing). "At least one senior at 60k+" as the listing rule lasted a day: a
reader pointed out that a company filter belongs on the aggregate, and it
became median >= 60k, dropping 33 companies. On 2026-09-23 the maintainer
brought the 24 with a median of 50k+ back under "Need to improve" ("I don't
wanna lose all those companies"); the nine under 50k stayed out. On
2026-10-17 the maintainer dropped the 5-year cut, which only existed because
the old fetcher stored seniors only: "I think we no longer need to have the
5+ exp data. If they pay more than 60K lets count it in." Do not bring back
the 60k-filtered mean, the any-row rule, a years filter, or other families
in the median.

**The website is the product; the README introduces it.** Since 2026-11-01
spanishtoptechcompanies.com is what people use, built and deployed from
`main`. `README.md` introduces the site in Spanish, then English, written for
search, and holds no data: on 2026-11-01 the maintainer had the
software-engineer tables and `scripts/build.py` that wrote them removed
("Elimina del readme todo lo que había antes"). Do not bring tables back to
the README; the data is on the site and in `data/`.

**Search pages.** Since 2026-11-04 `scripts/seo.py` writes a static page per
role, region, role in a region and company in both languages (`/es/salarios/`,
`/en/salaries/`, `/es/empresas/`, `/en/companies/`), listed in `sitemap.xml`,
because the home page draws its figures with JavaScript and ranked for nothing
people search ("salario programador", "software engineer salary spain").
They print only `data.json` cells, so MIN_GROUP holds there too: a company
gets a page only with five salaries. Titles and FAQs follow the keyword
research in docs/CONTEXT.md, "Search traffic".

**`companies.csv` is private.** Since 2026-10-25 it is not in the repository
on this branch either: one row per person is personal data and a copy of
Levels.fyi's database. It lives at `lib.DATA`
(`~/.local/share/spanish-top-tech-companies-data/website/companies.csv`, or
`STC_DATA`), git ignores it, and only aggregates are published, in
`data/` (`site.py --refresh` writes it; CI and deploys build the site from
it). Never commit the CSV, link to it, or put a single person's salary in
anything public: the weekly digest and its issue carry company aggregates
only.

The five things that will bite you:

1. **Levels.fyi serves another country's salaries when it has no Spanish data**,
   and the page currency stays EUR for Germany, the Netherlands, France and
   Ireland. Guard on each submission's own location, never on currency and
   never on `locationMeta`. `scripts/fetch_spain.py` is the only script that
   writes pay; `scripts/fetch_company.py` is details-only for exactly this
   reason. `validate.py` rejects any levels.fyi source URL without
   `/locations/` in it, or that is not a company's software-engineer page,
   which is the backstop that catches whatever a fetcher gets wrong — leave it
   in place. This trap has been paid for twice: 682 foreign bands, then 205
   more carried in by a branch cut before the first fix.
2. **The feed is read to the end, and a role's stored rows are replaced
   wholesale.** `fetch_spain.feed()` pages one role's country feed until an
   empty answer — `total` lies (caps at 250 while the API keeps serving) — so
   a run that stops at `total` silently drops older submissions. The same
   API without a token is the old trap: `fetch_spain.py` refuses to write
   without one (`--audit` only). `write_role()` replaces only that role's
   rows and only rows this script wrote: first-hand entries and other roles
   are never touched, and a feed that could not be read to the end changes
   nothing, because half a feed looks exactly like deletions.
3. **`sampleSize > 0` does not mean anything is published.** Many companies
   report a count with every percentile null and no samples, and
   `generatedOccupationSchema.sampleSize` is the company's *global* count
   whenever `averages` is empty.
4. **Every figure in the payload is USD.** A record's own `exchangeRate`
   converts to the currency its author was paid in, so use it only when
   `baseSalaryCurrency` is EUR; a dollar or pound row converts at the rate of
   the feed's euro rows nearest in month (`fetch_spain.euro_rates()`, since
   2026-11-02; before that the role page's `locationExchangeRate`, an HTML
   page the WAF now blocks). Missing the conversion once put all 141 bands on
   the front page 16% high; using the record's rate for a dollar salary
   listed Smile.io's 105k USD as 105k EUR.
5. **The public page is a subset; the submissions table needs a sign-in.**
   The browser fills "Latest Salary Submissions" from `api.levels.fyi` with the
   visitor's session token and shows anonymous visitors asterisks. Fever's page
   embedded one record and the README said "none with 5+ years at 60k+" while
   its table had 29 Spanish engineers, ten at 60k+. `fetch_spain.py` reads
   the table with an id token it mints each run from the Cognito refresh token
   in the macOS login Keychain (service `spanish-top-tech-companies`, stored
   with `fetch_spain.py --login`, which signs in by SRP from `LEVELS_EMAIL`
   and `LEVELS_PASSWORD` or a prompt, or takes a pasted refresh token when
   the email is left empty), which is what lets it run unattended, or
   with `LEVELS_TOKEN` for a one-off run. Since 2026-11-01 that login lives only
   in the Keychain, never in a file. A
   refused refresh token stops the run rather than falling back to the public
   page. Only a full table read (`Spain (table)` in the run report) has seen every
   submission; the other labels mean the page's subset. The token and the
   refresh token are a live login: never commit them,
   never print them, never put them in a tool call's visible output. Reading the
   table is against Levels.fyi's terms; the maintainer chose that on
   2026-09-21 knowing the account may be closed.

All Levels.fyi fetching must run from Spain; the pages are IP-scoped. Keep
`--delay` at 2.5s or more, and treat 402/403/405/429/503 as throttling rather
than as "not found". 401 is an expired token. Without a token the fetcher
refuses to write (`--audit` only), and a blocked run, or one that could read
no company at all, exits 1.

The weekly refresh runs on the maintainer's Mac, not on GitHub: Levels.fyi
serves GitHub's runners pages without data. `scripts/weekly.sh` runs from
launchd every Monday at 08:00 and pushes a "Refresh salaries" commit to
`main`, which deploys the site (since 2026-11-01, when `website` was
merged into `main`);
`.github/workflows/weekly.yml` turns that push into an issue with
`scripts/digest.py`'s summary of what changed. See docs/CONTEXT.md.

Entries are individual Levels.fyi submissions. The stored fields are the
normalized columns (`lib.ENTRY_COLUMNS`): role, specialization and title are
the taxonomy's official slugs or empty — never free text, which is how a row
still cannot point at a person. Keep no submission ids, exact days, teams or
free-text detail, keep the attribution, and remove anything someone asks to
have removed. The CSV is row-level and private; the website and MCP publish only
aggregates of five or more people (`lib.MIN_GROUP`), quartiles included, and
every euro figure rounded to 1.000 € (`lib.ROUND_EUR`): with three people, a
median and its quartiles gave back all three salaries. Quartiles needed ten
until 2026-11-02, when the maintainer wanted one minimum across the site
("que en un sitio no sea 1, en otro 3, en otro 5 y en otro 10");
`lib.QUARTILE_MIN` is `MIN_GROUP` since.
**Every verified company is shown, whatever it pays.** Until 2026-11-04 the
site left out companies whose median base over all their salaries was under
45,000 EUR (`COMPANY_FLOOR_EUR`, 138 verified companies such as Santander);
that day the maintainer dropped it: "Vamos a mostrar todas las empresas
independientemente de la mediana. Las medianas generales se actualizan." The
ranking says which pay best, and every aggregate covers all of them. Still
left out: unverified companies and ones the world does not vouch for (both
below). The digest's bar and floor (`lib.THRESHOLD_EUR`, `lib.FLOOR_EUR`) are
unrelated: they only sort the weekly lists.

The one exception is the companies table: on 2026-11-01 the maintainer chose
to list every company with data under the filters, one salary included, with
its summary and its bars per experience band (`site.company_filters()`),
still rounded. A role with 85 salaries had listed one company. data.json,
the map and the matrix keep MIN_GROUP. On 2026-11-04 the MCP's company tools
followed the table ("si hay datos en la web el mcp lo pilla, nada de lo de
mínimo de 5"): 6 of the first 13 `company_salaries` calls had failed.
`top_companies`, `company_salaries` and `find_jobs`' salary_context read
`/api/v1/company-cells.json`, the table's own rows re-keyed by
`site.company_cells()`, flag a figure under MIN_GROUP with `few: true` and
sort under MIN_RANKED after the rest; `salary_stats` keeps MIN_GROUP. A
company the site does not list stays unknown, with close names offered and
nothing said about why. Since 2026-11-02 a company
with fewer than MIN_RANKED salaries in Spain (`n` in data.json's `companies`)
has its median greyed with an asterisk; the asterisk opens a card naming the
company and its count (real company, figure from one or two people), and a
note under the table says the same for all of them.

A row should ideally mean the maintainer knows someone in Spain doing that job,
or was offered the position. Crowdsourced figures are placeholders; first-hand
entries (`community`, `offer-letter`) sort above them.

On file means having salaries: a company stays in `companies.csv` while it
has any row, however junior or underpaid — the website needs them all. What
leaves is a company with no rows at all after a full role read (the feed says
nobody there reported), or one struck off by hand. The digest's bar and floor
apply to the aggregate only; `validate.py` refuses a company
with no entries but no longer polices medians — a 40k median is data.

Enrichment comes from two more sources, in this precedence: a value set by
hand wins, then Spain Tech Radar (`fetch_radar.py`, offices/stack/careers/
type/CIF, CC BY 4.0, only for companies with salaries), then Levels.fyi
(`fetch_company.py`). No fetcher ever overwrites a filled field; a `-` cell
means "checked, there is none", and counts as filled.

**A company with no LinkedIn page and no website is unverified** (since
2026-11-01: "si no encontramos LinkedIn o web de la empresa lo consideramos
como falso"). `lib.verified()` decides; its rows stay in the CSV, the site
publishes nothing of it, not even its rows in the role and region groups,
and `scripts/review.py` lists it. The weekly writes that list to
`data/review.md` and keeps the "Companies to verify" issue at it (`gh` from
the Mac, as the maintainer); they find the company and type its
`linkedin_url` or `website` into the CSV, or strike the slug off. A `-` cell
counts as none. On 2026-11-01, before the fetchers had enriched the feed's new
employers, 1,446 of 1,753 companies were unverified, 1,141 of them on one salary.
The feed's own company record carries the employer's domain (its logo URL),
which `fetch_spain.write_role()` writes as `website` when there is none.

**The world has to vouch for a small company.** Also since 2026-11-01: a
company with fewer than `fetch_spain.MIN_GLOBAL` (5) submissions anywhere in
the world, summed over every role it has rows for, loses its Levels.fyi rows
after the last role is written (`prune_unproven()`, "unproven" in the run
report). DEKA's 300k entry-level mechanical engineer in Malaga was the only
DEKA submission on Levels.fyi. The sum is over roles, not per role, since
2026-11-02: the per-role version dropped Repsol, Endesa and Bankinter, three
engineers and three product managers each. The same day the maintainer
removed a second rule that dropped a Spanish base above everything the
company paid the role abroad: with three or four salaries from cheaper
countries it took real seniors at Stenn, Kiwi.com and Zooplus, and caught no
DEKA the count had not. Do not bring it back. The count
comes from one API call per company-role pair (`companySlug` +
`jobFamilySlug`, no country; the API refuses a query with no job family),
cached in `global.json` beside the CSV for `GLOBAL_DAYS` (90); pairs with
five Spanish rows, and every pair of a company with five Levels.fyi rows on
file over its roles, are never looked up (Spain already vouches). A missing
or stale answer judges nothing. First-hand rows are never screened.

Hand-made facts live in `lib.py`, not in the CSV: `SLUG_ALIASES` (two
Levels.fyi slugs, one employer: `tiger-data` into `timescale`, `meta` into
`facebook`; the alias is read with the canonical slug and each row keeps its
own page URL), `EXCLUDED_SLUGS` (struck off with a reason, never fetched or
discovered), `EXTRA_SPEC_ALIASES` (unambiguous shorthand like `DS` or `ML / AI`
onto the taxonomy's slugs) and `CITY_FIXES`. `scripts/taxonomy.py` is
generated by `fetch_taxonomy.py` from Levels.fyi's `/t` index — never edit it
by hand; curations go in `lib.py` instead. LinkedIn URLs the fetcher cannot
find are typed into the CSV and never overwritten. New companies arrive with
the feed itself: every employer in a role's Spanish feed is written, so "add
your salary on Levels.fyi and it gets picked up" holds without anyone editing
the CSV.

A first-hand software-engineer row must itself be at 60k+, since it is the
maintainer vouching that the company pays that; `validate.py` refuses one
under.

Since 2026-11-01 companies with fewer than `lib.MIN_RANKED` (3) salaries sort
after the rest in the site's companies table, whichever column is sorted: 120
of 341 listed companies had one salary, 87 of them topping the main table, and
the maintainer chose to keep them listed but not ranked ("si limitamos
empresas con más de 5 submisiones, sería demasiado").

After any data change: `python3 scripts/validate.py && python3 scripts/site.py
--refresh`, and commit the regenerated `data/`, never `companies.csv`.

`data/boards.json` is not regenerated by `--refresh`: it maps a Levels.fyi
slug to the company's job board, found by `node scripts/boards.mjs` (only
companies with no board and not found boardless in the last 30 days, which
`data/boards-none.json` remembers; `--all` probes everyone again, most of an
hour). The site publishes it at `/api/v1/boards.json`, tiered by that day's
ranking, and `scripts/jobs.mjs` crawls every board in it daily into
`/api/v1/jobs.json`, which the MCP's job tools search. The ATS adapters both
scripts use live in `lib/ats/` (since 2026-11-04: "vamos a migrar todo dentro
de este repo"); fix them there. Applying goes through `/mcp` with nothing
installed. `data/careers.json` (slug to careers page, from the maintainer's
careers-URL list of 2026-11-09) is read before the company's website and
trusted the same way; add a company's careers page there rather than writing
its board into `boards.json` by hand, which the next `--all` would undo.
Santander UK, Santander Bank, Juniper and NTT Data are left out of it on
purpose: their pages lead to another listed company's board or another entity.

Releases are automatic: `.github/workflows/release.yml` tags every PR merged
into `main` as the next patch (`minor` or `major` label on the PR for those)
and publishes a GitHub Release whose one bullet is the PR title, so keep
titles short. Direct pushes such as the weekly refresh make no release.
Since 2026-11-09 the line restarts at v1.1.0; v2.0.0 was withdrawn.
