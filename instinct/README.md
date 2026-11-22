# Instinct: company enrichment

An outside agent fills in what we lack for a newly discovered company: its
size and the people a candidate can write to about an opening. This folder is
the contract with it; change the brief and the schema together.

- `brief.md`: what the agent is given, word for word.
- `schema.json`: the JSON it must answer with.

## Flow

`.github/workflows/enrich.yml` runs `scripts/enrich.py` by hand, and daily
and after the weekly boards run once the repo variable `ENRICH_DAILY` is `on`.
It needs the secret `DATA_ISSUES_TOKEN`: a fine-grained token with Issues read
and write on the private repo only.

1. It lists companies of `data.json` missing from `data/sizes.json` or whose
   contacts were not checked in the last 120 days, those with open postings
   first, 25 a run.
2. It opens one issue per company, labelled `enrich`, in the private repo
   `pugarte7/spanish-top-tech-companies-data`, unless one is already open.
   The body holds the input block of `brief.md`.
3. The agent answers with one comment, as `pugarte7`, holding one JSON block
   that follows `schema.json`, or a line starting `NEEDS_HUMAN` and why. It
   cannot label issues, so it does not.
4. The next run reads every open `enrich` issue. Only the newest answer by
   `pugarte7` counts: other accounts are ignored, and so are its comments
   without a JSON block. No answer yet: the issue is left as it is. The run's
   own comments are `pugarte7`'s too (the token's owner) and carry
   `<!-- enrich.py -->`; an answer older than one of them was already handled.
5. A valid answer writes the size to `data/sizes.json` on main and the
   contacts to `contacts.json` in the private repo
   (`scripts/private_data.sh push`) with the date of the check, so a company
   with nobody found is not asked again for 120 days. The issue is closed only
   after both are saved. A bad answer or `NEEDS_HUMAN` gets a comment and
   `needs-human` and stays open; a new answer below it is read again.

## Why the private repo

Contacts are people: a name with a work address or profile is personal data.
A public issue would publish them for good (history, forks, scrapers) and no
removal request could be honoured. Sizes are not personal and are public.

## What we check, without trusting the agent

- The comment is `pugarte7`'s, parses and follows `schema.json`; otherwise
  `needs-human` and nothing is written.
- Each email appears at its `evidence_url` (fetched by us); otherwise the
  email is dropped, and the contact with it unless it has a profile.
- Job ids are the ones the issue listed, and the answer is about the
  company the issue asked about.
- A size on file is never overwritten; contacts on file stay beside the new
  ones.
- We bucket `employees` or `range` ourselves (`scripts/headcount.py`:
  1-50, 51-200, 201-1000, 1001-5000, 5001+); `scope: branch` gets no bucket.
- A manager or lead with no `jobs` is refused.

`python3 tests/test_enrich.py` checks the brief's example against the schema;
`python3 scripts/enrich.py check ANSWER.json` checks any answer.
