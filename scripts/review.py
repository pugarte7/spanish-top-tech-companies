#!/usr/bin/env python3
"""Companies on file with neither a LinkedIn page nor a website, as Markdown.

    python3 scripts/review.py              # the whole list, for data/review.md
    python3 scripts/review.py --limit 200  # the issue body, linking to the file

Since 2026-11-01 such a company is taken for unverified: its salaries stay
in the CSV, the website publishes nothing of it, and this list is what the
maintainer goes through by hand. The weekly refresh writes it to
data/review.md and keeps the "Companies to verify" issue at it. Both are
public, so a row is a name, a Levels.fyi link, a count and the roles - never
a salary.
"""
from __future__ import annotations

import argparse
import collections
import sys

import lib

REPO = "https://github.com/pugarte7/spanish-top-tech-companies"
FULL_LIST = f"{REPO}/blob/main/data/review.md"


def unverified(companies: list[dict]) -> list[dict]:
    """Most salaries first: those are the ones worth finding."""
    return sorted((c for c in companies if c["entries"] and not lib.verified(c)),
                  key=lambda c: (-len(c["entries"]), c["company"].casefold()))


def render(companies: list[dict], limit: int | None = None) -> str:
    found = unverified(companies)
    out = [f"{len(found)} companies with salaries on file have neither a LinkedIn page "
           "nor a website, so the site shows nothing of them until someone finds the "
           "company. For each one, either type its `linkedin_url` or `website` into "
           "`companies.csv` (a value typed by hand is never overwritten) or strike the "
           "slug off in `lib.EXCLUDED_SLUGS` with the reason.", ""]
    shown = found[:limit] if limit else found
    if len(shown) < len(found):
        out += [f"The {len(shown)} with most salaries; the whole list is in "
                f"[data/review.md]({FULL_LIST}).", ""]
    out += ["| Company | Levels.fyi | Salaries | Roles |", "| --- | --- | ---: | --- |"]
    for company in shown:
        roles = collections.Counter(e.get("role") or "?" for e in company["entries"])
        slug = company.get("levels_slug")
        page = (f"[{slug}](https://www.levels.fyi/companies/{slug}/salaries)" if slug else "—")
        out.append(f"| {company['company'].replace('|', ' ')} | {page} | {len(company['entries'])} | "
                   f"{', '.join(role for role, _ in roles.most_common(3))} |")
    return "\n".join(out) + "\n"


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description=__doc__,
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--limit", type=int, help="Rows to print; the rest is linked.")
    args = parser.parse_args(argv)
    sys.stdout.write(render(lib.load_companies(), args.limit))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
