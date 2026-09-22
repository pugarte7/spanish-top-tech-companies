"""Reading, writing and scoring companies.csv, the only data file."""
from __future__ import annotations

import csv
import datetime as dt
import io
import os
import pathlib
import re

ROOT = pathlib.Path(__file__).resolve().parent.parent
DATA = ROOT / "companies.csv"

# Every software engineer in Spain with this much experience is a row,
# whatever they are paid; the median over them is what a company pays a senior.
# Seniority is the years, not whatever the company calls the level: an L4 with
# eight years counts, a "Senior" with two does not.
SENIOR_YEARS = 5
# A company is on the list while at least one of its rows reaches this base,
# and the share of its rows that do is shown beside the median. The bar picks
# companies and measures them; it never trims the salaries the median is of.
THRESHOLD_EUR = 60_000

# Compensation older than this is shown as stale rather than quietly trusted.
STALE_DAYS = 365

SOURCES = ["levels.fyi", "company-published", "offer-letter", "community",
           "job-posting", "glassdoor", "other"]

# A salary someone in Spain told the maintainer directly outranks anything
# crowdsourced, so it sorts above it however large the crowdsourced one is.
VOUCHED = ("offer-letter", "community")

# One row per salary entry: one software engineer in Spain, their years of
# experience and what they are paid. The company's own columns are repeated on
# each of its rows.
#
# A company is on the list only while one of its entries is at the bar. A row
# with the entry columns empty is how a company is added by hand,
# `Name,linkedin_id`, and it lasts until the fetcher has asked Levels.fyi.
IDENTITY_COLUMNS = ["company", "linkedin_ids", "linkedin_url", "levels_slug", "levels_status"]
ENTRY_COLUMNS = ["base", "total", "years_experience", "level", "city", "reported",
                 "source", "source_url", "date", "notes"]
PROFILE_COLUMNS = ["website", "careers_url", "hq_city", "hq_country", "employees",
                   "sector", "year_founded", "about"]
COLUMNS = IDENTITY_COLUMNS + ENTRY_COLUMNS + PROFILE_COLUMNS
COMPANY_COLUMNS = IDENTITY_COLUMNS + PROFILE_COLUMNS

INTEGER_COLUMNS = {"base", "total", "year_founded"}
# Pipe-separated inside one cell.
LIST_COLUMNS = {"linkedin_ids", "sector"}


def blank_company(name: str, **fields) -> dict:
    company = {column: [] if column in LIST_COLUMNS else None for column in COMPANY_COLUMNS}
    company.update(company=name, entries=[], **fields)
    return company


def by_slug(companies: list[dict], slug: str) -> dict | None:
    return next((c for c in companies if c.get("levels_slug") == slug), None)


def by_name(companies: list[dict], name: str) -> dict | None:
    key = name.strip().casefold()
    return next((c for c in companies if c["company"].casefold() == key), None)


def years(raw) -> int | None:
    """Years of experience as a number, the low end of a range.

    Levels.fyi records it as a number or as a bucket like "5-10" or "11+".
    "5-10" is at least five years, so it counts as five: rounding a bucket up
    would call someone senior on years they may not have.
    """
    found = re.fullmatch(r"\s*(\d+)\s*(?:[-–]\s*\d+|\+)?\s*", str(raw)) if raw is not None else None
    return int(found.group(1)) if found else None


def is_senior(entry: dict) -> bool:
    """A row: a software engineer with SENIOR_YEARS or more and a known base."""
    experience = years(entry.get("years_experience"))
    return experience is not None and experience >= SENIOR_YEARS and bool(entry.get("base"))


def at_bar(entry: dict) -> bool:
    return (entry.get("base") or 0) >= THRESHOLD_EUR


def listed(company: dict) -> bool:
    """On the list: at least one engineer on file at the bar."""
    return any(at_bar(entry) for entry in company.get("entries") or [])


def _parse(column: str, raw: str | None):
    raw = (raw or "").strip()
    if column in LIST_COLUMNS:
        return [part.strip() for part in raw.split("|") if part.strip()]
    if not raw:
        return None
    if column in INTEGER_COLUMNS:
        if not re.fullmatch(r"\d+", raw):
            raise ValueError(f"{column} {raw!r} is not a whole number")
        return int(raw)
    return raw


def _format(column: str, value) -> str:
    if value is None:
        return ""
    if column in LIST_COLUMNS:
        return "|".join(str(v) for v in value)
    return str(value)


def read(path: pathlib.Path | None = None) -> tuple[list[dict], list[str]]:
    """Every company in the file, plus whatever kept a cell from being read.

    Company columns may be left blank on some of a company's rows and are
    filled from the others. Two different values for the same company are a
    problem, not a choice to make silently.
    """
    path = path or DATA
    companies: dict[str, dict] = {}
    problems: list[str] = []
    with path.open(encoding="utf-8", newline="") as fh:
        reader = csv.DictReader(fh)
        unknown = [c for c in reader.fieldnames or [] if c not in COLUMNS]
        if unknown:
            # Saving would drop them without a word.
            problems.append(f"{path.name}: unknown columns {unknown}")
        for row in reader:
            line = reader.line_num
            if row.get(None):
                problems.append(f"line {line}: more cells than the header has columns")
            name = (row.get("company") or "").strip()
            if not name:
                if any((v or "").strip() for v in row.values() if isinstance(v, str)):
                    problems.append(f"line {line}: no company name")
                continue
            company = companies.get(name.casefold())
            if company is None:
                company = companies[name.casefold()] = blank_company(name, _lines=[])
            company["_lines"].append(line)
            if company["company"] != name:
                problems.append(f"line {line}: {name!r} is spelled {company['company']!r} above")

            values = {}
            for column in COLUMNS:
                try:
                    values[column] = _parse(column, row.get(column))
                except ValueError as exc:
                    problems.append(f"line {line}: {exc}")
                    values[column] = [] if column in LIST_COLUMNS else None

            for column in COMPANY_COLUMNS:
                value = values[column]
                if value in (None, []):
                    continue
                if company[column] in (None, []):
                    company[column] = value
                elif company[column] != value:
                    problems.append(f"line {line}: {name} has {column} {_format(column, value)!r} "
                                    f"here and {_format(column, company[column])!r} above")

            if any(values[column] is not None for column in ENTRY_COLUMNS):
                entry = {column: values[column] for column in ENTRY_COLUMNS}
                entry["_line"] = line
                company["entries"].append(entry)
    return list(companies.values()), problems


def load_companies(path: pathlib.Path | None = None) -> list[dict]:
    companies, problems = read(path)
    if problems:
        shown = "\n  ".join(problems[:10])
        raise SystemExit(f"{(path or DATA).name} does not read cleanly:\n  {shown}\n"
                         "Run python3 scripts/validate.py for the full list.")
    return companies


def month(raw) -> int:
    """A YYYY-MM as a number that sorts, 0 when there is none."""
    found = re.fullmatch(r"(\d{4})-(\d{2})", raw or "")
    return int(found.group(1)) * 12 + int(found.group(2)) if found else 0


def entry_order(entry: dict):
    """First-hand before crowdsourced, then best-paid, then most recent."""
    return (entry.get("source") not in VOUCHED, -(entry.get("base") or 0),
            -(entry.get("total") or 0), -(years(entry.get("years_experience")) or 0),
            -month(entry.get("reported")), entry.get("level") or "", entry.get("city") or "",
            entry.get("source_url") or "")


def save_companies(companies: list[dict], path: pathlib.Path | None = None) -> None:
    """Write every company back in one canonical order.

    Written to a temporary file and moved into place: this file is all the data
    there is, and a fetcher interrupted mid-write must not leave half of it.
    """
    path = path or DATA
    buffer = io.StringIO()
    writer = csv.DictWriter(buffer, fieldnames=COLUMNS, lineterminator="\n")
    writer.writeheader()
    for company in sorted(companies, key=lambda c: c["company"].casefold()):
        shared = {column: _format(column, company.get(column)) for column in COMPANY_COLUMNS}
        entries = sorted(company.get("entries") or [], key=entry_order)
        for entry in entries or [{}]:
            writer.writerow({**shared, **{column: _format(column, entry.get(column))
                                          for column in ENTRY_COLUMNS}})
    temporary = path.with_name(path.name + ".tmp")
    temporary.write_text(buffer.getvalue(), encoding="utf-8")
    os.replace(temporary, path)


def headline(company: dict) -> dict | None:
    """The entry a company is ranked by: first-hand first, then the best-paid."""
    entries = company.get("entries") or []
    return min(entries, key=entry_order) if entries else None


def parse_date(raw) -> dt.date | None:
    if not raw:
        return None
    if isinstance(raw, dt.date):
        return raw
    try:
        return dt.date.fromisoformat(str(raw))
    except ValueError:
        return None


def today_utc() -> dt.date:
    """Always UTC.

    CI runs in UTC and compares its build byte-for-byte against the committed
    one. A contributor in Madrid building at 00:30 local is still on the
    previous UTC day, so a local `date.today()` would silently disagree with
    the server and fail the build.
    """
    return dt.datetime.now(dt.timezone.utc).date()


def is_stale(raw, today: dt.date | None = None) -> bool:
    day = parse_date(raw)
    if day is None:
        return True
    today = today or today_utc()
    return (today - day).days > STALE_DAYS


def fmt_eur(amount) -> str:
    if amount is None:
        return "?"
    return f"{amount // 1000}k" if amount >= 1000 else str(amount)


def slugify(name: str) -> str:
    out = []
    for ch in name.lower():
        if ch.isalnum():
            out.append(ch)
        elif out and out[-1] != "-":
            out.append("-")
    return "".join(out).strip("-")
