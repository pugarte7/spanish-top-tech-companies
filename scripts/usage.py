#!/usr/bin/env python3
"""How the project is used, as far as public counters tell: GitHub views,
clones, stars and forks of the repo, one row
per day into usage.csv beside the private companies.csv (lib.DATA).

    python3 scripts/usage.py          # update usage.csv, print the last 14 days

GitHub keeps traffic for 14 days only, so weekly.sh runs this every Monday
and the file is the history. The traffic API needs push access: it runs as
the maintainer through `gh`. A day read again overwrites the earlier reading,
since GitHub's and npm's latest day are still filling. What the site sees
itself (/mcp calls) is in PostHog, not here.
"""
from __future__ import annotations

import csv
import datetime as dt
import json
import subprocess
import sys
import urllib.request

import lib

FILE = lib.DATA.parent / "usage.csv"
REPOS = ["pugarte7/spanish-top-tech-companies"]
PACKAGES: list[str] = []
FIELDS = ["date", "source", "metric", "value"]


def gh(path: str) -> dict:
    out = subprocess.run(["gh", "api", path], check=True, capture_output=True, text=True).stdout
    return json.loads(out)


def npm(package: str, days: int = 60) -> list[tuple[str, str, str, int]]:
    end = dt.date.today()
    url = (f"https://api.npmjs.org/downloads/range/{end - dt.timedelta(days=days)}:{end}/{package}")
    with urllib.request.urlopen(url, timeout=30) as r:
        body = json.load(r)
    return [(d["day"], f"npm:{package}", "downloads", d["downloads"]) for d in body.get("downloads", [])]


def github(repo: str) -> list[tuple[str, str, str, int]]:
    source = f"github:{repo}"
    rows = []
    for kind in ("views", "clones"):
        for day in gh(f"repos/{repo}/traffic/{kind}")[kind]:
            date = day["timestamp"][:10]
            rows += [(date, source, kind, day["count"]), (date, source, f"{kind}_unique", day["uniques"])]
    info = gh(f"repos/{repo}")
    today = dt.date.today().isoformat()
    rows += [(today, source, "stars", info["stargazers_count"]), (today, source, "forks", info["forks_count"])]
    return rows


def read() -> dict[tuple[str, str, str], int]:
    if not FILE.exists():
        return {}
    with FILE.open(newline="", encoding="utf-8") as f:
        return {(r["date"], r["source"], r["metric"]): int(r["value"]) for r in csv.DictReader(f)}


def write(rows: dict[tuple[str, str, str], int]) -> None:
    FILE.parent.mkdir(parents=True, exist_ok=True)
    tmp = FILE.with_suffix(".tmp")
    with tmp.open("w", newline="", encoding="utf-8") as f:
        out = csv.writer(f)
        out.writerow(FIELDS)
        for key in sorted(rows):
            out.writerow([*key, rows[key]])
    tmp.replace(FILE)


def main() -> int:
    rows = read()
    failed = []
    for name, fetch in [*((p, npm) for p in PACKAGES), *((r, github) for r in REPOS)]:
        try:
            rows.update({(d, s, m): v for d, s, m, v in fetch(name)})
        except Exception as e:  # one source down must not lose the others
            failed.append(f"{name}: {e}")
    write(rows)
    since = (dt.date.today() - dt.timedelta(days=14)).isoformat()
    totals: dict[tuple[str, str], int] = {}
    for (date, source, metric), value in rows.items():
        if date >= since and metric not in ("stars", "forks"):
            totals[source, metric] = totals.get((source, metric), 0) + value
    print(f"{FILE}: last 14 days, daily figures summed")
    for (source, metric), value in sorted(totals.items()):
        print(f"  {source:45} {metric:15} {value}")
    for line in failed:
        print(f"  failed {line}", file=sys.stderr)
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
