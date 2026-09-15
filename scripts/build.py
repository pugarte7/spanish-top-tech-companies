#!/usr/bin/env python3
"""Rebuild README.md from companies.csv, and rewrite the CSV in canonical order."""
from __future__ import annotations

import re
import sys

import lib

README = lib.ROOT / "README.md"


def replace_block(text: str, marker: str, body: str) -> str:
    pattern = re.compile(
        rf"(<!-- BEGIN:{marker} -->\n).*?(\n<!-- END:{marker} -->)", re.DOTALL
    )
    if not pattern.search(text):
        raise SystemExit(f"README.md is missing the {marker} markers")
    return pattern.sub(lambda m: m.group(1) + body + m.group(2), text)


# --------------------------------------------------------------------------- cells


def k(amount) -> str:
    return "—" if amount is None else f"{amount / 1000:.1f}k".replace(".0k", "k")


def escape(value) -> str:
    return "—" if value in (None, "") else str(value).replace("|", "\\|")


def linkedin_url(company: dict) -> str | None:
    """Where the company name points.

    A vanity URL is what a person would recognise and what Levels.fyi records,
    so it wins over the numeric id from the LinkedIn job-search filter. The id
    still resolves, and is all some companies have.
    """
    if company.get("linkedin_url"):
        return company["linkedin_url"]
    if company.get("linkedin_ids"):
        return f"https://www.linkedin.com/company/{company['linkedin_ids'][0]}"
    return None


def jobs_url(company: dict) -> str | None:
    """This company's open roles in Spain.

    LinkedIn filters a job search by numeric company id, and takes several at
    once, so Amazon's link covers AWS too. A company known only by a vanity URL
    gets the jobs tab on its own page instead - the same list, without the
    country filter.

    The country goes in as `location=Spain`, a literal LinkedIn resolves
    itself. A `geoId` would be faster and is not worth it: get one digit wrong
    and the link confidently serves another country's jobs, which is the exact
    mistake this list exists not to make.
    """
    if company.get("linkedin_ids"):
        return (f"https://www.linkedin.com/jobs/search/?f_C={'%2C'.join(company['linkedin_ids'])}"
                "&location=Spain")
    if company.get("linkedin_url"):
        return company["linkedin_url"].rstrip("/") + "/jobs/"
    return None


def spain_page(company: dict) -> str | None:
    """The Spain-scoped page that had nothing qualifying.

    Worth linking: a reader who doubts a blank row can open the same page the
    fetcher read and see the gap for themselves.
    """
    slug = company.get("levels_slug")
    if not slug or not company.get("spain_check_date"):
        return None
    return f"https://www.levels.fyi/companies/{slug}/salaries/software-engineer/locations/spain"


def company_cell(company: dict) -> str:
    url = linkedin_url(company)
    return f"[{escape(company['company'])}]({url})" if url else escape(company["company"])


def jobs_cell(company: dict) -> str:
    url = jobs_url(company)
    return f"[open roles]({url})" if url else "—"


def source_cell(entry: dict) -> str:
    label = (entry.get("source") or "—").replace("-", " ")
    return f"[{label}]({entry['source_url']})" if entry.get("source_url") else label


def status_cell(company: dict) -> str:
    """Why a company has no entry. Each kind of blank says which it is.

    Spanish submissions that all fall short of the years or the pay are a
    different gap from no Spanish submissions at all: the first is an answer,
    the second is Levels.fyi's coverage.
    """
    page = spain_page(company)
    if page:
        served = company.get("spain_check_served") or ""
        if served.startswith("Spain"):
            return f"[none with {lib.SENIOR_YEARS}+ years at 60k+]({page})"
        shown = f" (shows {served} pay)" if served and served != "no data" else ""
        return f"[no Spain data]({page}){shown}"
    if company.get("levels_slug"):
        return "not checked yet"
    if company.get("levels_status") == "unmatched":
        return "not on Levels.fyi"
    return "not looked up yet"


# --------------------------------------------------------------------------- tables


ENTRY_HEADER = [
    "| Company | Base | Total comp | Years | Level | City | Reported | Source | Jobs |",
    "| --- | ---: | ---: | ---: | --- | --- | --- | --- | --- |",
]


def entry_rows(company: dict) -> list[str]:
    rows = []
    for index, entry in enumerate(sorted(company["entries"], key=lib.entry_order)):
        cells = [
            company_cell(company) if index == 0 else "",
            k(entry.get("base")),
            k(entry.get("total")),
            escape(entry.get("years_experience")),
            escape(entry.get("level")),
            escape(entry.get("city")),
            escape(entry.get("reported")),
            source_cell(entry),
            jobs_cell(company) if index == 0 else "",
        ]
        rows.append("| " + " | ".join(cells) + " |")
    return rows


def render_stats(companies: list[dict]) -> str:
    entries = [entry for company in companies for entry in company["entries"]]
    parts = [
        f"**{len(companies)} companies**",
        f"**{sum(1 for c in companies if c['entries'])} with 60k+ salaries at "
        f"{lib.SENIOR_YEARS}+ years**",
        f"{len(entries)} salaries",
    ]
    stale = sum(1 for entry in entries if lib.is_stale(entry.get("date")))
    if stale:
        parts.append(f"{stale} stale")
    months = sorted(e["reported"] for e in entries if e.get("reported"))
    if months:
        parts.append(f"reported {months[0]} to {months[-1]}")
    return " · ".join(parts)


def render_companies(companies: list[dict]) -> str:
    # First-hand before crowdsourced, then best-paying. A salary someone in
    # Spain reported directly is worth more than any number scraped from a
    # submission site, so it sorts above one however large that number is.
    paid = sorted((c for c in companies if c["entries"]),
                  key=lambda c: (lib.entry_order(lib.headline(c)), c["company"].casefold()))
    unpaid = sorted((c for c in companies if not c["entries"]),
                    key=lambda c: c["company"].casefold())

    out: list[str] = []
    if paid:
        out += [f"## Engineers with {lib.SENIOR_YEARS}+ years at 60k+", "", *ENTRY_HEADER]
        for company in paid:
            out += entry_rows(company)
        out.append("")
    if unpaid:
        out += ["## Nothing qualifying", "", "| Company | Levels.fyi | Jobs |", "| --- | --- | --- |"]
        out += [f"| {company_cell(c)} | {status_cell(c)} | {jobs_cell(c)} |" for c in unpaid]
    return "\n".join(out).rstrip()


def main() -> int:
    companies = lib.load_companies()
    lib.save_companies(companies)
    readme = README.read_text(encoding="utf-8")
    readme = replace_block(readme, "STATS", render_stats(companies))
    readme = replace_block(readme, "COMPANIES", render_companies(companies))
    README.write_text(readme, encoding="utf-8")
    print(f"Built README.md from {len(companies)} companies.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
