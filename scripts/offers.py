#!/usr/bin/env python3
"""Keeps the pay employers state in their postings, day after day.

    python3 scripts/offers.py _site/api/v1/jobs.json offers/offers.csv

Reads a jobs.json that jobs.mjs wrote and merges its postings that state pay
into offers.csv: one row per posting and range, with the first and the last
day it was seen. A posting whose range changes opens a new row, so a raise
in the ad shows as two. The deploy workflow runs this after every build and
commits the file to the `offers` branch, not to main: a daily commit there
would redeploy the site and race the Mac's weekly push.

Only what the crawl saw counts as seen. Postings jobs.mjs carried over from
production's previous index for a board that failed (boards.stale_since) are
skipped, and a jobs.json republished whole after a failed crawl carries its
old generated_at, so nothing moves forward.

This is the employers' own published data, not anyone's salary, so it is
public; companies.csv stays private.
"""
from __future__ import annotations

import csv
import json
import os
import pathlib
import sys

COLUMNS = ["id", "company", "slug", "title", "location", "location_classes", "workplace",
           "ats", "url", "posted_at", "min", "max", "currency", "period",
           "first_seen", "last_seen"]
# What makes a row: the posting and the range it states.
KEY = ("id", "min", "max", "currency", "period")
# Refreshed from the newest sighting; the rest of a row is fixed once written.
LATEST = ("company", "slug", "title", "location", "location_classes", "workplace", "url")


def cell(value) -> str:
    return "" if value is None else str(value)


def sightings(index: dict) -> tuple[str, list[dict]]:
    """The day the index was crawled and its postings that state pay, as rows."""
    day = index["generated_at"][:10]
    stale = set((index.get("boards") or {}).get("stale_since") or {})
    rows = []
    for job in index["jobs"]:
        pay = job.get("salary")
        if not pay or ":".join(job["id"].split(":")[:2]) in stale:
            continue
        rows.append({
            "id": job["id"], "company": job["company"], "slug": cell(job.get("slug")),
            "title": job["title"], "location": cell(job.get("location")),
            "location_classes": "|".join(job.get("location_classes") or []),
            "workplace": cell(job.get("workplace")), "ats": job["ats"], "url": cell(job.get("url")),
            "posted_at": cell(job.get("posted_at"))[:10],
            "min": cell(pay.get("min")), "max": cell(pay.get("max")),
            "currency": cell(pay.get("currency")), "period": cell(pay.get("period")),
            "first_seen": day, "last_seen": day,
        })
    return day, rows


def merge(history: list[dict], day: str, seen: list[dict]) -> tuple[list[dict], int, int]:
    """History with today's sightings in it; returns it, new rows, rows seen again."""
    rows = {tuple(r[k] for k in KEY): dict(r) for r in history}
    new = again = 0
    for s in seen:
        key = tuple(s[k] for k in KEY)
        old = rows.get(key)
        if old is None:
            rows[key] = s
            new += 1
            continue
        again += 1
        old["first_seen"] = min(old["first_seen"], day)
        if day >= old["last_seen"]:
            old["last_seen"] = day
            old.update({k: s[k] for k in LATEST})
    # A posting's rows stay together, oldest range first, even when its title changed.
    ordered = sorted(rows.values(), key=lambda r: (r["company"].casefold(), r["id"], r["first_seen"]))
    return ordered, new, again


def main(argv: list[str]) -> int:
    if len(argv) != 2:
        print(__doc__.strip().splitlines()[2].strip(), file=sys.stderr)
        return 2
    index_path, history_path = map(pathlib.Path, argv)
    index = json.loads(index_path.read_text(encoding="utf-8"))
    history = []
    if history_path.exists():
        with history_path.open(newline="", encoding="utf-8") as f:
            history = list(csv.DictReader(f))
    day, seen = sightings(index)
    rows, new, again = merge(history, day, seen)
    tmp = history_path.with_suffix(".tmp")
    with tmp.open("w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=COLUMNS, lineterminator="\n")
        writer.writeheader()
        writer.writerows(rows)
    os.replace(tmp, history_path)
    print(f"offers: {day}: {len(seen)} postings state pay, {new} new, {again} seen again; "
          f"{len(rows)} rows in {history_path}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
