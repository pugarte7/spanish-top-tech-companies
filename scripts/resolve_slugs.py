#!/usr/bin/env python3
"""Match company names in data/backlog.csv to Levels.fyi company slugs.

    python3 scripts/resolve_slugs.py

Levels.fyi's company search is behind the paid API and its /companies directory
is bot-protected, so this guesses slugs from the name and checks each with a
HEAD request (a few hundred bytes, versus 400KB for the page itself). The first
candidate that answers 200 wins and is written back to backlog.csv.
"""
from __future__ import annotations

import argparse
import csv
import re
import sys
import time
import urllib.error
import urllib.request

import lib

BASE = "https://www.levels.fyi/companies"

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

UA = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/128.0 Safari/537.36")

# Legal and descriptive tails that are never part of a Levels.fyi slug.
SUFFIXES = r"(inc|llc|ltd|limited|plc|gmbh|ag|se|nv|n\.?v|sa|s\.?a|sl|s\.?l|ab|as|oy|" \
           r"corp|corporation|company|group|holdings|technologies|technology|labs|" \
           r"international|worldwide|global)"


def slugify(text: str, joiner: str = "-") -> str:
    text = text.lower().replace("&", " and ")
    text = re.sub(r"[^a-z0-9]+", " ", text).strip()
    return joiner.join(text.split())


def candidates(name: str) -> list[str]:
    out: list[str] = []

    def add(value: str) -> None:
        for joiner in ("-", ""):
            slug = slugify(value, joiner)
            if slug and slug not in out:
                out.append(slug)

    add(name)

    # "Electronic Arts (EA)" -> the acronym is usually the slug
    inner = re.findall(r"\(([^)]+)\)", name)
    outer = re.sub(r"\s*\([^)]*\)", "", name).strip()
    if outer and outer != name:
        add(outer)
    for value in inner:
        if len(value) <= 30:
            add(value)

    # "Confluent, an IBM Company" / "Ryanair - Europe's Favourite Airline"
    head = re.split(r"\s*[,|]\s*| - ", name)[0].strip()
    if head and head != name:
        add(head)

    # Drop legal tails, one at a time
    stripped = re.sub(rf"\b{SUFFIXES}\b\.?$", "", head or name, flags=re.I).strip(" .,")
    if stripped and stripped != (head or name):
        add(stripped)

    # "Booking.com" -> booking
    dotted = re.sub(r"\.(com|io|ai|co|org|net)\b", "", name, flags=re.I).strip()
    if dotted != name:
        add(dotted)

    return out[:6]


def exists(slug: str, delay: float) -> bool:
    request = urllib.request.Request(
        f"{BASE}/{slug}/salaries", method="HEAD",
        headers={"User-Agent": UA, "Accept-Encoding": "gzip"})
    try:
        with urllib.request.urlopen(request, timeout=20) as response:
            check_blocked(response.status, None)
            return response.status == 200
    except urllib.error.HTTPError as exc:
        check_blocked(exc.code, None)
        return False
    except urllib.error.URLError as exc:
        print(f"  network: {exc.reason}", file=sys.stderr)
        return False
    finally:
        time.sleep(delay)


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--delay", type=float, default=2.0,
                        help="Seconds between probes. Below ~1.5 trips their WAF.")
    parser.add_argument("--retry-missing", action="store_true",
                        help="Re-probe rows already marked unmatched.")
    args = parser.parse_args(argv)

    path = lib.ROOT / "data" / "backlog.csv"
    with path.open(encoding="utf-8") as fh:
        rows = list(csv.DictReader(fh))

    fields = ["linkedin_id", "name", "levels_slug", "status", "notes"]
    hits = misses = skipped = 0

    try:
      for row in rows:
        name = (row.get("name") or "").strip()
        if not name:
            continue
        if row.get("levels_slug") and not args.retry_missing:
            skipped += 1
            continue
        if row.get("status") == "unmatched" and not args.retry_missing:
            skipped += 1
            continue

        for slug in candidates(name):
            if exists(slug, args.delay):
                row["levels_slug"] = slug
                row["status"] = "resolved"
                hits += 1
                print(f"  {name}  ->  {slug}")
                break
        else:
            row["levels_slug"] = ""
            row["status"] = "unmatched"
            misses += 1
            print(f"  {name}  ->  not on Levels.fyi")

    except Blocked as exc:
        print(f"\n{exc}", file=sys.stderr)
        print("Progress so far is saved.", file=sys.stderr)

    with path.open("w", encoding="utf-8", newline="") as fh:
        writer = csv.DictWriter(fh, fieldnames=fields, extrasaction="ignore")
        writer.writeheader()
        for row in rows:
            writer.writerow({k: row.get(k, "") for k in fields})

    print(f"\n{hits} matched, {misses} unmatched, {skipped} already done")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
