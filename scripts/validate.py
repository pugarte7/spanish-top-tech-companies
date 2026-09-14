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
STATUSES = ("resolved", "review", "unmatched")
MAX_EUR = 2_000_000


def check_date(where: str, label: str, value) -> None:
    if value is None:
        return
    if not DATE.match(str(value)) or lib.parse_date(value) is None:
        errors.append(f"{where}: {label} {value!r} is not a YYYY-MM-DD date")
    elif lib.parse_date(value) > lib.today_utc():
        errors.append(f"{where}: {label} is in the future")


def check_band(where: str, band: dict) -> None:
    role, level = band.get("role"), band.get("level")
    label = f"{role}/{level}"
    if not role or not SLUG.match(role):
        errors.append(f"{where}: role {role!r} must be a kebab-case slug")
    if level not in lib.LEVEL_ORDER:
        errors.append(f"{where}: level {level!r} must be one of {', '.join(lib.LEVEL_ORDER)}")

    figures = 0
    for block in ("base", "total"):
        ordered = [(part, band.get(f"{block}_{part}")) for part in ("min", "p50", "max")]
        ordered = [(part, value) for part, value in ordered if value is not None]
        figures += len(ordered)
        for (n1, v1), (n2, v2) in zip(ordered, ordered[1:]):
            if v1 > v2:
                errors.append(f"{where}: {label} has {block}_{n1} {v1} > {block}_{n2} {v2}")
        for part, value in ordered:
            if value > MAX_EUR:
                errors.append(f"{where}: {label} {block}_{part} {value} is not a salary")
    if not figures:
        errors.append(f"{where}: {label} has no base or total figure")
    if band.get("sample_size") == 0:
        errors.append(f"{where}: {label} sample_size must be at least 1, or blank")

    if band.get("source") not in lib.SOURCES:
        errors.append(f"{where}: {label} source {band.get('source')!r} must be one of "
                      f"{', '.join(lib.SOURCES)}")
    url = band.get("source_url") or ""
    if url and not URL.match(url):
        errors.append(f"{where}: {label} source_url {url!r} is not a URL")
    check_date(where, f"{label} date", band.get("date"))

    # A Levels.fyi company page is NOT filtered to Spain: it shows the
    # company's global figures in the reader's currency. Bands sourced from
    # one are somebody else's country's pay. Only URLs that name a location
    # are trustworthy here.
    if "levels.fyi" in url and "/locations/" not in url:
        errors.append(
            f"{where}: {label} cites a Levels.fyi URL with no location in it ({url}) "
            "- that data is not Spain-scoped"
        )

    if role and role not in lib.CANONICAL_ROLES:
        warnings.append(f"{where}: '{role}' is not a canonical role slug (see METHODOLOGY.md)")
    if lib.is_stale(band.get("date")):
        warnings.append(f"{where}: {label} not verified in over a year")


def check_spain_check(where: str, company: dict) -> None:
    """`spain_check` says Levels.fyi had nothing. Hold it to that.

    A role cannot both be on file as having no Spanish pay and carry a Spanish
    band, and a company that claims both is one the fetcher failed to clean up.
    The front page reads these columns to decide whether a blank row says
    "asked, nothing published" or "nobody has looked", so a wrong one is a false
    statement on the front page rather than a tidiness problem.
    """
    checked = company.get("spain_check_roles") or []
    if not checked:
        if company.get("spain_check_date") or company.get("spain_check_served"):
            errors.append(f"{where}: spain_check_date or spain_check_served without "
                          "spain_check_roles")
        return
    check_date(where, "spain_check_date", company.get("spain_check_date"))
    documented = {band.get("role") for band in company.get("bands") or []}
    for role in checked:
        if not SLUG.match(role):
            errors.append(f"{where}: spain_check_roles has {role!r}, not a role slug")
        if role in documented:
            errors.append(
                f"{where}: spain_check says '{role}' has no Spanish pay, but a "
                f"{role} band is on file"
            )


def check_company(where: str, company: dict) -> None:
    for column in ("linkedin_url", "website", "careers_url"):
        value = company.get(column)
        if value and not URL.match(value):
            errors.append(f"{where}: {column} {value!r} is not a URL")
    for value in company.get("linkedin_ids") or []:
        if not value.isdigit():
            errors.append(f"{where}: linkedin_ids has {value!r}, not a numeric LinkedIn id")
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
    for band in company.get("bands") or []:
        key = tuple(band.get(c) for c in ("role", "level", "source", "source_url"))
        if key in seen:
            errors.append(f"line {band['_line']} ({company['company']}): the same "
                          f"{band.get('role')}/{band.get('level')} figure from the same source twice")
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
        check_spain_check(where, company)
        for band in company["bands"]:
            check_band(f"line {band['_line']} ({name})", band)

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

    bands = sum(len(c["bands"]) for c in companies)
    print(f"\n{len(companies)} companies, {bands} salary figures, "
          f"{len(errors)} errors, {len(warnings)} warnings")
    return 1 if errors else 0


if __name__ == "__main__":
    sys.exit(main())
