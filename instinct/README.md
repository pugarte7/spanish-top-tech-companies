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
   first.
2. It opens issues of 50 companies, labelled `enrich`, in the private repo
   `pugarte7/spanish-top-tech-companies-data`, leaving out those already asked.
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
- A first answer never overwrites a size on file, and contacts on file stay
  beside the new ones. A later answer in the same issue is a correction and
  replaces both, also for 14 days after the issue is closed.
- Each company's item is checked on its own: the good ones are stored, the
  rest go back in a comment and the issue stays open.
- We bucket `employees` or `range` ourselves (`scripts/headcount.py`:
  1-50, 51-200, 201-1000, 1001-5000, 5001+); `scope: branch` gets no bucket.
- A manager or lead with no `jobs` is refused.

`python3 tests/test_enrich.py` checks the brief's example against the schema;
`python3 scripts/enrich.py check ANSWER.json` checks any answer.

## What each company does

`about/` is a second contract with the same agent: `about/brief.md` and
`about/schema.json`, changed together. `.github/workflows/about.yml` runs
`scripts/about.py` by hand, and daily once the repo variable `ABOUT_DAILY` is
`on`, with the same `DATA_ISSUES_TOKEN`.

1. It opens issues labelled `about` in the private repo, each listing 20
   companies of `data.json` with no sentence in `data/about.json`, those with
   most salaries first, 10 issues a run.
2. The agent answers with one comment, as `pugarte7`, holding one JSON block
   with one item per company: a sentence in Spanish and English, or
   `about: null` and why.
3. The next run stores every item that passes and commits `data/about.json`
   to main. An issue is closed once every company it asked about is on file
   or noted as not placed; otherwise it gets a comment listing what was
   refused and `needs-human`, and a new answer below it is read again.

Checked without trusting the agent: the comment is `pugarte7`'s and follows
the schema; each sentence is one line of 10 to 140 characters, one sentence,
does not start with the company's name and carries no praise word; it has a
`source_url`; and the company is one the issue asked about. A first
answer never overwrites a sentence on file; a later answer in the same issue
is a correction and replaces it, also for 14 days after the issue is closed.
A company not placed is asked again after 180
days.

The issues are in the private repo only because the agent already works
there; nothing in them is personal.

`python3 tests/test_about.py` checks the brief's example against the schema;
`python3 scripts/about.py check ANSWER.json` checks any answer.
