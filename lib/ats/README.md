# lib/ats

The job-board code the site's crawl and board finder use: one adapter per ATS
(Greenhouse, Lever, Ashby, Workday, SmartRecruiters, Workable, Recruitee and a
few employer sites), a polite HTTP client with a per-host interval, the
location classifier and the rules that decide which board belongs to a company
(`presets/spain.js`).

It came from [autoapply-mcp](https://github.com/pugarte7/autoapply-mcp) 0.3.4,
compiled JavaScript copied on 2026-11-04 when that repository was archived and
everything moved into this one. It is this repository's code now: fix and
change it here. The environment variables it reads still carry the old
`AUTOAPPLY_` prefix (`AUTOAPPLY_MIN_INTERVAL_MS`, `AUTOAPPLY_USER_AGENT`,
`AUTOAPPLY_LOG_LEVEL`, `AUTOAPPLY_WORKDAY_MAX_POSTINGS`).

Used by `scripts/jobs.mjs` (daily open postings, `/api/v1/jobs.json`) and
`scripts/boards.mjs` (`data/boards.json`). External dependencies: `zod` and
`fast-xml-parser`.

MIT License, Copyright (c) 2026 autoapply-mcp contributors; see LICENSE in
this folder.
