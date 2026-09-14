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
`total_p50` at level `all`, never in base. Per-level ladders and base salary
come from each company's own Spain page instead: see scripts/fetch_spain.py.

Its real use is discovery. The top-paying tables name employers nobody thought
to look up, and that is how Accenture, BBVA, Indra and TravelPerk got onto the
list.
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


def merge_company(companies: list[dict], name: str, slug: str, role: str, p50: int,
                  url: str, date: str, location: str) -> None:
    company = lib.by_slug(companies, slug) or lib.by_name(companies, name)
    if company is None:
        company = lib.add_company(companies, name, levels_slug=slug, levels_status="resolved")

    band = {
        "role": role, "level": "all", "total_p50": p50,
        "source": "levels.fyi", "source_url": url, "date": date,
        "notes": (
            f"Median total compensation across all levels, {location}. "
            "Levels.fyi's public pages do not break this out by level or "
            "separate base salary."
        ),
    }

    same = [b for b in company["bands"] if b["role"] == role and b["level"] == "all"]
    country = [b for b in same if "/t/" in (b.get("source_url") or "")]
    # A company's own Spain page, or someone's first-hand figure, already says
    # more than one median pooled across every level. fetch_spain.py replaces a
    # country-page band with its own for the same reason.
    if len(same) > len(country):
        return
    # Several locations cover the same company; keep the highest observed median
    # so a thin metro slice doesn't overwrite the national figure.
    if not country:
        company["bands"].append(band)
    elif p50 > (country[0].get("total_p50") or 0):
        company["bands"][company["bands"].index(country[0])] = band


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
    companies = [] if args.dry_run else lib.load_companies()
    touched, pages = set(), 0

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

            paying = props.get("topPayingCompanies") or []
            if not paying:
                continue
            pages += 1
            place = props.get("location") or props.get("compTableFilterLocationName") or location

            written = 0
            for entry in paying:
                value = to_eur(entry.get("totalCompensation"), rate)
                slug = entry.get("slug") or lib.slugify(entry.get("name", ""))
                if not value or not slug:
                    continue
                merge_company(companies, entry.get("name") or slug, slug, family, value,
                              url, today, place)
                touched.add(slug)
                written += 1
            if written:
                lib.save_companies(companies)
                print(f"  {family} / {location}: {written} companies")

    if args.dry_run:
        return 0

    print(f"\n{pages} pages with data · {len(touched)} companies")
    if touched:
        print(f"\n{ATTRIBUTION}")
        print("TOTAL COMPENSATION across all levels, converted to EUR. Not base salary.")
        print("Next: python3 scripts/validate.py && python3 scripts/build.py")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
