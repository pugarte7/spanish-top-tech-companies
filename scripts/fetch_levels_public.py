#!/usr/bin/env python3
"""Seed Spanish compensation data from Levels.fyi's public pages. No API key.

    python3 scripts/fetch_levels_public.py                    # everything
    python3 scripts/fetch_levels_public.py --dry-run          # list the URLs
    python3 scripts/fetch_levels_public.py --role software-engineer

Levels.fyi's robots.txt invites agent access and asks for attribution, which
this repository gives. This reads the same public, indexable pages a browser
would, one at a time with a delay.

It reads each page's embedded `__NEXT_DATA__` rather than the `.md` summary,
for three reasons: the `.md` truncates the company table to five rows where the
page carries ten, the `.md` is served from a 12-hour CDN cache that returns an
empty body when cold, and only the page exposes the exchange rate and the
submission counts.

Everything published is TOTAL COMPENSATION across all levels, so it lands in
`total_comp` at level `all`, never in `base`. Per-level ladders and base-salary
splits need the official API: see scripts/fetch_levels.py.
"""
from __future__ import annotations

import argparse
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
ATTRIBUTION = "Data source: Levels.fyi (https://www.levels.fyi)"
# Their edge serves an empty body to clients that look like bare scripts, so
# present as a browser. Requests stay sequential and rate limited.
UA = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/128.0 Safari/537.36")

NEXT_DATA = re.compile(r'<script id="__NEXT_DATA__"[^>]*>(.*?)</script>', re.S)

# Country slug plus the Spanish metro areas Levels.fyi models separately.
FALLBACK_LOCATIONS = ["spain", "madrid-metropolitan-area", "greater-barcelona-area"]

# Their taxonomy runs to 105 families including physician and lab-tech. This is
# a list of tech companies, so take the families that belong in one. Category
# alone is too blunt: "Design" holds fashion-designer, "Engineering" holds
# petroleum-engineer.
TECH_FAMILIES = [
    "software-engineer", "software-engineering-manager", "data-scientist",
    "data-science-manager", "data-analyst", "business-analyst",
    "product-manager", "product-designer", "product-design-manager",
    "ux-researcher", "technical-program-manager", "program-manager",
    "project-manager", "solution-architect", "technical-writer",
    "information-technologist", "security-analyst", "hardware-engineer",
    "prompt-engineer",
]


def get(url: str, delay: float) -> str | None:
    request = urllib.request.Request(
        url, headers={"User-Agent": UA, "Accept-Encoding": "gzip",
                      "Accept": "text/html,application/xhtml+xml"}
    )
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            raw = response.read()
            if response.headers.get("Content-Encoding") == "gzip":
                raw = gzip.decompress(raw)
            body = raw.decode("utf-8", "replace")
    except urllib.error.HTTPError as exc:
        if exc.code != 404:
            print(f"  HTTP {exc.code} for {url}", file=sys.stderr)
        return None
    except urllib.error.URLError as exc:
        print(f"  {exc.reason} for {url}", file=sys.stderr)
        return None
    finally:
        time.sleep(delay)
    return body


def page_props(html: str | None) -> dict | None:
    if not html:
        return None
    match = NEXT_DATA.search(html)
    if not match:
        return None
    try:
        return json.loads(match.group(1))["props"]["pageProps"]
    except (KeyError, json.JSONDecodeError):
        return None


def discover(delay: float) -> tuple[list[str], list[str]]:
    """Read the job-family taxonomy and Spanish locations off /locations."""
    props = page_props(get(f"{BASE}/locations", delay))
    if not props:
        print("  could not read /locations; falling back to defaults", file=sys.stderr)
        return TECH_FAMILIES, FALLBACK_LOCATIONS

    known = {f["slug"] for f in props.get("initialJobFamiliesArr") or [] if f.get("slug")}
    families = [f for f in TECH_FAMILIES if f in known] or TECH_FAMILIES
    locations = ["spain"]
    for group in (props.get("locations") or {}).values():
        for entry in group if isinstance(group, list) else []:
            name, slug = entry.get("name", ""), entry.get("slug")
            if slug and re.search(r"madrid|barcelona", f"{name} {slug}", re.I):
                locations.append(slug)
    return families, locations


def to_eur(value, rate) -> int | None:
    """Page figures are USD; locationExchangeRate converts them."""
    if not isinstance(value, (int, float)) or not isinstance(rate, (int, float)):
        return None
    return int(round(value * rate))


def merge_company(name: str, slug: str, role: str, p50: int, url: str,
                  date: str, location: str) -> None:
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
            f"Median total compensation across all levels, {location}. "
            "Levels.fyi's public pages do not break this out by level or "
            "separate base salary."
        ),
    }

    roles = company.setdefault("compensation", {}).setdefault("roles", [])
    bucket = next((r for r in roles if r["role"] == role), None)
    if bucket is None:
        bucket = {"role": role, "levels": []}
        roles.append(bucket)
    existing = next((e for e in bucket["levels"] if e.get("level") == "all"), None)
    # Several locations cover the same company; keep the highest observed median
    # so a thin metro slice doesn't overwrite the national figure.
    if existing is None:
        bucket["levels"].append(band)
    elif p50 > (existing.get("total_comp") or {}).get("p50", 0):
        bucket["levels"][bucket["levels"].index(existing)] = band
    bucket["levels"].sort(key=lambda e: lib.level_rank(e["level"]))

    rest = {k: v for k, v in company.items() if k not in SKELETON_ORDER}
    ordered = {k: company[k] for k in SKELETON_ORDER if k in company}
    ordered.update(rest)
    path.write_text(
        yaml.safe_dump(ordered, sort_keys=False, allow_unicode=True, width=100), encoding="utf-8"
    )


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--role", action="append", default=[], help="Limit to these job families.")
    parser.add_argument("--delay", type=float, default=0.7, help="Seconds between requests.")
    parser.add_argument("--dry-run", action="store_true", help="List the URLs and stop.")
    args = parser.parse_args(argv)

    today = lib.today_utc().isoformat()
    families, locations = discover(0 if args.dry_run else args.delay)
    if args.role:
        families = [f for f in families if f in args.role]
        if not families:
            parser.error("none of those roles exist in the Levels.fyi taxonomy")

    print(f"{len(families)} job families x {len(locations)} locations")
    benchmarks, touched, pages = [], set(), 0

    for family in families:
        for location in locations:
            url = f"{BASE}/t/{family}/locations/{location}"
            if args.dry_run:
                print(f"GET {url}")
                continue
            props = page_props(get(url, args.delay))
            if not props:
                continue
            currency, rate = props.get("locationCurrency"), props.get("locationExchangeRate")
            if currency != "EUR":
                print(f"  skipping {family}/{location}: currency {currency}", file=sys.stderr)
                continue

            companies = props.get("topPayingCompanies") or []
            percentiles = props.get("jobFamilyLocationPercentiles") or {}
            if not companies and not percentiles:
                continue
            pages += 1
            place = props.get("location") or props.get("compTableFilterLocationName") or location

            if percentiles.get("p50"):
                benchmarks.append({
                    "role": family, "location": place, "location_slug": location,
                    "currency": "EUR", "url": url, "last_updated": today,
                    "data_points": percentiles.get("count") or props.get("totalJobFamilySubmissionCount"),
                    **{p: to_eur(percentiles.get(p), rate) for p in ("p25", "p50", "p75", "p90")},
                })

            written = 0
            for entry in companies:
                value = to_eur(entry.get("totalCompensation"), rate)
                slug = entry.get("slug") or slugify(entry.get("name", ""))
                if not value or not slug:
                    continue
                merge_company(entry.get("name") or slug, slug, family, value, url, today, place)
                touched.add(slug)
                written += 1
            if written or percentiles.get("p50"):
                print(f"  {family} / {location}: {written} companies"
                      f"{', benchmark ' + str(to_eur(percentiles.get('p50'), rate)) if percentiles.get('p50') else ''}")

    if args.dry_run:
        return 0

    if benchmarks:
        benchmarks.sort(key=lambda b: (b["role"], b["location_slug"]))
        (lib.ROOT / "data" / "benchmarks.json").write_text(
            json.dumps({"attribution": ATTRIBUTION, "generated": today,
                        "benchmarks": benchmarks}, indent=2, ensure_ascii=False) + "\n",
            encoding="utf-8",
        )

    print(f"\n{pages} pages with data · {len(benchmarks)} benchmarks · {len(touched)} companies")
    if touched:
        print(f"\n{ATTRIBUTION}")
        print("TOTAL COMPENSATION across all levels, converted to EUR. Not base salary.")
        print("Next: python3 scripts/validate.py && python3 scripts/build.py")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
