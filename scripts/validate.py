#!/usr/bin/env python3
"""Validate companies.csv. Exits non-zero on errors; warnings are advisory."""
from __future__ import annotations

import re
import sys

import lib
import taxonomy

errors: list[str] = []
warnings: list[str] = []

SLUG = re.compile(r"^[a-z0-9]+(-[a-z0-9]+)*$")
URL = re.compile(r"^https?://\S+$")
DATE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
# The only Levels.fyi page that carries one person's own submission in Spain:
# one company, one job family, a named location - and the family has to be the
# row's own role.
ENTRY_PAGE = re.compile(r"levels\.fyi/companies/[^/]+/salaries/([a-z0-9-]+)/locations/")
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
    role = entry.get("role")
    if not role:
        errors.append(f"{where}: no role (a job-family slug from taxonomy.py)")
    elif role not in taxonomy.ROLES:
        errors.append(f"{where}: role {role!r} is not in taxonomy.py; run "
                      "fetch_taxonomy.py if Levels.fyi added it")
    if entry.get("specialization") and role in taxonomy.ROLES \
            and entry["specialization"] not in taxonomy.SPECIALIZATIONS.get(role, {}):
        errors.append(f"{where}: specialization {entry['specialization']!r} is not one "
                      f"{role} has")
    if entry.get("title") and role in taxonomy.ROLES \
            and entry["title"] not in taxonomy.TITLES.get(role, {}):
        errors.append(f"{where}: title {entry['title']!r} is not one {role} has")
    if entry.get("region") and entry["region"] not in lib.REGIONS:
        errors.append(f"{where}: region {entry['region']!r} is not a region code")
    for column, known in (("work_arrangement", lib.WORK_ARRANGEMENTS),
                          ("employment_type", lib.EMPLOYMENT_TYPES),
                          ("perspective", lib.PERSPECTIVES)):
        if entry.get(column) and entry[column] not in known:
            warnings.append(f"{where}: {column} {entry[column]!r} is a value "
                            "Levels.fyi has not sent before")
    if entry.get("currency") and not re.fullmatch(r"[A-Z]{3}", entry["currency"]):
        warnings.append(f"{where}: currency {entry['currency']!r} is not a currency code")

    base, total = entry.get("base"), entry.get("total")
    if base is None and total is None:
        errors.append(f"{where}: no base or total salary")
    # Levels.fyi rows are whatever was reported. A first-hand row about the
    # README's population - a software engineer - is the maintainer
    # saying "I know they pay that", and "that" means the bar.
    elif (base is not None and base < lib.THRESHOLD_EUR
          and entry.get("source") in lib.VOUCHED and role == lib.SWE):
        errors.append(f"{where}: a first-hand entry under {lib.fmt_eur(lib.THRESHOLD_EUR)} "
                      "vouches for nothing this list is about")
    for column, amount in (("base", base), ("total", total)):
        if amount is not None and amount > MAX_EUR:
            errors.append(f"{where}: {column} {amount} is not a salary")

    experience = entry.get("years_experience")
    if lib.years(experience) is None:
        errors.append(f"{where}: years_experience {experience!r} must be a number of years, "
                      "or a range like 5-10 or 11+")
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
    # another job family's pay. Neither is one person's salary for this role.
    elif "levels.fyi" in url:
        found = ENTRY_PAGE.search(url)
        if not found:
            errors.append(
                f"{where}: cites a Levels.fyi page that is not a company's "
                f"{role or '?'} page ({url}) - it cannot hold one person's salary"
            )
        elif found.group(1) != role:
            errors.append(
                f"{where}: cites the {found.group(1)} page but the row's role is "
                f"{role!r} ({url}) - a page for one family cannot hold another's salary"
            )

    if lib.is_stale(entry.get("date")):
        warnings.append(f"{where}: not verified in over a year")


def check_company(where: str, company: dict) -> None:
    # On file means having salaries: the CSV keeps every role and seniority,
    # so a company with none at all is either a hand-added row the fetcher
    # has not reached or a leftover to delete.
    if not company.get("entries"):
        errors.append(f"{where}: no salaries on file. Add a first-hand entry, let "
                      "fetch_spain.py reach it, or remove the row")

    for column, known in (("company_type", lib.COMPANY_TYPES),
                          ("remote_policy", lib.REMOTE_POLICIES)):
        if company.get(column) and company[column] not in known:
            warnings.append(f"{where}: {column} {company[column]!r} is not a known value")
    for office in company.get("offices") or []:
        city, region, lat, lon = lib.parse_office(office)
        if region and region not in lib.REGIONS:
            warnings.append(f"{where}: office {office!r} names a region that is not a code")
        if (lat is None) != (lon is None):
            warnings.append(f"{where}: office {office!r} has a half coordinate")
    if company.get("radar_slug") and not SLUG.match(company["radar_slug"]):
        warnings.append(f"{where}: radar_slug {company['radar_slug']!r} is not a slug")
    if company.get("cif") and not re.fullmatch(r"[A-Z]\d{7}[A-Z0-9]|\d{7,8}[A-Z]",
                                               company["cif"]):
        warnings.append(f"{where}: cif {company['cif']!r} does not look like a Spanish CIF")

    slug = company.get("levels_slug")
    if slug in lib.EXCLUDED_SLUGS:
        errors.append(f"{where}: {slug} was struck off ({lib.EXCLUDED_SLUGS[slug]}); remove the rows")
    if slug in lib.SLUG_ALIASES:
        errors.append(f"{where}: {slug} is an alias of {lib.SLUG_ALIASES[slug]}; file the rows "
                      "under that company")

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
