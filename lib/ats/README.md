# lib/ats

The job-board code the site's crawl and board finder use: one adapter per ATS
(Greenhouse, Lever, Ashby, Workday, SmartRecruiters, Workable, Recruitee and a
few employer sites, plus `jsonld` for career sites of the employer's own making
that publish each posting's schema.org JobPosting; its boards are written by
hand, see `sources/jsonld.js`), a polite HTTP client with a per-host interval, the
location classifier and the rules that decide which board belongs to a company
(`presets/spain.js`).

Used by `scripts/jobs.mjs` (daily open postings, `/api/v1/jobs.json`) and
`scripts/boards.mjs` (`data/boards.json`). External dependencies: `zod` and
`fast-xml-parser`. Settings come from `ATS_*` environment variables
(`ATS_MIN_INTERVAL_MS`, `ATS_USER_AGENT`, `ATS_LOG_LEVEL`,
`ATS_WORKDAY_MAX_POSTINGS`, ...).

MIT licensed; see LICENSE in this folder.
