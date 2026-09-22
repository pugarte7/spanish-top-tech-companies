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


def company_cell(company: dict) -> str:
    url = linkedin_url(company)
    return f"[{escape(company['company'])}]({url})" if url else escape(company["company"])


def jobs_cell(company: dict) -> str:
    url = jobs_url(company)
    return f"[open roles]({url})" if url else "—"


def source_cell(entry: dict) -> str:
    label = (entry.get("source") or "—").replace("-", " ")
    return f"[{label}]({entry['source_url']})" if entry.get("source_url") else label


# --------------------------------------------------------------------------- tables


AVERAGE_HEADER = [
    "| Company | Avg base | Avg total comp | Engineers | Share | Reported | Source | Jobs |",
    "| --- | ---: | ---: | ---: | ---: | --- | --- | --- |",
]


def mean(amounts: list) -> int | None:
    amounts = [amount for amount in amounts if amount is not None]
    return round(sum(amounts) / len(amounts)) if amounts else None


def average(company: dict) -> dict:
    """What a company pays, on average, the engineers on file for it.

    Every entry already has 5+ years and a 60k+ base, so this is the mean of
    exactly those, and nothing else: no one under the bar pulls it down, and no
    level name decides who is in it.
    """
    entries = company["entries"]
    months = sorted(entry["reported"] for entry in entries if entry.get("reported"))
    return {
        "base": mean([entry.get("base") for entry in entries]),
        "total": mean([entry.get("total") for entry in entries]),
        "engineers": len(entries),
        "reported": (months[0] if months[0] == months[-1] else f"{months[0]} to {months[-1]}")
                    if months else None,
        "first_hand": any(entry.get("source") in lib.VOUCHED for entry in entries),
    }


def sources_cell(company: dict) -> str:
    """Every source the average draws on, each linked once."""
    cells = []
    for entry in sorted(company["entries"], key=lib.entry_order):
        cell = source_cell(entry)
        if cell not in cells:
            cells.append(cell)
    return ", ".join(cells)


def share_cell(company: dict) -> str:
    """How many of the company's Spanish submissions the average is drawn from.

    "3% of 63" at BBVA reads: 63 software engineers in Spain reported, and two
    of them had both 5 years and a 60k base. The average alone would put BBVA
    beside companies where everyone does. Only Levels.fyi entries count towards
    the share, because the denominator is Levels.fyi's; a first-hand entry
    belongs to no submission set.
    """
    read = company.get("spain_submissions")
    if not read:
        return "—"
    crowd = sum(1 for entry in company["entries"] if entry.get("source") == "levels.fyi")
    percent = 100 * crowd / read
    return f"{'<1' if 0 < percent < 1 else round(percent)}% of {read}"


def average_row(company: dict) -> str:
    found = average(company)
    cells = [
        company_cell(company),
        k(found["base"]),
        k(found["total"]),
        str(found["engineers"]),
        share_cell(company),
        escape(found["reported"]),
        sources_cell(company),
        jobs_cell(company),
    ]
    return "| " + " | ".join(cells) + " |"


def render_stats(companies: list[dict]) -> str:
    """The list is whatever the last run found, so the line says when that was."""
    entries = [entry for company in companies for entry in company["entries"]]
    parts = [
        f"**{len(companies)} companies paying {lib.SENIOR_YEARS}+ year engineers 60k+**",
        f"{len(entries)} salaries averaged",
    ]
    stale = sum(1 for entry in entries if lib.is_stale(entry.get("date")))
    if stale:
        parts.append(f"{stale} stale")
    months = sorted(e["reported"] for e in entries if e.get("reported"))
    if months:
        parts.append(f"reported {months[0]} to {months[-1]}")
    read = [e["date"] for e in entries if e.get("date")]
    if read:
        parts.append(f"last run {max(read)}")
    return " · ".join(parts)


def render_companies(companies: list[dict]) -> str:
    # A company with a salary someone in Spain reported directly sorts above
    # the crowdsourced ones, then the best average first. validate.py has
    # already refused any company without an entry.
    averages = {id(c): average(c) for c in companies}
    ranked = sorted(companies, key=lambda c: (not averages[id(c)]["first_hand"],
                                              -(averages[id(c)]["base"] or 0), c["company"].casefold()))
    out = [f"## Average pay, engineers with {lib.SENIOR_YEARS}+ years at 60k+", "", *AVERAGE_HEADER]
    out += [average_row(company) for company in ranked]
    return "\n".join(out)


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
