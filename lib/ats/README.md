# lib/ats

The job-board code the site's crawl and board finder use: one adapter per ATS
(Greenhouse, Lever, Ashby, Workday, SmartRecruiters, Workable, Recruitee,
Teamtailor, Eightfold, Oracle Recruiting Cloud, Phenom, iCIMS and SuccessFactors career sites,
Radancy, Cornerstone, Pinpoint, BambooHR, Rippling and a few employer sites; `sources/jsonapi.js` holds the employers
whose careers page reads a public JSON API of their own, one small mapping
each), a polite HTTP client with a per-host interval, the
location classifier and the rules that decide which board belongs to a company
(`presets/spain.js`).

Used by `scripts/jobs.mjs` (daily open postings, `/api/v1/jobs.json`) and
`scripts/boards.mjs` (`data/boards.json`). External dependencies: `zod` and
`fast-xml-parser`. Settings come from `ATS_*` environment variables
(`ATS_MIN_INTERVAL_MS`, `ATS_USER_AGENT`, `ATS_LOG_LEVEL`,
`ATS_WORKDAY_MAX_POSTINGS`, `ATS_EIGHTFOLD_MAX_POSTINGS`, `ATS_ORACLE_MAX_DETAILS`,
`ATS_SUCCESSFACTORS_MAX_DETAILS`, ...).

Eightfold and Oracle boards carry two values each, `host/domain`
(`astrazeneca.eightfold.ai/astrazeneca.com`) and `host/site`
(`jpmc.fa.oraclecloud.com/CX_1001`), and are searched for `Spain` (or
`company.query`). Both searches are fuzzy, so every posting keeps its own
locations and the caller decides what is in Spain. Neither publishes its
application form, so `job_questions` returns their apply URL.

MIT licensed; see LICENSE in this folder.
