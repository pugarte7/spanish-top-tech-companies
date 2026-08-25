#!/usr/bin/env python3
"""Pull Spanish compensation bands from the official Levels.fyi API.

    export LEVELS_FYI_API_KEY=...
    python3 scripts/fetch_levels.py --company cabify --role data-engineer
    python3 scripts/fetch_levels.py --from-backlog --role data-engineer --limit 25

Access is not self-serve: request a key at https://www.levels.fyi/api-access/
(the key needs the `benchmark` feature). Until you have one, `--dry-run` prints
the exact calls that would be made, and `--from-fixture` runs the whole
transform against a saved payload so the mapping can be checked offline.

Levels.fyi requires attribution on any derived work, and their Data License
governs what you may republish. Getting a key is not by itself permission to
redistribute. See https://www.levels.fyi/offerings/data/.
"""
from __future__ import annotations

import argparse
import csv
import datetime as dt
import json
import os
import pathlib
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

import lib
import yaml
from new_company import SKELETON_ORDER, slugify

API = "https://api.levels.fyi"
ATTRIBUTION = "Data source: Levels.fyi (https://www.levels.fyi)"
USER_AGENT = "spanish-top-tech-companies/1.0 (+https://github.com/pugarte7/spanish-top-tech-companies)"

# Their payload gives p10..p90. The interquartile range is the honest "range":
# p10-p90 makes every company look like it pays anything to anyone.
RANGE_LOW, RANGE_HIGH = "p25", "p75"

# Their level names are per-company ("L4", "Senior Engineer", "IC3"). Match on
# the name first; fall back to seniority `order` when the name says nothing.
LEVEL_KEYWORDS = [
    ("intern", "intern"), ("becari", "intern"), ("graduate", "junior"),
    ("junior", "junior"), ("associate", "junior"), ("entry", "junior"),
    ("principal", "principal"), ("distinguished", "principal"), ("fellow", "principal"),
    ("staff", "staff"), ("senior", "senior"), ("snr", "senior"), ("sr.", "senior"),
    ("lead", "lead"), ("manager", "manager"), ("director", "director"),
    ("mid", "mid"), ("intermediate", "mid"),
]
ORDER_FALLBACK = ["junior", "mid", "senior", "staff", "principal"]


class ApiError(RuntimeError):
    pass


class Client:
    def __init__(self, key: str | None, dry_run: bool = False, delay: float = 1.0):
        self.key = key
        self.dry_run = dry_run
        self.delay = delay
        self._cache: dict[str, object] = {}

    def get(self, path: str, params: dict | None = None):
        query = []
        for name, value in (params or {}).items():
            if value is None:
                continue
            for item in (value if isinstance(value, list) else [value]):
                query.append((name, str(item)))
        url = f"{API}{path}" + (f"?{urllib.parse.urlencode(query)}" if query else "")

        if self.dry_run:
            print(f"GET {url}")
            return None
        if url in self._cache:
            return self._cache[url]
        if not self.key:
            raise ApiError(
                "No API key. Set LEVELS_FYI_API_KEY, or use --dry-run / --from-fixture.\n"
                "Request access at https://www.levels.fyi/api-access/"
            )

        request = urllib.request.Request(
            url, headers={"x-api-key": self.key, "Accept": "application/json", "User-Agent": USER_AGENT}
        )
        try:
            with urllib.request.urlopen(request, timeout=30) as response:
                remaining = response.headers.get("RateLimit-Remaining")
                payload = json.load(response)
        except urllib.error.HTTPError as exc:
            detail = exc.read().decode("utf-8", "replace")[:200]
            if exc.code == 401:
                raise ApiError(f"401 from Levels.fyi: {detail}. Is LEVELS_FYI_API_KEY set correctly?")
            if exc.code == 403:
                raise ApiError(f"403 from Levels.fyi: {detail}. Your key may lack the 'benchmark' feature.")
            if exc.code == 429:
                raise ApiError(f"429 rate limited: {detail}. Raise --delay and try again.")
            raise ApiError(f"HTTP {exc.code} on {path}: {detail}")

        if remaining is not None and remaining.isdigit() and int(remaining) < 10:
            print(f"  warning: only {remaining} API calls left in this window", file=sys.stderr)
        self._cache[url] = payload
        time.sleep(self.delay)
        return payload

    # -- lookups ----------------------------------------------------------

    def location_slug(self, name: str = "Spain") -> str | None:
        rows = self.get("/v1/api/lookup/locations", {"q": name, "type": "country", "limit": 5})
        if not rows:
            return None
        exact = [r for r in rows if r.get("name", "").lower() == name.lower()]
        return (exact or rows)[0].get("slug")

    def job_family_slug(self, role: str) -> str | None:
        rows = self.get("/v1/api/lookup/job-families", {"q": role.replace("-", " "), "limit": 5})
        return rows[0].get("slug") if rows else None

    def company_slug(self, name: str) -> str | None:
        rows = self.get("/v1/api/lookup/companies", {"q": name})
        if not rows:
            return None
        target = slugify(name)
        exact = [r for r in rows if r.get("slug") == target or r.get("name", "").lower() == name.lower()]
        return (exact or rows)[0].get("slug")

    def company_levels(self, family: str, company: str, location: str, salary_type: str):
        return self.get(
            f"/v1/api/benchmark/{family}/companies/{company}/levels",
            {
                "locationSlugs": [location],
                "salaryType": salary_type,
                "timeRange": "0-12",
                "compPerspective": "employee",
            },
        ) or []


# -- transform ------------------------------------------------------------


def map_level(row: dict, index: int, total: int) -> str:
    name = f"{row.get('level') or ''} {row.get('secondaryLevelName') or ''}".lower()
    for needle, level in LEVEL_KEYWORDS:
        if needle in name:
            return level
    if total <= len(ORDER_FALLBACK):
        return ORDER_FALLBACK[min(index, len(ORDER_FALLBACK) - 1)]
    scaled = round(index / max(total - 1, 1) * (len(ORDER_FALLBACK) - 1))
    return ORDER_FALLBACK[scaled]


def band(row: dict) -> dict:
    out = {}
    for key, source in (("min", RANGE_LOW), ("p50", "p50"), ("max", RANGE_HIGH)):
        value = row.get(source)
        if isinstance(value, (int, float)) and value > 0:
            out[key] = int(round(value))
    return out


def build_levels(base_rows: list, tc_rows: list, company_slug: str, family: str, today: str) -> list[dict]:
    tc_by_level = {r.get("level"): r for r in tc_rows}
    ordered = sorted(base_rows, key=lambda r: r.get("order") or 0)
    levels = []
    for index, row in enumerate(ordered):
        base = band(row)
        if not base:
            continue
        entry = {
            "level": map_level(row, index, len(ordered)),
            "base": base,
        }
        total_comp = band(tc_by_level.get(row.get("level"), {}))
        if total_comp:
            entry["total_comp"] = total_comp
        if row.get("sampleSize"):
            entry["sample_size"] = int(row["sampleSize"])
        entry["sources"] = [{
            "name": "levels.fyi",
            "url": f"https://www.levels.fyi/companies/{company_slug}/salaries/{family}",
            "date": today,
        }]
        entry["last_verified"] = today
        note = row.get("level")
        if note:
            entry["notes"] = f"Levels.fyi reports this as '{note}'. Range is {RANGE_LOW}–{RANGE_HIGH}."
        levels.append(entry)

    # Two of their level names can collapse onto one of ours; keep the larger sample.
    deduped: dict[str, dict] = {}
    for entry in levels:
        existing = deduped.get(entry["level"])
        if existing is None or (entry.get("sample_size") or 0) > (existing.get("sample_size") or 0):
            deduped[entry["level"]] = entry
    return sorted(deduped.values(), key=lambda e: lib.level_rank(e["level"]))


def merge_into_yaml(name: str, slug: str, role: str, levels: list[dict]) -> pathlib.Path:
    path = lib.COMPANIES_DIR / f"{slug}.yml"
    if path.exists():
        company = yaml.safe_load(path.read_text(encoding="utf-8"))
    else:
        company = {
            "slug": slug,
            "name": name,
            "linkedin_id": None,
            "website": "https://CHANGEME",
            "hq": {"city": "CHANGEME", "country": "ES"},
            "spain_presence": "hub",
            "work_model": "hybrid",
            "contract": ["spanish-payroll"],
            "compensation": {"currency": "EUR", "basis": "gross_annual", "roles": []},
        }

    roles = company.setdefault("compensation", {}).setdefault("roles", [])
    bucket = next((r for r in roles if r["role"] == role), None)
    if bucket is None:
        bucket = {"role": role, "levels": []}
        roles.append(bucket)
    by_level = {entry["level"]: entry for entry in bucket["levels"]}
    by_level.update({entry["level"]: entry for entry in levels})
    bucket["levels"] = sorted(by_level.values(), key=lambda e: lib.level_rank(e["level"]))

    rest = {k: v for k, v in company.items() if k not in SKELETON_ORDER}
    ordered = {k: company[k] for k in SKELETON_ORDER if k in company}
    ordered.update(rest)
    path.write_text(
        yaml.safe_dump(ordered, sort_keys=False, allow_unicode=True, width=100), encoding="utf-8"
    )
    return path


# -- entry point ----------------------------------------------------------


def backlog_names(limit: int) -> list[str]:
    path = lib.ROOT / "data" / "backlog.csv"
    if not path.exists():
        return []
    names = []
    with path.open(encoding="utf-8") as fh:
        for row in csv.DictReader(fh):
            if row.get("name"):
                names.append(row["name"])
            if len(names) >= limit:
                break
    return names


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--company", action="append", default=[], help="Company name or slug. Repeatable.")
    parser.add_argument("--from-backlog", action="store_true", help="Use resolved names from data/backlog.csv.")
    parser.add_argument("--role", default="data-engineer", help="Canonical role slug (default: data-engineer).")
    parser.add_argument("--location", default="Spain", help="Country to filter on (default: Spain).")
    parser.add_argument("--limit", type=int, default=25, help="Max companies per run.")
    parser.add_argument("--delay", type=float, default=1.0, help="Seconds between API calls.")
    parser.add_argument("--dry-run", action="store_true", help="Print the calls without making them.")
    parser.add_argument("--from-fixture", metavar="FILE", help="Run the transform against a saved payload.")
    args = parser.parse_args(argv)

    today = lib.today_utc().isoformat()

    if args.from_fixture:
        payload = json.loads(pathlib.Path(args.from_fixture).read_text(encoding="utf-8"))
        levels = build_levels(
            payload.get("base", []), payload.get("total_compensation", []),
            payload.get("companySlug", "example"), payload.get("jobFamilySlug", args.role), today,
        )
        print(yaml.safe_dump({"levels": levels}, sort_keys=False, allow_unicode=True, width=100))
        return 0

    names = list(args.company)
    if args.from_backlog:
        names += backlog_names(args.limit)
    if not names:
        parser.error("give --company NAME (repeatable) or --from-backlog")
    names = names[: args.limit]

    client = Client(os.environ.get("LEVELS_FYI_API_KEY"), dry_run=args.dry_run, delay=args.delay)

    try:
        location = client.location_slug(args.location) or (args.location.lower() if args.dry_run else None)
        family = client.job_family_slug(args.role) or (args.role if args.dry_run else None)
        if not args.dry_run and not location:
            raise ApiError(f"Levels.fyi has no country matching {args.location!r}")
        if not args.dry_run and not family:
            raise ApiError(f"Levels.fyi has no job family matching {args.role!r}")

        written, skipped = 0, 0
        for name in names:
            slug = client.company_slug(name) or (slugify(name) if args.dry_run else None)
            if not slug:
                print(f"  {name}: not found on Levels.fyi")
                skipped += 1
                continue
            base_rows = client.company_levels(family, slug, location, "base_salary")
            tc_rows = client.company_levels(family, slug, location, "total_compensation")
            if args.dry_run:
                continue
            levels = build_levels(base_rows, tc_rows, slug, family, today)
            if not levels:
                print(f"  {name}: no {args.role} data for {args.location}")
                skipped += 1
                continue
            path = merge_into_yaml(name, slugify(name), args.role, levels)
            print(f"  {name}: {len(levels)} levels -> {path.relative_to(lib.ROOT)}")
            written += 1
    except ApiError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 1

    if args.dry_run:
        return 0

    print(f"\n{written} companies written, {skipped} skipped.")
    if written:
        print(f"\n{ATTRIBUTION}")
        print("Check the currency before committing: the levels endpoint does not document one,")
        print("so confirm the figures are EUR and not USD on your first run.")
        print("Then run: python3 scripts/validate.py && python3 scripts/build.py")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
