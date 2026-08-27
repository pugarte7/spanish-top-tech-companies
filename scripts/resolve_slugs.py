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
import difflib
import gzip
import json
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
    """Slug guesses, most specific first.

    Verification happens afterwards, so loose guesses are safe to include:
    a wrong one gets rejected by the name check rather than silently accepted.
    """
    out: list[str] = []

    def add(value: str) -> None:
        value = (value or "").strip(" .,:-")
        if not value:
            return
        for joiner in ("-", ""):
            slug = slugify(value, joiner)
            if slug and slug not in out:
                out.append(slug)

    add(name)

    # "Electronic Arts (EA)", "Amazon Web Services (AWS)"
    inner = re.findall(r"\(([^)]+)\)", name)
    outer = re.sub(r"\s*\([^)]*\)", "", name).strip()
    if outer and outer != name:
        add(outer)

    # "Confluent, an IBM Company" | "Ryanair - Europe's..." | "Volkswagen Digital:Hub"
    head = re.split(r"\s*[,|:]\s*| - ", outer or name)[0].strip()
    add(head)

    # Leading article: "The Trade Desk" -> "trade-desk"
    if head.lower().startswith("the "):
        add(head[4:])

    # Legal and descriptive tails, stripped repeatedly: "Bumble Inc." -> "bumble"
    trimmed = head
    for _ in range(3):
        stepped = re.sub(rf"\b{SUFFIXES}\b\.?$", "", trimmed, flags=re.I).strip(" .,")
        if stepped == trimmed:
            break
        trimmed = stepped
        add(trimmed)

    # Trailing product/segment words: "DeepSeek AI", "Clarity AI", "Adevinta Spain"
    tail = re.sub(r"\s+(ai|spain|iberia|streaming|official|digital|hub|bank|"
                  r"trading|systems|studios)$", "", trimmed, flags=re.I).strip()
    if tail and tail != trimmed:
        add(tail)

    # "Crunch.io", "Just Eat Takeaway.com"
    dotted = re.sub(r"\.(com|io|ai|co|org|net|es)\b", "", name, flags=re.I).strip()
    if dotted != name:
        add(dotted)

    for value in inner:
        if len(value) <= 30:
            add(value)

    # Last resort: the first word, only for multi-word names. Cheap to test and
    # the verification step throws it out if it lands somewhere unrelated.
    first = head.split()[0] if head.split() else ""
    if len(head.split()) > 1 and len(first) > 3:
        add(first)

    return out[:10]


def normalise(text: str) -> str:
    text = text.lower().replace("&", " and ")
    text = re.sub(rf"\b{SUFFIXES}\b", " ", text, flags=re.I)
    return " ".join(re.sub(r"[^a-z0-9]+", " ", text).split())


def verify(slug: str, name: str, delay: float) -> tuple[str, str, int]:
    """Fetch the page and decide whether it is really this company.

    Returns (verdict, their_name, data_rows) where verdict is "strong",
    "review" or "no". A slug only counts when the name on the page resembles
    the one we asked for AND the page carries salary data - entries are the
    strong signal that it is the right company. Loose substring matches go to
    "review" rather than being accepted silently.
    """
    request = urllib.request.Request(
        f"{BASE}/{slug}/salaries",
        headers={"User-Agent": UA, "Accept-Encoding": "gzip",
                 "Accept": "text/html,application/xhtml+xml"})
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            raw = response.read()
            if response.headers.get("Content-Encoding") == "gzip":
                raw = gzip.decompress(raw)
            body = raw.decode("utf-8", "replace")
        check_blocked(200, body)
    except urllib.error.HTTPError as exc:
        check_blocked(exc.code, None)
        return "no", "", 0
    except urllib.error.URLError:
        return "no", "", 0
    finally:
        time.sleep(delay)

    match = re.search(r'<script id="__NEXT_DATA__"[^>]*>(.*?)</script>', body, re.S)
    if not match:
        return "no", "", 0
    try:
        props = json.loads(match.group(1))["props"]["pageProps"]
    except (KeyError, json.JSONDecodeError):
        return "no", "", 0

    record = props.get("company") or {}
    theirs = record.get("name") or ""
    rows = len(props.get("overview") or [])

    ours_n, theirs_n = normalise(name), normalise(theirs)
    aliases = [normalise(a) for a in (record.get("aliases") or []) if isinstance(a, str)]
    ratio = difflib.SequenceMatcher(None, ours_n, theirs_n).ratio()

    if not theirs_n or rows == 0:
        return "no", theirs, rows
    if ours_n == theirs_n or ours_n in aliases or ratio >= 0.85:
        return "strong", theirs, rows

    # Containment only counts when the shorter name covers most of the longer.
    # Without this, "Just Eat Takeaway.com" matches a company called "JUST".
    short, long = sorted((ours_n, theirs_n), key=len)
    coverage = len(short) / len(long) if long else 0
    if short in long and coverage >= 0.6:
        return "strong", theirs, rows
    if ratio >= 0.72:
        return "strong", theirs, rows
    if short in long:
        # Right shape for a parent company (AWS -> Amazon), and the right shape
        # for a coincidence. A human decides.
        return "review", theirs, rows
    return "no", theirs, rows
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
    hits = misses = skipped = review = 0

    try:
      for row in rows:
        name = (row.get("name") or "").strip()
        if not name:
            continue
        if row.get("levels_slug") and not args.retry_missing:
            skipped += 1
            continue
        if row.get("status") in ("unmatched", "review") and not args.retry_missing:
            skipped += 1
            continue

        pending = None
        for slug in candidates(name):
            if not exists(slug, args.delay):
                continue
            verdict, theirs, n_rows = verify(slug, name, args.delay)
            if verdict == "strong":
                row["levels_slug"] = slug
                row["status"] = "resolved"
                row["notes"] = "" if normalise(theirs) == normalise(name) else f"matched as {theirs}"
                hits += 1
                print(f"  {name}  ->  {slug}  ({theirs}, {n_rows} rows)")
                break
            if verdict == "review" and pending is None:
                pending = (slug, theirs, n_rows)
            elif theirs:
                print(f"    rejected {slug}: page is '{theirs}' ({n_rows} rows)")
        else:
            if pending:
                slug, theirs, n_rows = pending
                row["levels_slug"] = slug
                row["status"] = "review"
                row["notes"] = f"loose match to '{theirs}' ({n_rows} rows) - confirm before trusting"
                review += 1
                print(f"  {name}  ->  {slug}?  needs review (page says '{theirs}', {n_rows} rows)")
            else:
                row["levels_slug"] = ""
                row["status"] = "unmatched"
                misses += 1
                print(f"  {name}  ->  not on Levels.fyi")

    except Blocked as exc:
        print(f"\n{exc}", file=sys.stderr)
        print("Progress so far is saved.", file=sys.stderr)

    # Write beside the original and swap it in: an in-place "w" open once
    # truncated this file when the loop below raised.
    tmp = path.with_suffix(".csv.tmp")
    with tmp.open("w", encoding="utf-8", newline="") as fh:
        writer = csv.DictWriter(fh, fieldnames=fields, extrasaction="ignore")
        writer.writeheader()
        for row in rows:
            writer.writerow({k: row.get(k, "") for k in fields})
    tmp.replace(path)

    print(f"\n{hits} matched, {review} need review, {misses} unmatched, {skipped} already done")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
