#!/usr/bin/env python3
"""Fetch Spain-scoped pay per company from Levels.fyi, and only Spain.

    python3 scripts/fetch_spain.py                 # every resolved backlog slug
    python3 scripts/fetch_spain.py --company glovo
    python3 scripts/fetch_spain.py --audit         # report, write nothing

Why this exists instead of fetch_company.py: that script reads
/companies/<slug>/salaries, which is scoped by the caller's IP and silently
falls back to another country when Levels.fyi has no Spanish submissions. Its
only guard is that the page currency is EUR, which every euro-zone country
passes. Adyen, Celonis, N26, TomTom and FREE NOW all returned Dutch or German
salaries that way, and Datadog, Microsoft and Amazon returned US ones.

The per-location page carries `percentiles.locationName`, which names the
country actually served rather than the one requested. That is the guard: a
band is written only when it says Spain. `locationMeta` is not usable for this,
it only echoes back the URL.

The same page also publishes base salary percentiles, which the company pages
do not, so bands from here carry a real `base` rather than total comp alone.
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
from new_company import SKELETON_ORDER

BASE = "https://www.levels.fyi"
ROLE = "software-engineer"
ATTRIBUTION = "Data source: Levels.fyi (https://www.levels.fyi)"
UA = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/128.0 Safari/537.36")

# Written by fetch_company.py from the unscoped company page. Those bands carry
# no location guarantee, so they are dropped for any company Levels.fyi does
# not actually hold Spanish data for.
UNSCOPED_NOTE = re.compile(r"reports this as", re.I)


class Blocked(RuntimeError):
    """Levels.fyi's WAF returned a bot challenge."""


def get(url: str, delay: float, attempts: int = 3) -> str | None:
    """Fetch one page, retrying transient network faults.

    A dropped connection mid-read raises ConnectionResetError, which is an
    OSError and not wrapped by urllib.error, so catching URLError alone lets it
    kill a 243-page run. One reset is not a verdict about the company: retry.
    """
    request = urllib.request.Request(
        url, headers={"User-Agent": UA, "Accept-Encoding": "gzip",
                      "Accept": "text/html,application/xhtml+xml"})
    for attempt in range(attempts):
        try:
            with urllib.request.urlopen(request, timeout=30) as response:
                raw = response.read()
                if response.headers.get("Content-Encoding") == "gzip":
                    raw = gzip.decompress(raw)
                body = raw.decode("utf-8", "replace")
            if "Human Verification" in body[:2000]:
                raise Blocked("Levels.fyi served a bot challenge. Wait, then retry "
                              "with a larger --delay.")
            time.sleep(delay)
            return body
        except urllib.error.HTTPError as exc:
            time.sleep(delay)
            if exc.code in (403, 405, 429, 503):
                raise Blocked(f"Levels.fyi answered HTTP {exc.code}. Wait, then retry "
                              f"with a larger --delay.") from exc
            return None
        except (urllib.error.URLError, OSError) as exc:
            last = exc
            # Back off a little further each time before giving up on the page.
            time.sleep(delay * (attempt + 1))
    print(f"  network: {last} for {url}", file=sys.stderr)
    return None


def spain_data(slug: str, delay: float):
    """(label, percentiles, median) — whichever of the two is Spanish.

    The page answers in two independent voices and they disagree constantly.
    `percentiles` is an aggregate that falls back to another country when the
    Spanish sample is too small to publish; `median` is one real submission for
    the location asked about, and it stays Spanish even when the aggregate has
    given up. Stripe, Spotify, Scopely and Amadeus all serve a US or Indian
    aggregate next to a Barcelona or Madrid submission, so trusting only the
    aggregate throws away the very data this repository wants.

    Either returns None when it is not Spain. `label` is for the run report.
    """
    url = f"{BASE}/companies/{slug}/salaries/{ROLE}/locations/spain"
    body = get(url, delay)
    if not body:
        return None, None, None, {}
    found = re.search(r'<script id="__NEXT_DATA__"[^>]*>(.*?)</script>', body, re.S)
    if not found:
        return None, None, None, {}
    try:
        props = json.loads(found.group(1))["props"]["pageProps"]
    except (KeyError, json.JSONDecodeError):
        return None, None, None, {}

    percentiles = props.get("percentiles") or {}
    aggregate = percentiles if percentiles.get("locationName") == "Spain" else None

    median = props.get("median") or {}
    where = str(median.get("location") or "")
    submission = median if where.strip().endswith("Spain") else None

    if aggregate:
        label = "Spain (aggregate)"
    elif submission:
        label = "Spain (submission)"
    else:
        label = percentiles.get("locationName") or "no data"
    # The company record is about the employer, not the location, so it is
    # worth keeping even when there is no Spanish pay to record.
    return label, aggregate, submission, props.get("company") or {}


def band(aggregate: dict | None, submission: dict | None, slug: str,
         today: str) -> dict | None:
    """One band at level `all`, from whichever Spanish source we have.

    An aggregate gives a real interquartile range. A lone submission gives one
    number, recorded with sample_size 1 so nobody mistakes it for a
    distribution: a band that says 1 is a data point, not a salary band.
    """
    source = {
        "name": "levels.fyi",
        "url": f"{BASE}/companies/{slug}/salaries/{ROLE}/locations/spain",
        "date": today,
    }

    if aggregate:
        def money(block):
            out = {}
            for ours, theirs in (("min", "p25"), ("p50", "p50"), ("max", "p75")):
                value = (block or {}).get(theirs)
                if value is not None:
                    out[ours] = round(value)
            return out

        base = money(aggregate.get("base_salary"))
        total = money(aggregate.get("tc"))
        if not base and not total:
            return None
        return {
            "level": "all",
            "base": base,
            "total_comp": total,
            "sources": [source],
            "last_verified": today,
            "notes": ("Spain only: Levels.fyi reports this location as Spain. "
                      "Base and total compensation, interquartile range."),
        }

    if not submission:
        return None
    base = submission.get("baseSalary")
    total = submission.get("totalCompensation")
    if base is None and total is None:
        return None
    reported = submission.get("level") or "unspecified"
    years = submission.get("yearsOfExperience")
    where = submission.get("location") or "Spain"
    return {
        "level": "all",
        "base": {"p50": round(base)} if base is not None else {},
        "total_comp": {"p50": round(total)} if total is not None else {},
        "sample_size": 1,
        "sources": [source],
        "last_verified": today,
        "notes": (f"Single Spanish submission: {where}, reported level "
                  f"{reported}"
                  f"{f', {years} years experience' if years is not None else ''}. "
                  "Levels.fyi published no Spanish aggregate for this company, "
                  "so this is one data point rather than a band."),
    }


def write(slug: str, new_band: dict | None, name_hint: str, today: str,
          record: dict | None = None) -> str:
    """Update one company file. Returns what happened, for the run report."""
    path = lib.COMPANIES_DIR / f"{slug}.yml"
    company = yaml.safe_load(path.read_text(encoding="utf-8")) if path.exists() else None
    created = company is None
    company = company or {"slug": slug, "name": name_hint or slug}
    company.setdefault("slug", slug)
    company.setdefault("name", name_hint or slug)

    # The employer's own LinkedIn page, which the front page links company
    # names to. Never overwrite one already on file: a hand-entered URL was
    # put there deliberately and is better than anything guessed here.
    handle = (record or {}).get("linkedin")
    linked = bool(handle) and not company.get("linkedin_url")
    if linked:
        company["linkedin_url"] = f"https://www.linkedin.com/{handle.strip('/')}"

    compensation = company.setdefault("compensation", {})
    compensation.setdefault("currency", "EUR")
    compensation.setdefault("basis", "gross_annual")
    roles = compensation.setdefault("roles", [])
    bucket = next((r for r in roles if r.get("role") == ROLE), None)

    if new_band is None:
        # No Spanish data. Everything the unscoped fetcher wrote for this
        # company is another country's pay, whatever the role, so it all goes
        # rather than sitting here mislabelled as Spanish. Bands from the Spain
        # country pages say so in their notes and are left alone.
        dropped = 0
        for role in list(roles):
            kept = [lvl for lvl in role.get("levels") or []
                    if not UNSCOPED_NOTE.search(lvl.get("notes") or "")]
            dropped += len(role.get("levels") or []) - len(kept)
            role["levels"] = kept
            if not kept:
                roles.remove(role)
        # Nothing to correct and no pay to record. Worth a write only to keep
        # a LinkedIn page on a company we already have a file for; a company
        # with neither is not worth a stub file holding one field.
        if not dropped and not (linked and not created):
            return "skipped"
    else:
        if bucket is None:
            bucket = {"role": ROLE, "levels": []}
            roles.append(bucket)
        levels = [lvl for lvl in bucket.get("levels") or [] if lvl.get("level") != "all"]
        levels.append(new_band)
        bucket["levels"] = sorted(levels, key=lambda e: lib.level_rank(e["level"]))

    rest = {k: v for k, v in company.items() if k not in SKELETON_ORDER}
    ordered = {k: company[k] for k in SKELETON_ORDER if k in company}
    ordered.update(rest)
    path.write_text(
        yaml.safe_dump(ordered, sort_keys=False, allow_unicode=True, width=100),
        encoding="utf-8")
    if new_band is None:
        return "cleaned"
    return "created" if created else "updated"


def targets() -> list[tuple[str, str]]:
    """(slug, name) for every company worth asking about, backlog and files."""
    out: dict[str, str] = {}
    path = lib.ROOT / "data" / "backlog.csv"
    if path.exists():
        with path.open(encoding="utf-8") as fh:
            for row in csv.DictReader(fh):
                if row.get("status") == "resolved" and row.get("levels_slug"):
                    out.setdefault(row["levels_slug"], (row.get("name") or "").strip())
    for existing in sorted(lib.COMPANIES_DIR.glob("*.yml")):
        if not existing.name.startswith("_"):
            out.setdefault(existing.stem, "")
    return sorted(out.items())


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description=__doc__,
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--company", action="append", default=[],
                        help="Levels.fyi slug. Repeatable. Defaults to every resolved slug.")
    parser.add_argument("--delay", type=float, default=3.0,
                        help="Seconds between pages. Below ~2 trips their WAF.")
    parser.add_argument("--audit", action="store_true",
                        help="Report what each company serves, write nothing.")
    args = parser.parse_args(argv)

    pending = [(s, "") for s in args.company] if args.company else targets()
    today = lib.today_utc().isoformat()
    served: dict[str, int] = {}
    tally: dict[str, int] = {}

    try:
        for slug, name in pending:
            label, aggregate, submission, record = spain_data(slug, args.delay)
            label = label or "no data"
            served[label] = served.get(label, 0) + 1
            new_band = band(aggregate, submission, slug, today)
            if new_band is None:
                print(f"  {slug}: {label}, nothing Spanish to record")
                if not args.audit:
                    outcome = write(slug, None, name, today, record)
                    tally[outcome] = tally.get(outcome, 0) + 1
                continue
            base = (new_band.get("base") or {}).get("p50")
            total = (new_band.get("total_comp") or {}).get("p50")
            kind = "aggregate" if aggregate else "1 submission"
            print(f"  {slug}: Spain ({kind}), base {base} tc {total}")
            if not args.audit:
                outcome = write(slug, new_band, name, today, record)
                tally[outcome] = tally.get(outcome, 0) + 1
    except Blocked as exc:
        print(f"\n{exc}", file=sys.stderr)
        print("Progress so far is saved.", file=sys.stderr)

    print("\nserved by country: " + ", ".join(
        f"{k} {v}" for k, v in sorted(served.items(), key=lambda kv: -kv[1])))
    if not args.audit:
        print("files: " + ", ".join(f"{k} {v}" for k, v in sorted(tally.items())))
        print(f"\n{ATTRIBUTION}")
        print("Next: python3 scripts/validate.py && python3 scripts/build.py")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
