# Company enrichment

Each issue labelled `enrich` lists up to 50 companies with open roles in Spain
or remote open to Spain. For each, find two things: how many people it
employs, and who at it a candidate for one of its openings can reach. Answer
with one comment holding one JSON block that follows `schema.json`, with one
item per company, from the account `pugarte7`; comments by other accounts are
ignored. A company you cannot tell apart from another of the same name is left
out of `companies` and named, with why, in the same comment outside the JSON:
the issue then waits for a human. If none can be answered, comment a line
starting `NEEDS_HUMAN` and why, with no JSON. Do not change labels. Never
guess: a field you cannot source is null, and an empty `contacts` is a valid
answer.

To correct an answer, comment again with the items to replace, in the same
shape: the newest comment replaces what the earlier one left for those
companies, size and contacts, also after the issue is closed (for 14 days).

## Input (issue body)

```json
{
  "companies": [
    {
      "slug": "acme",
      "name": "Acme",
      "website": "https://acme.com",
      "linkedin": "https://www.linkedin.com/company/acme",
      "careers": "https://acme.com/jobs",
      "jobs": [
        {"id": "acme-123", "title": "Senior Backend Engineer, Payments",
         "location": "Madrid", "url": "https://acme.com/jobs/123"}
      ]
    }
  ]
}
```

Each company lists its first postings, as many as fit in the issue.
`website` and `linkedin` fix the identity. If they disagree, or the name
belongs to several companies and you cannot tell which, leave that company
out and say so.

## Output (comment)

```json
{
  "companies": [
    {
      "slug": "acme",
      "size": {
        "employees": 1234,
        "range": null,
        "scope": "group",
        "as_of": "2026-06",
        "source_url": "https://...",
        "source_type": "annual_report"
      },
      "contacts": [
        {
          "kind": "recruiter",
          "name": "Jane Doe",
          "role": "Talent Acquisition Partner, Spain",
          "scope": "Spain",
          "linkedin": "https://www.linkedin.com/in/...",
          "email": "jane.doe@acme.com",
          "jobs": [],
          "link_evidence": "Recruiter for Spain at Acme",
          "evidence_url": "https://acme.com/careers",
          "evidence_quote": "Send your CV to jane.doe@acme.com",
          "published_on": "2025-03"
        },
        {
          "kind": "hiring_manager",
          "name": "John Roe",
          "role": "Engineering Manager, Payments",
          "scope": "Spain",
          "linkedin": "https://www.linkedin.com/in/...",
          "email": null,
          "jobs": ["acme-123"],
          "link_evidence": "Current title: Engineering Manager, Payments at Acme, Madrid",
          "evidence_url": "https://www.linkedin.com/in/...",
          "evidence_quote": null,
          "published_on": null
        }
      ],
      "searched": ["acme.com/careers", "acme.com/contact", "web search"],
      "notes": null
    }
  ]
}
```

## size

- `employees`: one figure for the whole employer, or null.
- `range`: only when no figure exists, a band as LinkedIn gives it
  ("51-200").
- `scope`: `group`, `company`, or `branch` when only the Spanish office or
  subsidiary is known.
- `as_of`: the month the figure refers to, `YYYY-MM`.
- Sources in this order: annual report or company registry, the company's own
  site, its LinkedIn page, press, third-party estimates. Newest wins within
  the same rank.

## contacts (0 to 5)

- `recruiter`: recruiting or talent acquisition at this company, for Spain,
  EMEA or worldwide. May cover every job (`jobs: []`).
- `hiring_manager`: named as the hiring manager in a posting, or the manager
  of the team a posting is for.
- `lead`: a tech or team lead of the team a posting is for.

A `hiring_manager` or `lead` lists the job ids they relate to in `jobs`, and
`link_evidence` says how: the posting names them, or their current title at
this company matches the posting's team and place.

`scope`: where the person hires or works: `Spain`, `EMEA`, `Europe`,
`Global`, or null when the page does not say.

`linkedin`: the profile URL, found through a web search or the company's own
pages.

`email`: only an address the person or the company published for candidates
(a careers page, a posting, the person's own call for CVs) since 2024. It
must appear verbatim at `evidence_url`, and `evidence_quote` is the sentence
it appears in. A team address (`jobs@`, `talent@`) has `name: null` and
`kind: recruiter`. Otherwise `email` is null, which is the usual case for
managers and leads.

## Never

- Build an email from a pattern (firstname.lastname@) or take one from a data
  broker (Hunter, Apollo, RocketReach, ZoomInfo, Lusha).
- Log in to LinkedIn or any other site, or read anything behind a login.
- Include executives or anyone not tied to an opening, former employees,
  personal emails, or phone numbers.
- Use an address published for press, investors, regulators or papers.
- Record anything about a person beyond the fields above.
