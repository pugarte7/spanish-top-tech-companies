#!/usr/bin/env python3
"""Validate every company file. Exits non-zero on errors; warnings are advisory."""
from __future__ import annotations

import datetime as dt
import json
import sys

import lib

try:
    from jsonschema import Draft202012Validator
except ImportError:
    sys.exit("jsonschema is missing. Run: pip install -r requirements.txt")

errors: list[str] = []
warnings: list[str] = []


def check_bands(where: str, role: str, level: dict) -> None:
    base = level.get("base", {})
    lo, p50, hi = base.get("min"), base.get("p50"), base.get("max")
    ordered = [(n, v) for n, v in (("min", lo), ("p50", p50), ("max", hi)) if v is not None]
    for (n1, v1), (n2, v2) in zip(ordered, ordered[1:]):
        if v1 > v2:
            errors.append(f"{where}: {role}/{level.get('level')} has {n1} {v1} > {n2} {v2}")

    verified = lib.parse_date(level.get("last_verified"))
    if verified and verified > lib.today_utc():
        errors.append(f"{where}: {role}/{level.get('level')} last_verified is in the future")

    for source in level.get("sources", []) or []:
        source_date = lib.parse_date(source.get("date"))
        if source_date and source_date > lib.today_utc():
            errors.append(f"{where}: {role}/{level.get('level')} source date is in the future")

    if role not in lib.CANONICAL_ROLES:
        warnings.append(f"{where}: '{role}' is not a canonical role slug (see METHODOLOGY.md)")
    if lib.is_stale(level.get("last_verified")):
        warnings.append(f"{where}: {role}/{level.get('level')} not verified in over a year")


def main() -> int:
    schema = json.loads(lib.SCHEMA_PATH.read_text(encoding="utf-8"))
    validator = Draft202012Validator(schema)
    companies = lib.load_companies()

    if not companies:
        print("No company files yet. Copy data/companies/_template.yml to get started.")
        return 0

    seen_slugs: dict[str, str] = {}
    seen_linkedin: dict[int, str] = {}

    for company in companies:
        path = company["_path"]
        where = path.name
        payload = {k: v for k, v in company.items() if not k.startswith("_")}

        for issue in sorted(validator.iter_errors(payload), key=lambda e: list(e.path)):
            location = "/".join(str(p) for p in issue.path) or "(root)"
            errors.append(f"{where}: {location}: {issue.message}")

        slug = payload.get("slug")
        if slug and slug != path.stem:
            errors.append(f"{where}: slug '{slug}' does not match the filename")
        if slug in seen_slugs:
            errors.append(f"{where}: slug '{slug}' already used by {seen_slugs[slug]}")
        elif slug:
            seen_slugs[slug] = where

        linkedin_id = payload.get("linkedin_id")
        if linkedin_id is not None:
            if linkedin_id in seen_linkedin:
                errors.append(f"{where}: linkedin_id {linkedin_id} already used by {seen_linkedin[linkedin_id]}")
            else:
                seen_linkedin[linkedin_id] = where
        else:
            warnings.append(f"{where}: no linkedin_id")

        for field in ("website", "hq", "spain_presence", "contract", "work_model"):
            if not payload.get(field):
                warnings.append(f"{where}: {field} not filled in yet")

        for role, level in lib.iter_levels(payload):
            check_bands(where, role, level)

        if not lib.qualifies(payload):
            best = lib.top_band(payload)
            found = lib.fmt_eur(best[2]) if best else "nothing"
            warnings.append(
                f"{where}: no documented band reaches {lib.fmt_eur(lib.THRESHOLD_EUR)} "
                f"(highest is {found}) - it will be listed as undocumented"
            )

    for warning in warnings:
        print(f"warn  {warning}")
    for error in errors:
        print(f"ERROR {error}")

    print(f"\n{len(companies)} companies, {len(errors)} errors, {len(warnings)} warnings")
    return 1 if errors else 0


if __name__ == "__main__":
    sys.exit(main())
