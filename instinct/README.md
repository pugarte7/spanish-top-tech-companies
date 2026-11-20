# Instinct: company enrichment

An outside agent fills in what we lack for a newly discovered company: its
size and the people a candidate can write to about an opening. This folder is
the contract with it; change the brief and the schema together.

- `brief.md`: what the agent is given, word for word.
- `schema.json`: the JSON it must answer with.

## Flow

1. After the refresh, a job lists companies of `data.json` missing from
   `data/sizes.json` or with no record in `contacts.json`.
2. It opens one issue per company, labelled `enrich`, in the private repo
   `pugarte7/spanish-top-tech-companies-data`, unless one is already open.
   The body holds the input block of `brief.md`.
3. The agent answers with one comment holding one JSON block that follows
   `schema.json`, and labels the issue `enriched` or `needs-human`.
4. Our workflow validates the comment and writes: the size to
   `data/sizes.json` by a PR here, the contacts to `contacts.json` in the
   private repo (`scripts/private_data.sh push`). A company with no contacts
   is stored as `[]` with the date, so it is not asked again.

## Why the private repo

Contacts are people: a name with a work address or profile is personal data.
A public issue would publish them for good (history, forks, scrapers) and no
removal request could be honoured. Sizes are not personal and are public.

## What we check, without trusting the agent

- The comment parses and follows `schema.json`; otherwise `needs-human` and
  nothing is written.
- Each email appears verbatim at its `evidence_url` (fetched by us), on the
  company's domain or in a posting of it.
- We bucket `employees` or `range` ourselves (`scripts/headcount.py`:
  1-50, 51-200, 201-1000, 1001-5000, 5001+); `scope: branch` gets no bucket.
- A manager or lead with no `jobs` is dropped.
