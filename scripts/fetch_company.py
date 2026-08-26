#!/usr/bin/env python3
"""Fill in company details and per-level pay from Levels.fyi company pages.

    python3 scripts/fetch_company.py --all            # every company on file
    python3 scripts/fetch_company.py --company glovo
    python3 scripts/fetch_company.py --from-backlog   # resolved names in backlog.csv

Each /companies/<slug>/salaries page embeds the company's own record (website,
careers page, LinkedIn, headquarters, headcount, industry, vesting) plus a
per-level pay ladder with submission counts. No API key.

MUST BE RUN FROM SPAIN. These pages are scoped by the caller's IP address and
ignore every location query parameter, so from anywhere else they return that
country's figures in that country's currency. The script checks the page's
declared currency and refuses to write anything that is not EUR, which also
means it cannot run in CI.

Figures on the page are USD; `locationExchangeRate` converts them. Everything
written is TOTAL COMPENSATION, so it lands in `total_comp`, never `base`.
"""
from __future__ import annotations

import argparse
import csv
import gzip
import json
import re
import sys
import time
import urllib.error
import urllib.request

import lib
import yaml
from fetch_levels_public import TECH_FAMILIES
from new_company import SKELETON_ORDER, slugify

BASE = "https://www.levels.fyi"
ATTRIBUTION = "Data source: Levels.fyi (https://www.levels.fyi)"
UA = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/128.0 Safari/537.36")
NEXT_DATA = re.compile(r'<script id="__NEXT_DATA__"[^>]*>(.*?)</script>', re.S)

# Their ladders are generic (L1..L5). Map by position and keep the original in
# notes so a wrong guess stays visible.
LADDER = ["junior", "mid", "senior", "staff", "principal"]
AGGREGATE_LEVELS = {"median", "common-range-average"}


def get(url: str, delay: float) -> str | None:
    request = urllib.request.Request(
        url, headers={"User-Agent": UA, "Accept-Encoding": "gzip",
                      "Accept": "text/html,application/xhtml+xml"})
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            raw = response.read()
            if response.headers.get("Content-Encoding") == "gzip":
                raw = gzip.decompress(raw)
            return raw.decode("utf-8", "replace")
    except urllib.error.HTTPError as exc:
        if exc.code != 404:
            print(f"  HTTP {exc.code} for {url}", file=sys.stderr)
        return None
    except urllib.error.URLError as exc:
        print(f"  {exc.reason} for {url}", file=sys.stderr)
        return None
    finally:
        time.sleep(delay)


def props_for(slug: str, delay: float) -> dict | None:
    html = get(f"{BASE}/companies/{slug}/salaries", delay)
    if not html:
        return None
    match = NEXT_DATA.search(html)
    if not match:
        return None
    try:
        return json.loads(match.group(1))["props"]["pageProps"]
    except (KeyError, json.JSONDecodeError):
        return None


def metadata(record: dict) -> dict:
    """Only the fields Levels.fyi actually knows about a company."""
    out = {}
    if record.get("website"):
        out["website"] = record["website"]
    if record.get("career_page"):
        out["careers_url"] = record["career_page"]
    if record.get("linkedin"):
        out["linkedin_url"] = f"https://www.linkedin.com/{record['linkedin'].strip('/')}"
    country = record.get("country") or {}
    if record.get("hq_city") or country.get("codeIso2"):
        out["hq"] = {k: v for k, v in
                     (("city", record.get("hq_city")), ("country", country.get("codeIso2"))) if v}
    if record.get("employee_count_range"):
        out["employees"] = record["employee_count_range"]
    if record.get("year_founded"):
        out["year_founded"] = record["year_founded"]
    tags = [slugify(t) for t in (record.get("tags") or []) if t]
    if tags:
        out["sector"] = tags[:4]
    elif record.get("industry"):
        out["sector"] = [slugify(record["industry"])]
    return out


def bands(entry: dict, rate: float, url: str, today: str) -> list[dict]:
    breakdown = entry.get("breakdown") or []
    ladder = [b for b in breakdown if (b.get("level_slug") or "").lower() not in AGGREGATE_LEVELS]
    aggregate = [b for b in breakdown if (b.get("level_slug") or "").lower() in AGGREGATE_LEVELS]
    rows = ladder or aggregate

    out = []
    for index, row in enumerate(rows):
        value = row.get("total")
        if not isinstance(value, (int, float)) or value <= 0:
            continue
        if row in aggregate:
            level = "all"
            note = f"{row.get('level')} across all levels."
        else:
            level = LADDER[min(index, len(LADDER) - 1)]
            note = f"Levels.fyi reports this as '{row.get('level')}'."
        band = {
            "level": level,
            "base": {},
            "total_comp": {"p50": int(round(value * rate))},
            "sources": [{"name": "levels.fyi", "url": url, "date": today}],
            "last_verified": today,
            "notes": f"{note} Total compensation, converted from USD at {rate}.",
        }
        if row.get("count"):
            band["sample_size"] = int(row["count"])
        out.append(band)
    return out


def merge(slug: str, props: dict, today: str) -> tuple[int, int]:
    record = props.get("company") or {}
    rate = props.get("locationExchangeRate")
    url = f"{BASE}/companies/{slug}/salaries"
    path = lib.COMPANIES_DIR / f"{slug}.yml"
    company = yaml.safe_load(path.read_text(encoding="utf-8")) if path.exists() else {}
    company = company or {"slug": slug, "name": record.get("name") or slug}
    company.setdefault("slug", slug)
    company.setdefault("name", record.get("name") or slug)

    filled = 0
    for key, value in metadata(record).items():
        if not company.get(key):          # never clobber something a human set
            company[key] = value
            filled += 1
    if record.get("vesting_type") and not company.get("notes"):
        detail = record.get("vesting_schedule")
        company["notes"] = (
            f"{record.get('short_description') or ''} "
            f"Equity: {record['vesting_type']}"
            f"{f' vesting {detail}' if detail else ''}."
        ).strip()

    roles = company.setdefault("compensation", {}).setdefault("roles", [])
    company["compensation"].setdefault("currency", "EUR")
    company["compensation"].setdefault("basis", "gross_annual")
    added = 0
    for entry in props.get("overview") or []:
        role = entry.get("slug")
        if role not in TECH_FAMILIES:
            continue
        new = bands(entry, rate, url, today)
        if not new:
            continue
        bucket = next((r for r in roles if r["role"] == role), None)
        if bucket is None:
            bucket = {"role": role, "levels": []}
            roles.append(bucket)
        # A real ladder supersedes the single "all" row from the job-family pages.
        keep = [] if any(b["level"] != "all" for b in new) else \
               [e for e in bucket["levels"] if e.get("level") != "all"]
        merged = {e["level"]: e for e in keep}
        merged.update({b["level"]: b for b in new})
        bucket["levels"] = sorted(merged.values(), key=lambda e: lib.level_rank(e["level"]))
        added += len(new)

    rest = {k: v for k, v in company.items() if k not in SKELETON_ORDER}
    ordered = {k: company[k] for k in SKELETON_ORDER if k in company}
    ordered.update(rest)
    path.write_text(
        yaml.safe_dump(ordered, sort_keys=False, allow_unicode=True, width=100), encoding="utf-8")
    return filled, added


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--company", action="append", default=[], help="Levels.fyi slug. Repeatable.")
    parser.add_argument("--all", action="store_true", help="Every company already in data/companies/.")
    parser.add_argument("--from-backlog", action="store_true", help="Resolved names in data/backlog.csv.")
    parser.add_argument("--delay", type=float, default=1.0)
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args(argv)

    slugs = list(args.company)
    if args.all:
        slugs += [p.stem for p in sorted(lib.COMPANIES_DIR.glob("*.yml"))
                  if not p.name.startswith("_")]
    if args.from_backlog:
        path = lib.ROOT / "data" / "backlog.csv"
        if path.exists():
            with path.open(encoding="utf-8") as fh:
                slugs += [row.get("slug") or slugify(row.get("name", ""))
                          for row in csv.DictReader(fh) if row.get("name")]
    slugs = [s for s in dict.fromkeys(slugs) if s]
    if not slugs:
        parser.error("give --company SLUG, --all, or --from-backlog")

    if args.dry_run:
        for slug in slugs:
            print(f"GET {BASE}/companies/{slug}/salaries")
        return 0

    today = lib.today_utc().isoformat()
    ok = missing = wrong_currency = 0
    total_filled = total_bands = 0
    for slug in slugs:
        props = props_for(slug, args.delay)
        if not props or not props.get("company"):
            print(f"  {slug}: no page")
            missing += 1
            continue
        currency = props.get("locationCurrency")
        if currency != "EUR":
            # A company with no Spanish submissions falls back to its own
            # country's figures. Skip it rather than write another currency.
            print(f"  {slug}: skipped, page is in {currency} not EUR")
            wrong_currency += 1
            continue
        filled, added = merge(slug, props, today)
        total_filled += filled
        total_bands += added
        ok += 1
        print(f"  {slug}: {filled} fields, {added} bands")

    print(f"\n{ok} companies updated, {missing} not found, "
          f"{wrong_currency} skipped for non-EUR scope")
    print(f"{total_filled} metadata fields filled, {total_bands} bands written")
    if ok:
        print(f"\n{ATTRIBUTION}")
        print("Next: python3 scripts/validate.py && python3 scripts/build.py")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
