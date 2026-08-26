#!/usr/bin/env python3
"""Seed Spanish compensation data from Levels.fyi's public markdown routes.

    python3 scripts/fetch_levels_public.py                 # everything it can find
    python3 scripts/fetch_levels_public.py --dry-run       # show the URLs only
    python3 scripts/fetch_levels_public.py --role software-engineer

No API key. Levels.fyi's robots.txt invites LLM and agent access to these
routes and asks for attribution in return, which this repository gives. This is
the sanctioned surface, not a workaround: it reads the same pages a browser
would, one at a time, with a delay.

What it gets, per job family and location:

  * a Spain-wide benchmark (median, p25/p75, p90) -> data/benchmarks.json
  * the top-paying companies table -> one band per company, level "all"

What it cannot get: per-level ladders, base-salary splits, or sample sizes.
Those need the official API (see scripts/fetch_levels.py). Everything written
here is TOTAL COMPENSATION, so it lands in `total_comp`, never in `base`.
"""
from __future__ import annotations

import argparse
import datetime as dt
import gzip
import json
import re
import sys
import time
import urllib.error
import urllib.request

import lib
import yaml
from new_company import SKELETON_ORDER, slugify

BASE = "https://www.levels.fyi"
USER_AGENT = "spanish-top-tech-companies/1.0 (+https://github.com/pugarte7/spanish-top-tech-companies)"
ATTRIBUTION = "Data source: Levels.fyi (https://www.levels.fyi)"

# Job families Levels.fyi actually publishes Spanish data for, mapped onto our
# role slugs. Probed rather than guessed; the rest return an empty document.
FAMILIES = {
    "software-engineer": "software-engineer",
    "data-scientist": "data-scientist",
    "data-analyst": "data-analyst",
    "product-manager": "product-manager",
    "business-analyst": "business-analyst",
    "sales-engineer": "sales-engineer",
}
LOCATIONS = ["spain", "madrid-esp", "barcelona-esp", "valencia-esp", "malaga-esp"]

MONEY = r"€\s*([\d.,]+)"
RE_CURRENCY = re.compile(r"^\*\*Currency:\*\*\s*(\w+)", re.M)
RE_LOCATION = re.compile(r"^\*\*Location:\*\*\s*(.+?)\s*$", re.M)
RE_UPDATED = re.compile(r"Last Updated:\s*([A-Z][a-z]+ \d{1,2}, \d{4})")
RE_MEDIAN = re.compile(rf"Median Total Compensation[^:]*:\s*{MONEY}")
RE_QUARTILES = re.compile(rf"25th / 75th Percentile:\s*{MONEY}\s*/\s*{MONEY}")
RE_P90 = re.compile(rf"90th Percentile:\s*{MONEY}")
RE_COMPANIES = re.compile(
    r"###\s*Top Paying Companies\s*\n(.*?)(?=\n###|\n---|\Z)", re.S)
RE_ROW = re.compile(rf"^\|\s*\d+\s*\|\s*(.+?)\s*\|\s*{MONEY}\s*\|", re.M)


def money(text: str) -> int | None:
    """'109,357' or '109.357' -> 109357."""
    digits = re.sub(r"[^\d]", "", text or "")
    return int(digits) if digits else None


def fetch(url: str, delay: float) -> str | None:
    """Fetch one markdown page.

    Accept-Encoding is not optional here: without it the CDN answers 200 with
    an empty body and `Cache-Control: no-store`. Python's urllib sends no
    Accept-Encoding by default, so it has to be set explicitly.
    """
    request = urllib.request.Request(
        url,
        headers={
            "User-Agent": USER_AGENT,
            "Accept": "text/markdown, text/plain, */*",
            "Accept-Encoding": "gzip",
        },
    )
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            raw = response.read()
            if response.headers.get("Content-Encoding") == "gzip":
                raw = gzip.decompress(raw)
            body = raw.decode("utf-8", "replace")
    except urllib.error.HTTPError as exc:
        print(f"  HTTP {exc.code} for {url}", file=sys.stderr)
        return None
    except urllib.error.URLError as exc:
        print(f"  {exc.reason} for {url}", file=sys.stderr)
        return None
    time.sleep(delay)
    return body if body.strip() else None


def parse(text: str, url: str) -> dict | None:
    currency = (RE_CURRENCY.search(text) or [None, ""])[1] if RE_CURRENCY.search(text) else ""
    if currency.upper() != "EUR":
        # A page that came back in USD is the wrong scope; never mix currencies.
        print(f"  skipping {url}: currency is {currency or 'unknown'}, not EUR", file=sys.stderr)
        return None

    updated = None
    match = RE_UPDATED.search(text)
    if match:
        try:
            updated = dt.datetime.strptime(match.group(1), "%B %d, %Y").date().isoformat()
        except ValueError:
            updated = None
    updated = updated or lib.today_utc().isoformat()

    median = RE_MEDIAN.search(text)
    quartiles = RE_QUARTILES.search(text)
    p90 = RE_P90.search(text)

    benchmark = {"url": url, "currency": "EUR", "last_updated": updated}
    if median:
        benchmark["p50"] = money(median.group(1))
    if quartiles:
        benchmark["p25"] = money(quartiles.group(1))
        benchmark["p75"] = money(quartiles.group(2))
    if p90:
        benchmark["p90"] = money(p90.group(1))
    location = RE_LOCATION.search(text)
    benchmark["location"] = location.group(1) if location else ""

    companies = []
    block = RE_COMPANIES.search(text)
    if block:
        for name, amount in RE_ROW.findall(block.group(1)):
            value = money(amount)
            if name and value:
                companies.append({"name": name.strip(), "p50": value})
    return {"benchmark": benchmark, "companies": companies}


def merge_company(name: str, role: str, p50: int, url: str, date: str, location: str) -> str:
    slug = slugify(name)
    path = lib.COMPANIES_DIR / f"{slug}.yml"
    if path.exists():
        company = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
    else:
        company = {
            "slug": slug,
            "name": name,
            "compensation": {"currency": "EUR", "basis": "gross_annual", "roles": []},
        }

    band = {
        "level": "all",
        "base": {},
        "total_comp": {"p50": p50},
        "sources": [{"name": "levels.fyi", "url": url, "date": date}],
        "last_verified": date,
        "notes": (
            f"Median total compensation across all levels for {location}. "
            "Levels.fyi's public summary does not break this out by level or "
            "separate base salary."
        ),
    }

    roles = company.setdefault("compensation", {}).setdefault("roles", [])
    bucket = next((r for r in roles if r["role"] == role), None)
    if bucket is None:
        bucket = {"role": role, "levels": []}
        roles.append(bucket)
    levels = [entry for entry in bucket["levels"] if entry.get("level") != "all"]
    levels.append(band)
    bucket["levels"] = sorted(levels, key=lambda e: lib.level_rank(e["level"]))

    rest = {k: v for k, v in company.items() if k not in SKELETON_ORDER}
    ordered = {k: company[k] for k in SKELETON_ORDER if k in company}
    ordered.update(rest)
    path.write_text(
        yaml.safe_dump(ordered, sort_keys=False, allow_unicode=True, width=100), encoding="utf-8"
    )
    return slug


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--role", action="append", default=[], help="Limit to these job families.")
    parser.add_argument("--delay", type=float, default=1.5, help="Seconds between requests.")
    parser.add_argument("--dry-run", action="store_true", help="List the URLs and stop.")
    args = parser.parse_args(argv)

    families = {k: v for k, v in FAMILIES.items() if not args.role or k in args.role}
    if not families:
        parser.error(f"unknown role; choose from {', '.join(FAMILIES)}")

    benchmarks, seen_companies, pages = [], set(), 0
    for family, role in families.items():
        for location in LOCATIONS:
            url = f"{BASE}/t/{family}/locations/{location}.md"
            if args.dry_run:
                print(f"GET {url}")
                continue
            text = fetch(url, args.delay)
            if not text:
                continue
            parsed = parse(text, url.removesuffix(".md"))
            if not parsed:
                continue
            pages += 1
            record = dict(parsed["benchmark"], role=role, family=family, location_slug=location)
            benchmarks.append(record)
            print(f"  {family} / {location}: median €{record.get('p50'):,}"
                  f" · {len(parsed['companies'])} companies")
            for entry in parsed["companies"]:
                slug = merge_company(
                    entry["name"], role, entry["p50"],
                    record["url"], record["last_updated"], record.get("location") or location,
                )
                seen_companies.add(slug)

    if args.dry_run:
        return 0

    if benchmarks:
        benchmarks.sort(key=lambda b: (b["role"], b["location_slug"]))
        (lib.ROOT / "data" / "benchmarks.json").write_text(
            json.dumps(
                {"attribution": ATTRIBUTION, "generated": lib.today_utc().isoformat(),
                 "benchmarks": benchmarks},
                indent=2, ensure_ascii=False) + "\n",
            encoding="utf-8",
        )

    print(f"\n{pages} pages read · {len(benchmarks)} benchmarks · {len(seen_companies)} companies touched")
    if seen_companies:
        print(f"\n{ATTRIBUTION}")
        print("These are TOTAL COMPENSATION medians across all levels, not base salary.")
        print("Company metadata (website, offices, contract type) still needs filling in.")
        print("Next: python3 scripts/validate.py && python3 scripts/build.py")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
