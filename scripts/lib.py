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

# A company makes the list if any documented role/level reaches this in base salary.
THRESHOLD_EUR = 60_000

# Compensation older than this is shown as stale rather than quietly trusted.
STALE_DAYS = 365

LEVEL_ORDER = [
    "intern", "junior", "mid", "senior", "staff",
    "principal", "lead", "manager", "director",
    "all",  # aggregate across every level; sorts last
]

# Canonical role slugs. Anything else validates but gets a warning, so the
# table doesn't end up with data-engineer, data_engineer and dataengineer.
# The last six are Levels.fyi's own job families, which the fetchers write.
CANONICAL_ROLES = [
    "data-engineer", "analytics-engineer", "data-scientist", "data-analyst",
    "machine-learning-engineer", "ai-engineer", "software-engineer",
    "backend-engineer", "frontend-engineer", "fullstack-engineer",
    "mobile-engineer", "platform-engineer", "devops-engineer", "sre",
    "security-engineer", "qa-engineer", "engineering-manager",
    "product-manager", "product-designer", "data-engineering-manager",
    "software-engineering-manager", "solution-architect", "hardware-engineer",
    "business-analyst", "security-analyst", "information-technologist",
]

SOURCES = ["levels.fyi", "company-published", "offer-letter", "community",
           "job-posting", "glassdoor", "other"]

# One row per salary figure, the company's own columns repeated on each of its
# rows. A company with no figure still gets a row with the band columns empty:
# that row is what carries spain_check, so "asked, nothing published" has
# somewhere to live.
#
# Identity comes first so a company can be added by hand as `Name,linkedin_id`.
IDENTITY_COLUMNS = ["company", "linkedin_ids", "linkedin_url", "levels_slug", "levels_status"]
BAND_COLUMNS = [
    "role", "level", "base_min", "base_p50", "base_max", "total_min", "total_p50",
    "total_max", "sample_size", "source", "source_url", "date", "notes",
]
CHECK_COLUMNS = ["spain_check_date", "spain_check_roles", "spain_check_served"]
PROFILE_COLUMNS = ["website", "careers_url", "hq_city", "hq_country", "employees",
                   "sector", "year_founded", "about"]
COLUMNS = IDENTITY_COLUMNS + BAND_COLUMNS + CHECK_COLUMNS + PROFILE_COLUMNS
COMPANY_COLUMNS = IDENTITY_COLUMNS + CHECK_COLUMNS + PROFILE_COLUMNS

INTEGER_COLUMNS = {"base_min", "base_p50", "base_max", "total_min", "total_p50",
                   "total_max", "sample_size", "year_founded"}
# Pipe-separated inside one cell.
LIST_COLUMNS = {"linkedin_ids", "spain_check_roles", "sector"}


def blank_company(name: str, **fields) -> dict:
    company = {column: [] if column in LIST_COLUMNS else None for column in COMPANY_COLUMNS}
    company.update(company=name, bands=[], **fields)
    return company


def by_slug(companies: list[dict], slug: str) -> dict | None:
    return next((c for c in companies if c.get("levels_slug") == slug), None)


def by_name(companies: list[dict], name: str) -> dict | None:
    key = name.strip().casefold()
    return next((c for c in companies if c["company"].casefold() == key), None)


def add_company(companies: list[dict], name: str, **fields) -> dict:
    """Append a new company, refusing a name already taken.

    Rows are grouped by name, so a second "Meta" would not be a second company:
    it would merge into the first one on the next read and fail on its slug.
    """
    if by_name(companies, name):
        raise ValueError(f"{name!r} is already in {DATA.name}")
    company = blank_company(name, **fields)
    companies.append(company)
    return company


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
                if any((v or "").strip() for k, v in row.items() if isinstance(v, str)):
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

            if any(values[column] not in (None, []) for column in BAND_COLUMNS):
                band = {column: values[column] for column in BAND_COLUMNS}
                band["_line"] = line
                company["bands"].append(band)
    return list(companies.values()), problems


def load_companies(path: pathlib.Path | None = None) -> list[dict]:
    companies, problems = read(path)
    if problems:
        shown = "\n  ".join(problems[:10])
        raise SystemExit(f"{(path or DATA).name} does not read cleanly:\n  {shown}\n"
                         "Run python3 scripts/validate.py for the full list.")
    return companies


def band_order(band: dict):
    """Software engineering first, then most senior first, `all` last."""
    role = band.get("role") or ""
    level = band.get("level") or ""
    return (role != "software-engineer", role, level == "all", -level_rank(level),
            band.get("source") or "", band.get("source_url") or "")


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
        bands = sorted(company.get("bands") or [], key=band_order)
        for band in bands or [{}]:
            writer.writerow({**shared, **{column: _format(column, band.get(column))
                                          for column in BAND_COLUMNS}})
    temporary = path.with_name(path.name + ".tmp")
    temporary.write_text(buffer.getvalue(), encoding="utf-8")
    os.replace(temporary, path)


def reference(low, mid, high) -> int | None:
    """The single number a range is judged on.

    Median first. Falling back to the midpoint rather than the max keeps one
    outlier offer from dragging a company onto the list.
    """
    if mid is not None:
        return mid
    if low is not None and high is not None:
        return (low + high) // 2
    return high if high is not None else low


def figure(band: dict) -> tuple[int | None, str | None]:
    """(value, "base" or "total") a band is judged on.

    Base salary when we have it. Country-level aggregates only publish total
    compensation, and a company we only know through one of those is still
    worth listing, so fall back to it. The table prints base and total comp in
    separate columns, so which one a row rests on stays visible.
    """
    for block in ("base", "total"):
        value = reference(band.get(f"{block}_min"), band.get(f"{block}_p50"),
                          band.get(f"{block}_max"))
        if value is not None:
            return value, block
    return None, None


def level_value(band: dict) -> int | None:
    return figure(band)[0]


def top_band(company: dict) -> tuple[dict, int] | None:
    """Highest documented band, as (band, value)."""
    best = None
    for band in company.get("bands") or []:
        value = level_value(band)
        if value is not None and (best is None or value > best[1]):
            best = (band, value)
    return best


def qualifies(company: dict) -> bool:
    best = top_band(company)
    return best is not None and best[1] >= THRESHOLD_EUR


def parse_date(value) -> dt.date | None:
    if not value:
        return None
    if isinstance(value, dt.date):
        return value
    try:
        return dt.date.fromisoformat(str(value))
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


def is_stale(value, today: dt.date | None = None) -> bool:
    day = parse_date(value)
    if day is None:
        return True
    today = today or today_utc()
    return (today - day).days > STALE_DAYS


def fmt_eur(value) -> str:
    if value is None:
        return "?"
    return f"{value // 1000}k" if value >= 1000 else str(value)


def level_rank(name: str) -> int:
    return LEVEL_ORDER.index(name) if name in LEVEL_ORDER else len(LEVEL_ORDER)


def slugify(name: str) -> str:
    out = []
    for ch in name.lower():
        if ch.isalnum():
            out.append(ch)
        elif out and out[-1] != "-":
            out.append("-")
    return "".join(out).strip("-")
