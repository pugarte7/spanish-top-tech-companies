#!/usr/bin/env python3
"""Rebuild README.md from companies.csv, and rewrite the CSV in canonical order."""
from __future__ import annotations

import re
import statistics
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


TABLE_HEADER = [
    "| Company | Median base | Median total comp | Engineers | At 60k+ | Reported | Source | Jobs |",
    "| --- | ---: | ---: | ---: | ---: | --- | --- | --- |",
]


def median(amounts: list) -> int | None:
    amounts = [amount for amount in amounts if amount is not None]
    return round(statistics.median(amounts)) if amounts else None


def summary(company: dict) -> dict:
    """What a company pays a senior, and how often that is 60k+.

    Every entry is a software engineer in Spain with 5+ years, paid whatever
    they are paid. The median is over all of them, so one well-paid engineer
    cannot make a company look competitive: Minsait's two at 90k next to
    fourteen under 60k reads 43.5k, 12% at 60k+. Until 2026-09-22 the table
    showed the mean of the 60k+ ones only, which is what critics called
    cherry-picking, rightly. The share is the chance a senior there is at the
    bar; first-hand entries count in it like any other row.
    """
    entries = company["entries"]
    months = sorted(entry["reported"] for entry in entries if entry.get("reported"))
    reached = sum(1 for entry in entries if lib.at_bar(entry))
    return {
        "base": median([entry.get("base") for entry in entries]),
        "total": median([entry.get("total") for entry in entries]),
        "engineers": len(entries),
        "at_bar": reached,
        "share": reached / len(entries) if entries else 0,
        "reported": (months[0] if months[0] == months[-1] else f"{months[0]} to {months[-1]}")
                    if months else None,
        "first_hand": any(entry.get("source") in lib.VOUCHED for entry in entries),
    }


def sources_cell(company: dict) -> str:
    """Every source the median draws on, each linked once."""
    cells = []
    for entry in sorted(company["entries"], key=lib.entry_order):
        cell = source_cell(entry)
        if cell not in cells:
            cells.append(cell)
    return ", ".join(cells)


def share_cell(found: dict) -> str:
    """"46% (6)": six of the thirteen engineers on file are at 60k+."""
    percent = 100 * found["share"]
    return f"{'<1' if 0 < percent < 1 else round(percent)}% ({found['at_bar']})"


def company_row(company: dict) -> str:
    found = summary(company)
    cells = [
        company_cell(company),
        k(found["base"]),
        k(found["total"]),
        str(found["engineers"]),
        share_cell(found),
        escape(found["reported"]),
        sources_cell(company),
        jobs_cell(company),
    ]
    return "| " + " | ".join(cells) + " |"


def render_stats(companies: list[dict]) -> str:
    """The list is whatever the last run found, so the line says when that was."""
    entries = [entry for company in companies for entry in company["entries"]]
    reached = sum(1 for entry in entries if lib.at_bar(entry))
    parts = [
        f"**{len(companies)} companies**",
        f"{len(entries)} engineers with {lib.SENIOR_YEARS}+ years",
        f"{reached} of them at 60k+",
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
    # the crowdsourced ones. Then the share of engineers at the bar, then the
    # median: a company where every senior is at 60k+ ranks above one where
    # 60k+ is a rare high (maintainer, 2026-09-22). validate.py has already
    # refused any company with nobody at the bar.
    found = {id(c): summary(c) for c in companies}
    ranked = sorted(companies, key=lambda c: (not found[id(c)]["first_hand"], -found[id(c)]["share"],
                                              -(found[id(c)]["base"] or 0), c["company"].casefold()))
    out = [f"## Median pay, software engineers with {lib.SENIOR_YEARS}+ years", "", *TABLE_HEADER]
    out += [company_row(company) for company in ranked]
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
