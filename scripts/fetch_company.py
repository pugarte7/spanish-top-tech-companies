#!/usr/bin/env python3
"""Fill in company details from Levels.fyi company pages. METADATA ONLY.

    python3 scripts/fetch_company.py --all            # every company on file
    python3 scripts/fetch_company.py --company glovo
    python3 scripts/fetch_company.py --from-backlog   # resolved names in backlog.csv

Each /companies/<slug>/salaries page embeds the company's own record: website,
careers page, LinkedIn, headquarters, headcount, industry, founding year and
vesting terms. That is what this script writes. No API key needed, and the
result does not depend on where you run it.

IT DOES NOT WRITE SALARY DATA, deliberately. Those pages carry a pay ladder,
but it is NOT filtered to Spain: it is the company's global data, merely
displayed in the reader's currency. `locationCurrency: EUR` only means the
reader is in the eurozone. Booking.com's page reads EUR while its figures are
Dutch; Adidas reads EUR over United States figures; Revolut over British ones.
Trusting that once put 682 foreign salary bands into this repository.

Spain-scoped compensation comes from the job-family pages instead, which name
the country in the URL - see scripts/fetch_levels_public.py. Per-level Spanish
ladders need the official API: scripts/fetch_levels.py.
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

class Blocked(RuntimeError):
    """Levels.fyi's WAF returned a bot challenge."""


def check_blocked(status: int, body: str | None) -> None:
    if status == 405 or (body and "Human Verification" in body[:2000]):
        raise Blocked(
            "Levels.fyi served a bot challenge (HTTP 405, 'Human Verification').\n"
            "You are being rate limited. Do not retry in a loop and do not try to\n"
            "work around it: wait for it to clear, then re-run with a much larger\n"
            "--delay. For bulk access, use the official API: "
            "https://www.levels.fyi/api-access/"
        )


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
        check_blocked(exc.code, None)
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


def merge(slug: str, props: dict, today: str) -> int:
    record = props.get("company") or {}
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

    rest = {k: v for k, v in company.items() if k not in SKELETON_ORDER}
    ordered = {k: company[k] for k in SKELETON_ORDER if k in company}
    ordered.update(rest)
    path.write_text(
        yaml.safe_dump(ordered, sort_keys=False, allow_unicode=True, width=100), encoding="utf-8")
    return filled


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--company", action="append", default=[], help="Levels.fyi slug. Repeatable.")
    parser.add_argument("--all", action="store_true", help="Every company already in data/companies/.")
    parser.add_argument("--from-backlog", action="store_true", help="Resolved names in data/backlog.csv.")
    parser.add_argument("--include-review", action="store_true",
                        help="Also fetch backlog rows whose slug match is unconfirmed.")
    parser.add_argument("--delay", type=float, default=3.0,
                        help="Seconds between pages. These are 400KB each; be generous.")
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
                wanted = {"resolved"} | ({"review"} if args.include_review else set())
                slugs += [row["levels_slug"] for row in csv.DictReader(fh)
                          if row.get("levels_slug") and row.get("status") in wanted]
    slugs = [s for s in dict.fromkeys(slugs) if s]
    if not slugs:
        parser.error("give --company SLUG, --all, or --from-backlog")

    if args.dry_run:
        for slug in slugs:
            print(f"GET {BASE}/companies/{slug}/salaries")
        return 0

    today = lib.today_utc().isoformat()
    ok = missing = 0
    consecutive_missing = 0
    total_filled = 0
    for slug in slugs:
        props = props_for(slug, args.delay)
        if not props or not props.get("company"):
            print(f"  {slug}: no page")
            missing += 1
            consecutive_missing += 1
            if consecutive_missing >= 8:
                print("\nStopping: 8 pages in a row returned nothing, which usually\n"
                      "means the WAF is challenging us. Wait, then retry with a\n"
                      "larger --delay.", file=sys.stderr)
                break
            continue
        consecutive_missing = 0

        filled = merge(slug, props, today)
        total_filled += filled
        ok += 1
        print(f"  {slug}: {filled} fields")

    print(f"\n{ok} companies updated, {missing} not found")
    print(f"{total_filled} metadata fields filled (no salary data: see the module docstring)")
    if ok:
        print(f"\n{ATTRIBUTION}")
        print("Next: python3 scripts/validate.py && python3 scripts/build.py")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
