#!/usr/bin/env python3
"""Rebuild README.md from companies.csv, and rewrite the CSV in canonical order."""
from __future__ import annotations

import re
import sys
from typing import NamedTuple

import lib

README = lib.ROOT / "README.md"


def replace_block(text: str, marker: str, body: str) -> str:
    pattern = re.compile(
        rf"(<!-- BEGIN:{marker} -->\n).*?(\n<!-- END:{marker} -->)", re.DOTALL
    )
    if not pattern.search(text):
        raise SystemExit(f"README.md is missing the {marker} markers")
    return pattern.sub(lambda m: m.group(1) + body + m.group(2), text)


# --------------------------------------------------------------------------- figures


class Headline(NamedTuple):
    """The number a company is ranked by, and where in the table it sits."""
    value: int
    kind: str    # senior | quartile | spread | single, see headline()
    band: dict
    block: str   # "base" or "total"
    part: str    # "p50", "max" or "all": which part of that cell to bold


# Senior and above, cheapest rung first. A company's senior+ pay is best
# represented by the rung you reach it at; staff and principal sit above.
SENIOR_PLUS = ("senior", "staff", "principal", "lead")

# A salary someone in Spain told the maintainer directly outranks anything
# crowdsourced, so it sorts above it however large the crowdsourced one is.
VOUCHED = ("offer-letter", "community")


def point(band: dict, block: str) -> str:
    """Bold the median when there is one, else the whole range it came from."""
    return "p50" if band.get(f"{block}_p50") is not None else "all"


def upper_quartile(band: dict) -> tuple[int | None, str | None]:
    """The 75th percentile of a band, base before total comp.

    An all-seniority band spans juniors to principals, so its median answers
    the wrong question. The upper quartile is where the senior half of the
    company sits, which is the closest this data gets to a senior figure.

    Only an interquartile aggregate has one. A band pooled from a company's
    ladder carries a mean per rung and no distribution, so this returns None
    for it rather than inventing a quartile out of the top rung's average.
    """
    for block in ("base", "total"):
        if band.get(f"{block}_max") is not None:
            return band[f"{block}_max"], block
    return None, None


def role_headline(bands: list[dict]) -> Headline | None:
    """The best senior-or-above figure inside one job family.

    The highest named rung the company publishes for Spain, not the cheapest
    one that counts as senior: Twilio files 59.986 EUR at senior and 112.167 at
    principal, and a list of what a company pays its senior engineers that
    stops at the first rung answers a narrower question than it looks like.

    A rung beats the all-seniority band even when the band is higher. Unity's
    senior rung is 58.4k and its all-levels mean 70.7k; the mean is higher
    because it pools staff and principals, and reporting it as senior pay would
    be trading a measurement for an average.
    """
    best = None
    for rung in SENIOR_PLUS:
        for band in bands:
            value, block = lib.figure(band)
            if band["level"] == rung and value is not None and (best is None or value > best.value):
                best = Headline(value, "senior", band, block, point(band, block))
    if best:
        return best

    for band in bands:
        value, block = lib.figure(band)
        if band["level"] != "all" or value is None:
            continue
        top, top_block = upper_quartile(band)
        if band.get("sample_size") == 1:
            candidate = Headline(value, "single", band, block, point(band, block))
        elif top is not None:
            candidate = Headline(top, "quartile", band, top_block, "max")
        else:
            candidate = Headline(value, "spread", band, block, point(band, block))
        if best is None or candidate.value > best.value:
            best = candidate
    return best


def roles(company: dict) -> dict[str, Headline | None]:
    names = dict.fromkeys(band["role"] for band in company["bands"])
    return {role: role_headline([b for b in company["bands"] if b["role"] == role])
            for role in names}


def headline(company: dict) -> Headline | None:
    """The number a company is ranked by.

    The best senior-or-above software-engineering figure the company has in
    Spain. A company that has none falls back to its best other job family,
    because a company paying data scientists 108k in Spain is worth a row even
    when Levels.fyi publishes nothing for its engineers - the Role column says
    which family it is, since a data scientist's salary passing silently as an
    engineer's is the kind of quiet wrong answer this list exists to avoid.

    kind is how much the number is worth:
      "senior"   a measured rung from a real ladder
      "quartile" the upper quartile of the Spanish aggregate, an estimate
      "spread"   every level at the company averaged together, because its
                 rungs are named L3 and L4 and nothing says which is senior
      "single"   one person's reported salary, not a band at all
    """
    found = [h for h in roles(company).values() if h]
    if not found:
        return None
    # Software engineering wins outright, not just on a tie: this list is
    # about engineers, and Amazon's engineering-manager median of 142.5k is a
    # worse answer to "what does a senior engineer get" than its own measured
    # principal rung, however much larger it is.
    return max(found, key=lambda h: (h.band["role"] == "software-engineer", h.value))


# --------------------------------------------------------------------------- cells


def k(value) -> str:
    return f"{value / 1000:.1f}k".replace(".0k", "k")


def escape(value: str) -> str:
    return value.replace("|", "\\|")


ACRONYMS = {"ai": "AI", "qa": "QA", "sre": "SRE", "ux": "UX", "it": "IT"}


def role_label(role: str) -> str:
    label = " ".join(ACRONYMS.get(word, word) for word in role.split("-"))
    return label[:1].upper() + label[1:]


def level_label(level: str) -> str:
    return "All levels" if level == "all" else level.capitalize()


def money(band: dict, block: str, bold: str | None = None) -> str:
    """A figure, with its 25th-75th percentile range in brackets when it has one.

    `bold` marks the number the company is ranked by: "p50" the figure, "max"
    the top of its range, "all" the whole cell.
    """
    low, mid, high = (band.get(f"{block}_{part}") for part in ("min", "p50", "max"))
    if mid is None:
        if low is None and high is None:
            return "—"
        if None not in (low, high) and low != high:
            cell = f"{k(low)}–{k(high)}"
        else:
            cell = k(high if high is not None else low)
        return f"**{cell}**" if bold else cell
    if None in (low, high) or low == mid == high:
        return f"**{k(mid)}**" if bold else k(mid)
    main, top = k(mid), k(high)
    if bold == "max":
        top = f"**{top}**"
    elif bold:
        main = f"**{main}**"
    return f"{main} ({k(low)}–{top})"


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
    """The Spain-scoped page that answered with nothing.

    Worth linking: a reader who doubts a blank row can open the same page the
    fetcher read and see the gap for themselves.
    """
    checked = company.get("spain_check_roles") or []
    slug = company.get("levels_slug")
    if not slug or not checked:
        return None
    role = "software-engineer" if "software-engineer" in checked else checked[0]
    return f"https://www.levels.fyi/companies/{slug}/salaries/{role}/locations/spain"


def company_cell(company: dict) -> str:
    url = linkedin_url(company)
    return f"[{escape(company['company'])}]({url})" if url else escape(company["company"])


def jobs_cell(company: dict) -> str:
    url = jobs_url(company)
    return f"[open roles]({url})" if url else "—"


def source_cell(band: dict) -> str:
    label = (band.get("source") or "—").replace("-", " ")
    return f"[{label}]({band['source_url']})" if band.get("source_url") else label


def status_cell(company: dict) -> str:
    """Why a company has no figure. Each kind of blank says which it is."""
    page = spain_page(company)
    if page:
        served = company.get("spain_check_served")
        shown = f" (shows {served} pay)" if served and served != "no data" else ""
        return f"[no Spain data]({page}){shown}"
    if company.get("levels_slug"):
        return "not checked yet"
    if company.get("levels_status") == "unmatched":
        return "not on Levels.fyi"
    return "not looked up yet"


# --------------------------------------------------------------------------- tables


PAY_HEADER = [
    "| Company | Role | Level | Base | Total comp | Data points | Source | Jobs |",
    "| --- | --- | --- | ---: | ---: | ---: | --- | --- |",
]


def pay_rows(company: dict, head: Headline) -> list[str]:
    """Every figure a company has: its best job family first, best-paid rung first.

    By pay rather than by ladder position, because ladders disagree on where
    lead sits relative to principal, and this way the ranked figure is nearly
    always the first row. The all-levels band goes last whatever it pays.
    """
    best = {role: h.value if h else 0 for role, h in roles(company).items()}
    bands = sorted(company["bands"], key=lambda b: (
        b["role"] != "software-engineer", -best[b["role"]], b["role"],
        b["level"] == "all", -(lib.level_value(b) or 0), lib.band_order(b)))
    rows = []
    for index, band in enumerate(bands):
        ranked = band is head.band
        cells = [
            company_cell(company) if index == 0 else "",
            role_label(band["role"]),
            level_label(band["level"]),
            money(band, "base", head.part if ranked and head.block == "base" else None),
            money(band, "total", head.part if ranked and head.block == "total" else None),
            str(band["sample_size"]) if band.get("sample_size") else "—",
            source_cell(band),
            jobs_cell(company) if index == 0 else "",
        ]
        rows.append("| " + " | ".join(cells) + " |")
    return rows


def render_stats(companies: list[dict], heads: list[Headline | None]) -> str:
    paid = [h for h in heads if h]
    bands = [band for company in companies for band in company["bands"]]
    parts = [
        f"**{len(companies)} companies**",
        f"**{sum(1 for h in paid if h.value >= lib.THRESHOLD_EUR)} paying 60k+**",
        f"{len(paid)} with pay on file",
        f"{len(bands)} salary figures",
    ]
    stale = sum(1 for band in bands if lib.is_stale(band.get("date")))
    if stale:
        parts.append(f"{stale} stale")
    dates = sorted(d for d in (lib.parse_date(band.get("date")) for band in bands) if d)
    if dates:
        parts.append(f"data from {dates[0]} to {dates[-1]}" if dates[0] != dates[-1]
                     else f"data from {dates[0]}")
    return " · ".join(parts)


def render_companies(companies: list[dict], heads: list[Headline | None]) -> str:
    # First-hand before crowdsourced, then best-paying. A salary someone in
    # Spain reported directly is worth more than any number scraped from a
    # submission site, so it sorts above one however large that number is.
    paid = sorted(
        ((c, h) for c, h in zip(companies, heads) if h),
        key=lambda ch: (ch[1].band.get("source") not in VOUCHED, -ch[1].value,
                        ch[0]["company"].casefold()))
    unpaid = sorted((c for c, h in zip(companies, heads) if not h),
                    key=lambda c: c["company"].casefold())

    out: list[str] = []
    for title, group in (
        ("60k and above", [(c, h) for c, h in paid if h.value >= lib.THRESHOLD_EUR]),
        ("Under 60k", [(c, h) for c, h in paid if h.value < lib.THRESHOLD_EUR]),
    ):
        if group:
            out += [f"## {title}", "", *PAY_HEADER]
            for company, head in group:
                out += pay_rows(company, head)
            out.append("")
    if unpaid:
        out += ["## No pay on file", "", "| Company | Levels.fyi | Jobs |", "| --- | --- | --- |"]
        out += [f"| {company_cell(c)} | {status_cell(c)} | {jobs_cell(c)} |" for c in unpaid]
    return "\n".join(out).rstrip()


def main() -> int:
    companies = lib.load_companies()
    lib.save_companies(companies)
    heads = [headline(company) for company in companies]
    readme = README.read_text(encoding="utf-8")
    readme = replace_block(readme, "STATS", render_stats(companies, heads))
    readme = replace_block(readme, "COMPANIES", render_companies(companies, heads))
    README.write_text(readme, encoding="utf-8")
    print(f"Built README.md from {len(companies)} companies.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
