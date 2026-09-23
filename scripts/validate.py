#!/usr/bin/env python3
"""Validate companies.csv. Exits non-zero on errors; warnings are advisory."""
from __future__ import annotations

import re
import sys

import lib

errors: list[str] = []
warnings: list[str] = []

SLUG = re.compile(r"^[a-z0-9]+(-[a-z0-9]+)*$")
URL = re.compile(r"^https?://\S+$")
DATE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
# The only Levels.fyi page that carries a software engineer's own submission in
# Spain: one company, the software-engineer family, a named location.
ENTRY_PAGE = re.compile(r"levels\.fyi/companies/[^/]+/salaries/software-engineer/locations/")
STATUSES = ("resolved", "review", "unmatched")
MAX_EUR = 2_000_000


def check_date(where: str, label: str, raw) -> None:
    if raw is None:
        return
    if not DATE.match(str(raw)) or lib.parse_date(raw) is None:
        errors.append(f"{where}: {label} {raw!r} is not a YYYY-MM-DD date")
    elif lib.parse_date(raw) > lib.today_utc():
        errors.append(f"{where}: {label} is in the future")


def check_entry(where: str, entry: dict) -> None:
    base, total = entry.get("base"), entry.get("total")
    if base is None:
        errors.append(f"{where}: no base salary")
    # Levels.fyi rows are every senior, paid whatever they are paid; the median
    # needs the ones under the bar. A first-hand row is the maintainer saying
    # "I know they pay that", and "that" means the bar.
    elif base < lib.THRESHOLD_EUR and entry.get("source") in lib.VOUCHED:
        errors.append(f"{where}: a first-hand entry under {lib.fmt_eur(lib.THRESHOLD_EUR)} "
                      "vouches for nothing this list is about")
    for column, amount in (("base", base), ("total", total)):
        if amount is not None and amount > MAX_EUR:
            errors.append(f"{where}: {column} {amount} is not a salary")

    experience = entry.get("years_experience")
    if lib.years(experience) is None:
        errors.append(f"{where}: years_experience {experience!r} must be a number of years, "
                      "or a range like 5-10 or 11+")
    elif lib.years(experience) < lib.SENIOR_YEARS:
        errors.append(f"{where}: {experience} years of experience is under "
                      f"{lib.SENIOR_YEARS}, so it does not belong on the list")
    if entry.get("reported") and not re.fullmatch(r"\d{4}-\d{2}", entry["reported"]):
        errors.append(f"{where}: reported {entry['reported']!r} must be YYYY-MM")

    if entry.get("source") not in lib.SOURCES:
        errors.append(f"{where}: source {entry.get('source')!r} must be one of "
                      f"{', '.join(lib.SOURCES)}")
    url = entry.get("source_url") or ""
    if url and not URL.match(url):
        errors.append(f"{where}: source_url {url!r} is not a URL")
    check_date(where, "date", entry.get("date"))

    # A Levels.fyi company page is NOT filtered to Spain: it shows the
    # company's global figures in the reader's currency. Entries sourced from
    # one are somebody else's country's pay. Only URLs that name a location
    # are trustworthy here.
    if "levels.fyi" in url and "/locations/" not in url:
        errors.append(
            f"{where}: cites a Levels.fyi URL with no location in it ({url}) "
            "- that data is not Spain-scoped"
        )
    # Every other Levels.fyi page publishes a figure pooled across people, or
    # another job family's pay. Neither is one software engineer's salary.
    elif "levels.fyi" in url and not ENTRY_PAGE.search(url):
        errors.append(
            f"{where}: cites a Levels.fyi page that is not a company's software-engineer "
            f"page ({url}) - it cannot hold one engineer's salary"
        )

    if lib.is_stale(entry.get("date")):
        warnings.append(f"{where}: not verified in over a year")


def check_company(where: str, company: dict) -> None:
    # A company is on the list only while its seniors' median base is at the
    # bar. A bare `Name,linkedin_id` row is how one is added by hand, and it is
    # gone the moment fetch_spain.py finds the median below, so a lasting one
    # is a mistake.
    if not lib.listed(company):
        errors.append(f"{where}: median base {lib.fmt_eur(lib.median_base(company))} is under "
                      f"{lib.fmt_eur(lib.THRESHOLD_EUR)}, so it is not on the list. Run "
                      "fetch_spain.py for it, add a first-hand entry, or remove the rows")

    for column in ("linkedin_url", "website", "careers_url"):
        found = company.get(column)
        if found and not URL.match(found):
            errors.append(f"{where}: {column} {found!r} is not a URL")
    for linkedin_id in company.get("linkedin_ids") or []:
        if not linkedin_id.isdigit():
            errors.append(f"{where}: linkedin_ids has {linkedin_id!r}, not a numeric LinkedIn id")
    if not company.get("linkedin_ids") and not company.get("linkedin_url"):
        warnings.append(f"{where}: no LinkedIn id or URL, so no link to open roles")

    slug, status = company.get("levels_slug"), company.get("levels_status")
    if slug and not SLUG.match(slug):
        errors.append(f"{where}: levels_slug {slug!r} must be a kebab-case slug")
    if status is not None and status not in STATUSES:
        errors.append(f"{where}: levels_status {status!r} must be one of {', '.join(STATUSES)}")
    if slug and status == "unmatched":
        errors.append(f"{where}: levels_status says unmatched but levels_slug is {slug!r}")
    if not slug and status in ("resolved", "review"):
        errors.append(f"{where}: levels_status says {status} but there is no levels_slug")

    country = company.get("hq_country")
    if country and not re.fullmatch(r"[A-Z]{2}", country):
        errors.append(f"{where}: hq_country {country!r} must be an ISO 3166-1 alpha-2 code")
    for sector in company.get("sector") or []:
        if not SLUG.match(sector):
            errors.append(f"{where}: sector {sector!r} must be a kebab-case slug")

    seen = set()
    for entry in company.get("entries") or []:
        key = tuple(entry.get(column) for column in lib.ENTRY_COLUMNS)
        if key in seen:
            # Two engineers can match on every column, so this is only a warning.
            warnings.append(f"line {entry['_line']} ({company['company']}): the same "
                            "entry twice")
        seen.add(key)


def main() -> int:
    if not lib.DATA.exists():
        print(f"{lib.DATA.name} is missing.")
        return 1
    companies, problems = lib.read()
    errors.extend(problems)

    seen_slugs: dict[str, str] = {}
    seen_ids: dict[str, str] = {}
    for company in companies:
        name = company["company"]
        where = f"line {company['_lines'][0]} ({name})"
        check_company(where, company)
        for entry in company["entries"]:
            check_entry(f"line {entry['_line']} ({name})", entry)

        slug = company.get("levels_slug")
        if slug in seen_slugs:
            errors.append(f"{where}: levels_slug '{slug}' already used by {seen_slugs[slug]}")
        elif slug:
            seen_slugs[slug] = name
        for linkedin_id in company.get("linkedin_ids") or []:
            if linkedin_id in seen_ids:
                errors.append(f"{where}: linkedin id {linkedin_id} already used by "
                              f"{seen_ids[linkedin_id]}")
            else:
                seen_ids[linkedin_id] = name

    for warning in warnings:
        print(f"warn  {warning}")
    for error in errors:
        print(f"ERROR {error}")

    entries = sum(len(c["entries"]) for c in companies)
    print(f"\n{len(companies)} companies, {entries} entries, "
          f"{len(errors)} errors, {len(warnings)} warnings")
    return 1 if errors else 0


if __name__ == "__main__":
    sys.exit(main())
