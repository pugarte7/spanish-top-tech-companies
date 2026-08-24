"""Shared loading and scoring logic for the dataset."""
from __future__ import annotations

import datetime as dt
import pathlib
import sys

try:
    import yaml
except ImportError:  # pragma: no cover
    sys.exit("PyYAML is missing. Run: pip install -r requirements.txt")

ROOT = pathlib.Path(__file__).resolve().parent.parent
COMPANIES_DIR = ROOT / "data" / "companies"
SCHEMA_PATH = ROOT / "schema" / "company.schema.json"
EXPORTS_DIR = ROOT / "exports"

# A company makes the list if any documented role/level reaches this in base salary.
THRESHOLD_EUR = 60_000

# Compensation older than this is shown as stale rather than quietly trusted.
STALE_DAYS = 365

LEVEL_ORDER = [
    "intern", "junior", "mid", "senior", "staff",
    "principal", "lead", "manager", "director",
]

# Canonical role slugs. Anything else validates but gets a warning, so the
# table doesn't end up with data-engineer, data_engineer and dataengineer.
CANONICAL_ROLES = [
    "data-engineer", "analytics-engineer", "data-scientist", "data-analyst",
    "machine-learning-engineer", "ai-engineer", "software-engineer",
    "backend-engineer", "frontend-engineer", "fullstack-engineer",
    "mobile-engineer", "platform-engineer", "devops-engineer", "sre",
    "security-engineer", "qa-engineer", "engineering-manager",
    "product-manager", "product-designer", "data-engineering-manager",
]


def normalize_dates(node):
    """Turn YAML's auto-parsed date objects back into ISO strings.

    `last_verified: 2026-08-01` unquoted becomes a datetime.date, which then
    fails the schema's "string" type with a baffling message. Nobody should
    have to remember to quote their dates.
    """
    if isinstance(node, dict):
        return {k: normalize_dates(v) for k, v in node.items()}
    if isinstance(node, list):
        return [normalize_dates(v) for v in node]
    if isinstance(node, dt.datetime):
        return node.date().isoformat()
    if isinstance(node, dt.date):
        return node.isoformat()
    return node


def load_companies(include_templates: bool = False) -> list[dict]:
    out = []
    for path in sorted(COMPANIES_DIR.glob("*.yml")):
        if path.name.startswith("_") and not include_templates:
            continue
        with path.open(encoding="utf-8") as fh:
            data = yaml.safe_load(fh)
        if not isinstance(data, dict):
            raise SystemExit(f"{path.name}: expected a YAML mapping at the top level")
        data = normalize_dates(data)
        data["_path"] = path
        out.append(data)
    return out


def reference_base(base: dict) -> int | None:
    """The single number we compare against the threshold.

    Median first. Falling back to the midpoint rather than the max keeps one
    outlier offer from dragging a company onto the list.
    """
    if not base:
        return None
    if base.get("p50") is not None:
        return base["p50"]
    lo, hi = base.get("min"), base.get("max")
    if lo is not None and hi is not None:
        return (lo + hi) // 2
    return hi if hi is not None else lo


def iter_levels(company: dict):
    """Yield (role_slug, level_dict) for every documented band."""
    for role in company.get("compensation", {}).get("roles", []) or []:
        for level in role.get("levels", []) or []:
            yield role["role"], level


def top_band(company: dict):
    """Highest documented band, as (role, level, reference_base)."""
    best = None
    for role, level in iter_levels(company):
        ref = reference_base(level.get("base", {}))
        if ref is None:
            continue
        if best is None or ref > best[2]:
            best = (role, level, ref)
    return best


def qualifies(company: dict) -> bool:
    best = top_band(company)
    return best is not None and best[2] >= THRESHOLD_EUR


def parse_date(value) -> dt.date | None:
    if not value:
        return None
    if isinstance(value, dt.date):
        return value
    try:
        return dt.date.fromisoformat(str(value))
    except ValueError:
        return None


def is_stale(value, today: dt.date | None = None) -> bool:
    day = parse_date(value)
    if day is None:
        return True
    today = today or dt.date.today()
    return (today - day).days > STALE_DAYS


def newest_verified(company: dict) -> dt.date | None:
    dates = [parse_date(lvl.get("last_verified")) for _, lvl in iter_levels(company)]
    dates = [d for d in dates if d]
    return max(dates) if dates else None


def fmt_eur(value) -> str:
    if value is None:
        return "?"
    return f"{value // 1000}k" if value >= 1000 else str(value)


def fmt_band(base: dict) -> str:
    lo, p50, hi = base.get("min"), base.get("p50"), base.get("max")
    if lo is not None and hi is not None:
        core = f"{fmt_eur(lo)}–{fmt_eur(hi)}"
        return f"{core} (p50 {fmt_eur(p50)})" if p50 is not None else core
    return fmt_eur(p50 if p50 is not None else (hi if hi is not None else lo))


def level_rank(name: str) -> int:
    return LEVEL_ORDER.index(name) if name in LEVEL_ORDER else len(LEVEL_ORDER)
