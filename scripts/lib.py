"""Reading, writing and scoring companies.csv, the only data file."""
from __future__ import annotations

import csv
import datetime as dt
import io
import os
import pathlib
import re
import statistics
import unicodedata

import taxonomy

ROOT = pathlib.Path(__file__).resolve().parent.parent
DATA = ROOT / "companies.csv"

# A company is on the main list while the median of its rows reaches this
# base, and the share of its rows that do is shown beside the median. The bar
# is applied to the aggregate, never to the rows the aggregate is of: filter
# positions by role first, compute the median, then filter companies by it.
THRESHOLD_EUR = 60_000
# A company whose median lands between the floor and the bar is kept on file
# and shown under "Need to improve": visible, and visibly under 60k. Below the
# floor it is not on the list at all (maintainer, 2026-09-23).
FLOOR_EUR = 50_000

# The public CSV is row-level by design. The website, the JSON API and the
# MCP server publish only aggregates, and an aggregate exists only when at
# least this many people contribute to the cell - a city × role × arrangement
# group of one or two names a person.
MIN_GROUP = 3

# Two Levels.fyi slugs, one employer. The alias's page and table are read
# together with the canonical slug's and filed under its company; discovery
# never lists an alias on its own, and validate.py refuses a row group for one.
SLUG_ALIASES = {
    "tiger-data": "timescale",   # Timescale renamed itself Tiger Data in 2025
    "meta": "facebook",          # same page; only `meta` has a table in the API
}
# Slugs struck off by hand, with why. Never fetched, never discovered.
EXCLUDED_SLUGS = {
    "abracadabra": "nobody could say what company this is",
    "data-native-systems-sl": "nobody could say what company this is",
    "freelancer": "self-employed, not a company",
    "openbank": "removed by the maintainer",
    "samsung-zhilabs": "removed by the maintainer",
}

# Compensation older than this is shown as stale rather than quietly trusted.
STALE_DAYS = 365

SOURCES = ["levels.fyi", "company-published", "offer-letter", "community",
           "job-posting", "glassdoor", "other"]

# A job ad's range is what a company offered, not what anyone is paid, so
# it is kept beside the salaries and never counted among them.
POSTED = ("job-posting",)

# A salary someone in Spain told the maintainer directly outranks anything
# crowdsourced, so it sorts above it however large the crowdsourced one is.
VOUCHED = ("offer-letter", "community")

# The README's question is about software engineers, at any experience since
# 2026-10-17. The CSV holds every role; the README population is a filter over
# the file, not the file itself.
SWE = "software-engineer"

# One row per salary entry: one person in Spain, their role, years of
# experience and what they are paid. The company's own columns are repeated
# on each of its rows.
#
# A row with the entry columns empty is how a company is added by hand,
# `Name,linkedin_id`, and it lasts until the fetcher has asked Levels.fyi.
# New columns since the software-engineer-only days are normalized, never
# free text: title and specialization are the official taxonomy's slugs or
# empty, so a row still cannot point at a person.
IDENTITY_COLUMNS = ["company", "linkedin_ids", "linkedin_url", "levels_slug", "levels_status"]
ENTRY_COLUMNS = ["role", "base", "base_max", "total", "bonus", "stock", "currency",
                 "years_experience", "level", "title", "specialization",
                 "city", "region", "work_arrangement", "employment_type",
                 "perspective", "reported", "source", "source_url", "date",
                 "notes"]
PROFILE_COLUMNS = ["website", "careers_url", "hq_city", "hq_country", "employees",
                   "sector", "year_founded", "about", "company_type",
                   "remote_policy", "offices", "stack", "radar_slug",
                   "github_url", "cif"]
COLUMNS = IDENTITY_COLUMNS + ENTRY_COLUMNS + PROFILE_COLUMNS
COMPANY_COLUMNS = IDENTITY_COLUMNS + PROFILE_COLUMNS

INTEGER_COLUMNS = {"base", "base_max", "total", "bonus", "stock", "year_founded"}
# Pipe-separated inside one cell.
LIST_COLUMNS = {"linkedin_ids", "sector", "offices", "stack"}

# Values work_arrangement, employment_type and perspective take, and what
# company_type and remote_policy take. Unknown values get a warning, not an
# error: Levels.fyi adds values and the data is still worth keeping.
WORK_ARRANGEMENTS = ("office", "hybrid", "remote")
EMPLOYMENT_TYPES = ("full_time", "part_time", "contract", "internship")
PERSPECTIVES = ("employee", "offer")
COMPANY_TYPES = ("product", "consultancy", "no-tech")
REMOTE_POLICIES = ("remote", "hybrid", "office")

# Levels.fyi writes locations as "City, XX, Spain" with ISO 3166-2 region
# codes; Spain Tech Radar writes the community's Spanish name. Both
# normalize to these codes.
REGIONS = {
    "AN": "Andalusia", "AR": "Aragon", "AS": "Asturias", "CB": "Cantabria",
    "CE": "Ceuta", "CL": "Castile and León", "CM": "Castilla-La Mancha",
    "CN": "Canary Islands", "CT": "Catalonia", "EX": "Extremadura",
    "GA": "Galicia", "IB": "Balearic Islands", "MD": "Community of Madrid",
    "ML": "Melilla", "MU": "Region of Murcia", "NC": "Navarre",
    "PV": "Basque Country", "RI": "La Rioja", "VC": "Valencian Community",
}
COMUNIDADES = {
    "andalucia": "AN", "andalusia": "AN", "aragon": "AR", "asturias": "AS",
    "principado de asturias": "AS", "cantabria": "CB", "ceuta": "CE",
    "castilla y leon": "CL", "castile and leon": "CL", "castilla-la mancha": "CM",
    "castilla la mancha": "CM", "canarias": "CN", "canary islands": "CN",
    "islas canarias": "CN", "cataluna": "CT", "catalunya": "CT",
    "catalonia": "CT", "extremadura": "EX", "galicia": "GA",
    "illes balears": "IB", "islas baleares": "IB", "baleares": "IB",
    "balearic islands": "IB", "comunidad de madrid": "MD", "madrid": "MD",
    "community of madrid": "MD", "melilla": "ML", "region de murcia": "MU",
    "murcia": "MU", "navarra": "NC", "comunidad foral de navarra": "NC",
    "navarre": "NC", "pais vasco": "PV", "euskadi": "PV",
    "basque country": "PV", "la rioja": "RI", "comunitat valenciana": "VC",
    "comunidad valenciana": "VC", "valencia": "VC", "valencian community": "VC",
}
# Misspellings observed in Levels.fyi's own city field, keyed by the
# normalized raw string.
CITY_FIXES = {
    "1a coruna": "A Coruna",
    "a coruna": "A Coruna",
    "la coruna": "A Coruna",
}


def _norm_words(text) -> str:
    """Lowercase, accent-free, every non-alphanumeric run one space."""
    raw = unicodedata.normalize("NFKD", str(text or ""))
    raw = "".join(ch for ch in raw if not unicodedata.combining(ch))
    return re.sub(r"[^a-z0-9+#]+", " ", raw.casefold()).strip()


def region_code(text) -> str | None:
    """"CT", or "Cataluña", or "Catalonia", to "CT". None if unknown."""
    raw = str(text or "").strip()
    if re.fullmatch(r"[A-Za-z]{2}", raw) and raw.upper() in REGIONS:
        return raw.upper()
    return COMUNIDADES.get(_norm_words(raw))


def split_location(where) -> tuple[str | None, str | None]:
    """"Barcelona, CT, Spain" to ("Barcelona", "CT")."""
    parts = [part.strip() for part in str(where or "").split(",")]
    if not parts or not parts[0]:
        return None, None
    city = CITY_FIXES.get(_norm_words(parts[0]), parts[0])
    region = region_code(parts[1]) if len(parts) >= 3 else None
    return city or None, region


def _lookup(table: dict, role: str, raw) -> str | None:
    """The slug whose official labels match the normalized text."""
    words = _norm_words(raw)
    if not words:
        return None
    for slug, (name, aka) in (table.get(role) or {}).items():
        if words in {_norm_words(label) for label in [slug.replace("-", " "), name, *aka]}:
            return slug
    return None


# Labels authors write that clearly mean one official specialization,
# assigned by hand: the family's own name (or its initials) means the generic
# bucket, and an abbreviation of a spec's name means the spec. Anything else
# unmatched stays empty - it never becomes a guess.
EXTRA_SPEC_ALIASES = {
    "data-scientist": {
        "general": ("DS", "Data Science", "Data Scientist", "Data"),
        "ml": ("ML / AI", "AI", "GenAI", "Gen AI", "LLM", "Deep Learning"),
    },
    "product-manager": {"general": ("Product", "Product Manager")},
    "product-designer": {"generalist": ("Product Design", "Product Designer", "General")},
    "project-manager": {"general": ("Project", "Project Manager")},
    "solution-architect": {"general": ("Solution Architect", "Solutions Architect", "SA")},
    "software-engineer": {
        "full-stack": ("Fullstack", "Fullstack Developer", "Full Stack Developer"),
    },
}


def specialization_slug(role: str, raw) -> str | None:
    """A submission's focusTag text to the official specialization slug.

    The field is free text over a fixed catalog: "Machine Learning" for
    ml-ai, a sub-tag's name for its parent tag. Anything that matches no
    label and no hand-checked alias is kept out rather than stored as
    written.
    """
    direct = _lookup(taxonomy.SPECIALIZATIONS, role, raw)
    if direct:
        return direct
    words = _norm_words(raw)
    for slug, labels in (EXTRA_SPEC_ALIASES.get(role) or {}).items():
        if words in {_norm_words(label) for label in labels}:
            return slug
    return None


SENIORITY_PREFIXES = {"senior", "sr", "junior", "jr", "lead", "principal",
                      "staff", "chief", "intern", "trainee", "graduate"}
SENIORITY_SUFFIXES = {"i", "ii", "iii", "iv", "v", "vi"}
# "ML Engineer" is the catalog's "Machine Learning Engineer"; word-level
# expansions only.
TITLE_EXPANSIONS = {"ml": "machine learning", "sre": "site reliability",
                    "qa": "quality assurance"}


def title_slug(role: str, raw) -> str | None:
    """A submission's free-text title to the official title slug.

    Authors write "Senior Data Engineer" and "Data Engineer II"; the catalog
    knows "Data Engineer". Seniority words are stripped for matching only if
    the whole title matches no label: "Lead Data Engineer" is data-engineer,
    but a title officially named "Principal Scientist" still wins on its own
    name. Two more spellings are tried ("iOS Developer" is the catalog's
    "iOS Engineer"), then unrecognized titles stay empty.
    """
    words = _norm_words(raw)
    if not words:
        return None
    direct = _lookup(taxonomy.TITLES, role, words)
    if direct:
        return direct
    parts = [w for w in words.split() if w not in SENIORITY_PREFIXES]
    while parts and (parts[-1] in SENIORITY_SUFFIXES or parts[-1].isdigit()):
        parts.pop()
    stripped = " ".join(parts)
    for variant in {stripped,
                    re.sub(r"\bdevelopers?\b", "engineer", stripped),
                    " ".join(TITLE_EXPANSIONS.get(w, w) for w in stripped.split())}:
        if variant and _lookup(taxonomy.TITLES, role, variant):
            return _lookup(taxonomy.TITLES, role, variant)
    return None


# Job ads have only a free-text position. These read it into a role, in
# order (a "Tech Project Manager" is a project manager before it is tech),
# matched against _norm_words() of the position. A position none of them
# matches - "CTO", "Head of sales" - is not stored.
POSTING_ROLES = [
    (r"\b(engineering manager|head of engineering|(vp|director) of engineering)\b",
     "software-engineering-manager"),
    (r"\bproduct (manager|owner)\b", "product-manager"),
    (r"\b(project|delivery) manager\b", "project-manager"),
    (r"\bdata scientist\b", "data-scientist"),
    (r"\bdata analyst\b", "data-analyst"),
    (r"\b((product|ux|ui) )+designer\b|\bdisenador", "product-designer"),
    (r"\bsolutions? architect\b", "solution-architect"),
    (r"\bit manager\b", "it-manager"),
    (r"\b(developer|engineer|desarrollador|programador|front ?end|back ?end|full ?stack"
     r"|devops|sre|tech lead|qa)\b", SWE),
]
# The catalog's titles for the generic shapes ads use ("Senior Frontend
# Developer"), tried when title_slug() finds no exact title.
POSTING_TITLES = [
    (r"\b(sre|site reliability)\b", "site-reliability-engineer"),
    (r"\bdevops\b", "devops-engineer"),
    (r"\b(qa|quality assurance)\b", "quality-assurance-(qa)-software-engineer"),
    (r"\breact native\b", "react-native-engineer"),
    (r"\bandroid\b", "android-engineer"),
    (r"\bios\b", "ios-engineer"),
    (r"\bfull ?stack\b", "full-stack-software-engineer"),
    (r"\bfront ?end\b", "frontend-software-engineer"),
    (r"\bback ?end\b", "backend-software-engineer"),
]


def posting_role(position) -> tuple[str, str | None] | None:
    """A job ad's position to (role, title slug), or None if it names no role."""
    words = _norm_words(position)
    role = next((role for pattern, role in POSTING_ROLES if re.search(pattern, words)), None)
    if role is None:
        return None
    title = title_slug(role, position)
    if title is None and role == SWE:
        title = next((slug for pattern, slug in POSTING_TITLES if re.search(pattern, words)), None)
    return role, title


def title_spec(role: str, title: str | None) -> str | None:
    """The specialization a known title implies, for rows with no focusTag."""
    return taxonomy.TITLE_TO_SPEC.get(role, {}).get(title or "")


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


def salaries(company: dict) -> list[dict]:
    """What people at the company are paid: every row but the job ads."""
    return [entry for entry in company.get("entries") or []
            if entry.get("source") not in POSTED]


def postings(company: dict) -> list[dict]:
    """Job ads: a range from `base` to `base_max`, either end may be missing."""
    return [entry for entry in company.get("entries") or []
            if entry.get("source") in POSTED]


def readme_entries(company: dict) -> list[dict]:
    """The population the README describes: software engineers with a base.

    Until 2026-10-17 only those with 5+ years counted; the maintainer dropped
    the cut once the feed carried every experience level ("I think we no
    longer need to have the 5+ exp data"). Other roles still never count.
    """
    return [entry for entry in salaries(company)
            if entry.get("role") == SWE and entry.get("base")]


def at_bar(entry: dict) -> bool:
    return (entry.get("base") or 0) >= THRESHOLD_EUR


def median_base(company: dict) -> int | None:
    bases = [entry["base"] for entry in readme_entries(company)]
    return round(statistics.median(bases)) if bases else None


def competitive(company: dict) -> bool:
    """On the main list: the median base of the engineers on file is at the bar.

    The bar is a property of the company, not of a row, so it is applied after
    aggregating: "solo aquellas empresas donde el salario medio de las personas
    es superior a 60k". Filtering rows by pay first was the
    2026-09-16 rule, and it made any company with one well-paid engineer look
    competitive; "at least one row at the bar" was the same mistake one step
    removed, and lasted a day.
    """
    return (median_base(company) or 0) >= THRESHOLD_EUR


def listed(company: dict) -> bool:
    """On the README at all: its software engineers median at the floor."""
    return (median_base(company) or 0) >= FLOOR_EUR


def canonical(slug: str) -> str:
    return SLUG_ALIASES.get(slug, slug)


def aliases_of(slug: str) -> list[str]:
    return [alias for alias, target in SLUG_ALIASES.items() if target == slug]


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
    """First-hand before crowdsourced, then by role, best-paid, most recent."""
    return (entry.get("source") not in VOUCHED, entry.get("role") or "",
            -(entry.get("base") or 0), -(entry.get("total") or 0),
            -(years(entry.get("years_experience")) or 0),
            -month(entry.get("reported")), entry.get("level") or "",
            entry.get("city") or "", entry.get("source_url") or "")


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


def office_str(municipio: str, region: str | None, lat, lon) -> str:
    """One offices-list item: "Barcelona, CT (41.3799,2.1687)"."""
    coords = ""
    if isinstance(lat, (int, float)) and isinstance(lon, (int, float)):
        coords = f" ({lat},{lon})"
    return f"{municipio}, {region}{coords}" if region else f"{municipio}{coords}"


def parse_office(raw: str):
    """The inverse of office_str: (municipio, region, lat, lon)."""
    found = re.fullmatch(r"(.+?)(?:, ([A-Z]{2}))?(?: \((-?[\d.]+),(-?[\d.]+)\))?",
                         raw.strip())
    if not found:
        return raw.strip(), None, None, None
    lat = float(found.group(3)) if found.group(3) else None
    lon = float(found.group(4)) if found.group(4) else None
    return found.group(1), found.group(2), lat, lon
