#!/usr/bin/env python3
"""Scaffold a company file: python3 scripts/new_company.py "Company Name" [linkedin_id]"""
from __future__ import annotations

import datetime as dt
import sys

import lib
import yaml

SKELETON_ORDER = [
    "slug", "name", "linkedin_id", "website", "careers_url", "hq",
    "spain_presence", "employees", "sector", "work_model",
    "remote_within_spain", "contract", "working_language", "compensation",
]


def slugify(name: str) -> str:
    out = []
    for ch in name.lower():
        if ch.isalnum():
            out.append(ch)
        elif out and out[-1] != "-":
            out.append("-")
    return "".join(out).strip("-")


def main(argv: list[str]) -> int:
    if not argv:
        print(__doc__.strip())
        return 2

    name = argv[0]
    slug = slugify(name)
    path = lib.COMPANIES_DIR / f"{slug}.yml"
    if path.exists():
        print(f"{path.relative_to(lib.ROOT)} already exists")
        return 1

    today = lib.today_utc().isoformat()
    skeleton = {
        "slug": slug,
        "name": name,
        "linkedin_id": int(argv[1]) if len(argv) > 1 else None,
        "website": "https://CHANGEME",
        "careers_url": "https://CHANGEME",
        "hq": {"city": "CHANGEME", "country": "ES"},
        "spain_presence": "hub",
        "employees": "201-500",
        "sector": ["CHANGEME"],
        "work_model": "hybrid",
        "remote_within_spain": True,
        "contract": ["spanish-payroll"],
        "working_language": "en",
        "compensation": {
            "currency": "EUR",
            "basis": "gross_annual",
            "roles": [{
                "role": "data-engineer",
                "levels": [{
                    "level": "senior",
                    "base": {"min": 0, "p50": 0, "max": 0},
                    "equity": "unknown",
                    "sources": [{"name": "levels.fyi", "url": "https://CHANGEME", "date": today}],
                    "last_verified": today,
                }],
            }],
        },
    }
    ordered = {k: skeleton[k] for k in SKELETON_ORDER}
    path.write_text(
        yaml.safe_dump(ordered, sort_keys=False, allow_unicode=True, width=100),
        encoding="utf-8",
    )
    print(f"Created {path.relative_to(lib.ROOT)} — replace every CHANGEME and the zeroed band.")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
