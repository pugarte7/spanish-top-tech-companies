#!/usr/bin/env python3
"""Bulk-load salary rows from a spreadsheet into data/companies/*.yml.

    python3 scripts/import_csv.py my-levels-export.csv

Required columns: name, role, level, and at least one of base_min/base_p50/base_max.
Optional: slug, linkedin_id, website, careers_url, hq_city, hq_country,
spain_presence, work_model, remote_within_spain, contract, employees, sector,
bonus_pct, equity, sample_size, source, source_url, source_date, last_verified.

Existing files are merged into, not overwritten: a role/level already present is
updated in place, anything new is appended. Comments in hand-written files are
lost on merge, so keep prose in the `notes` field.
"""
from __future__ import annotations

import csv
import datetime as dt
import sys

import lib
import yaml
from new_company import SKELETON_ORDER, slugify

TODAY = dt.date.today().isoformat()


def clean(value: str | None) -> str | None:
    value = (value or "").strip()
    return value or None


def as_int(value: str | None) -> int | None:
    value = clean(value)
    if value is None:
        return None
    return int(float(value.replace(".", "").replace(",", "").replace("€", "")))


def as_bool(value: str | None):
    value = (clean(value) or "").lower()
    if value in {"true", "yes", "y", "1", "si", "sí"}:
        return True
    if value in {"false", "no", "n", "0"}:
        return False
    return None


def load_existing(slug: str) -> dict | None:
    path = lib.COMPANIES_DIR / f"{slug}.yml"
    if not path.exists():
        return None
    return yaml.safe_load(path.read_text(encoding="utf-8"))


def build_level(row: dict) -> dict:
    base = {}
    for key in ("min", "p50", "max"):
        value = as_int(row.get(f"base_{key}"))
        if value is not None:
            base[key] = value
    if not base:
        raise ValueError("no base_min / base_p50 / base_max")

    source = {"name": clean(row.get("source")) or "community"}
    if clean(row.get("source_url")):
        source["url"] = row["source_url"].strip()
    source["date"] = clean(row.get("source_date")) or TODAY

    level = {
        "level": clean(row.get("level")),
        "base": base,
        "sources": [source],
        "last_verified": clean(row.get("last_verified")) or source["date"],
    }
    if clean(row.get("bonus_pct")):
        level["bonus_pct"] = float(row["bonus_pct"])
    if clean(row.get("equity")):
        level["equity"] = row["equity"].strip()
    if as_int(row.get("sample_size")):
        level["sample_size"] = as_int(row["sample_size"])
    return level


def merge_level(company: dict, role_slug: str, level: dict) -> None:
    roles = company.setdefault("compensation", {}).setdefault("roles", [])
    role = next((r for r in roles if r["role"] == role_slug), None)
    if role is None:
        role = {"role": role_slug, "levels": []}
        roles.append(role)
    for index, existing in enumerate(role["levels"]):
        if existing["level"] == level["level"]:
            role["levels"][index] = level
            return
    role["levels"].append(level)


def main(argv: list[str]) -> int:
    if len(argv) != 1:
        print(__doc__.strip())
        return 2

    companies: dict[str, dict] = {}
    created, updated, skipped = 0, 0, 0

    with open(argv[0], newline="", encoding="utf-8-sig") as fh:
        for line_no, row in enumerate(csv.DictReader(fh), start=2):
            name = clean(row.get("name"))
            if not name:
                continue
            slug = clean(row.get("slug")) or slugify(name)

            if slug not in companies:
                existing = load_existing(slug)
                if existing is None:
                    created += 1
                    existing = {
                        "slug": slug,
                        "name": name,
                        "linkedin_id": as_int(row.get("linkedin_id")),
                        "website": clean(row.get("website")) or "https://CHANGEME",
                        "hq": {
                            "city": clean(row.get("hq_city")) or "CHANGEME",
                            "country": clean(row.get("hq_country")) or "ES",
                        },
                        "spain_presence": clean(row.get("spain_presence")) or "hub",
                        "work_model": clean(row.get("work_model")) or "hybrid",
                        "contract": (clean(row.get("contract")) or "spanish-payroll").split("|"),
                        "compensation": {"currency": "EUR", "basis": "gross_annual", "roles": []},
                    }
                    remote = as_bool(row.get("remote_within_spain"))
                    if remote is not None:
                        existing["remote_within_spain"] = remote
                    if clean(row.get("careers_url")):
                        existing["careers_url"] = row["careers_url"].strip()
                    if clean(row.get("employees")):
                        existing["employees"] = row["employees"].strip()
                    if clean(row.get("sector")):
                        existing["sector"] = [s.strip() for s in row["sector"].split("|")]
                else:
                    updated += 1
                companies[slug] = existing

            try:
                merge_level(companies[slug], clean(row.get("role")), build_level(row))
            except (ValueError, TypeError) as exc:
                print(f"  line {line_no}: skipped ({exc})")
                skipped += 1

    for slug, company in companies.items():
        rest = {k: v for k, v in company.items() if k not in SKELETON_ORDER}
        ordered = {k: company[k] for k in SKELETON_ORDER if k in company}
        ordered.update(rest)
        (lib.COMPANIES_DIR / f"{slug}.yml").write_text(
            yaml.safe_dump(ordered, sort_keys=False, allow_unicode=True, width=100),
            encoding="utf-8",
        )

    print(f"{created} created, {updated} updated, {skipped} rows skipped.")
    print("Now run: python3 scripts/validate.py && python3 scripts/build.py")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
