#!/usr/bin/env python3
"""Job ads with a salary range from Manfred, for companies already on file.

    python3 scripts/fetch_manfred.py            # replace every Manfred ad on file
    python3 scripts/fetch_manfred.py --dry-run  # print the matches, write nothing

https://www.getmanfred.com/api/v2/public/offers is public and answers every
offer Manfred has published since 2021, open and closed, in one response.
Manfred ads always state a range, which is why this source and not LinkedIn.

A range is what a company offered, not what anyone is paid, so the rows are
`job-posting` with `base` and `base_max` as its ends, and lib.salaries()
keeps them out of every median: the README shows them in their own column
and the website not at all. Only companies with salaries on file get ads -
an ad does not put a company on the list - matched the way fetch_radar.py
matches, by domain and then by exact name, the name matches printed.

An ad counts only if it names a city in Spain. Most remote ads name no
place at all, and "remote" on Manfred can mean anywhere in Europe; the same
rule as for Levels.fyi: the row's own location, never an assumption.
Freelance ads quote day rates, not salaries, and are skipped.

The download is the whole set, so the stored Manfred rows are replaced
wholesale; a download that fails or comes back empty changes nothing.
"""
from __future__ import annotations

import argparse
import json
import sys
import urllib.error
import urllib.request

import fetch_radar
import lib

API = "https://www.getmanfred.com/api/v2/public/offers?lang=ES"
OFFER_URL = "https://www.getmanfred.com/ofertas-empleo/{id}/{slug}"
SPAIN = ", España"
EUROS = {"€", "EUR"}


def download() -> list[dict]:
    request = urllib.request.Request(API, headers={"User-Agent": fetch_radar.UA})
    try:
        with urllib.request.urlopen(request, timeout=120) as response:
            offers = json.load(response)
    except (urllib.error.URLError, OSError, json.JSONDecodeError) as exc:
        raise SystemExit(f"Manfred unreadable: {exc}") from exc
    if not isinstance(offers, list) or not offers:
        raise SystemExit("Manfred answered no offers; leaving the file as it is")
    return offers


def ours(entry: dict) -> bool:
    return (entry.get("source") in lib.POSTED
            and "getmanfred.com" in (entry.get("source_url") or ""))


def arrangement(remote_percentage) -> str | None:
    if not isinstance(remote_percentage, (int, float)):
        return None
    if remote_percentage >= 100:
        return "remote"
    return "office" if remote_percentage <= 0 else "hybrid"


def entry(offer: dict, today: str) -> dict | None:
    """One ad as a row, or None when it is not a salaried job in Spain."""
    where = next((place for place in offer.get("locations") or []
                  if place.endswith(SPAIN)), None)
    low, high = offer.get("salaryFrom") or None, offer.get("salaryTo") or None
    if (where is None or offer.get("isFreelance") or not (low or high)
            or (offer.get("currency") or "").strip() not in EUROS):
        return None
    found = lib.posting_role(offer.get("position"))
    if found is None:
        return None
    role, title = found
    city, _ = lib.split_location(where[: -len(SPAIN)])
    return {
        "role": role, "base": low, "base_max": high, "total": None,
        "bonus": offer.get("bonus") or None, "stock": None, "currency": "EUR",
        "years_experience": None, "level": None, "title": title,
        "specialization": lib.title_spec(role, title),
        "city": city, "region": lib.region_code(city),
        "work_arrangement": arrangement(offer.get("remotePercentage")),
        "employment_type": None, "perspective": None,
        "reported": (offer.get("updatedAt") or "")[:7] or None,
        "source": "job-posting",
        "source_url": OFFER_URL.format(id=offer["id"], slug=offer["slug"]),
        "date": today, "notes": None,
    }


def match(companies: list[dict], offers: list[dict]) -> dict:
    """{id(company): (company, [offers], how)} for companies with salaries."""
    by_domain, by_name = {}, {}
    for company in companies:
        if not lib.salaries(company):
            continue
        if fetch_radar.domain(company.get("website")):
            by_domain.setdefault(fetch_radar.domain(company["website"]), []).append(company)
        by_name.setdefault(fetch_radar.norm_name(company["company"]), []).append(company)
    found: dict[int, tuple] = {}
    for offer in offers:
        employer = offer.get("company") or {}
        candidates, how = by_domain.get(fetch_radar.domain(employer.get("web")), []), "domain"
        if len(candidates) != 1:
            candidates, how = by_name.get(fetch_radar.norm_name(employer.get("name")), []), "name"
        if len(candidates) != 1:
            continue
        company = candidates[0]
        found.setdefault(id(company), (company, [], how))[1].append(offer)
    return found


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description=__doc__,
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--dry-run", action="store_true",
                        help="Print the matches, write nothing.")
    args = parser.parse_args(argv)

    offers = download()
    companies = lib.load_companies()
    today = lib.today_utc().isoformat()
    rows = {}
    for key, (company, matched, how) in match(companies, offers).items():
        written = [row for row in (entry(offer, today) for offer in matched) if row]
        if written:
            rows[key] = written
            if how == "name" or args.dry_run:
                print(f"  {company['company']}: {len(written)} ads, matched on {how}",
                      file=sys.stderr)
    total = sum(len(found) for found in rows.values())
    print(f"{len(offers)} Manfred offers, {total} salaried ads in Spain "
          f"at {len(rows)} companies on file")
    if args.dry_run:
        return 0
    for company in companies:
        company["entries"] = ([e for e in company["entries"] if not ours(e)]
                              + rows.get(id(company), []))
    lib.save_companies(companies)
    print("Next: python3 scripts/validate.py && python3 scripts/build.py")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
