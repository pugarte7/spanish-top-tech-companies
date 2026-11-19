#!/usr/bin/env python3
"""Checks a refresh must pass before anything leaves the machine.

    python3 scripts/guard.py BEFORE.csv

Run after site.py --refresh and before the private files or data/ are pushed
(refresh.yml, weekly.sh). Exits 1 on the first failed check. It prints counts
and the name of the check only: refresh.yml keeps its output in the private
log anyway.

On 2026-11-19 the first refresh on Actions ran without private-sources.txt;
validate.py stopped it, but only because the unknown source was also an
invalid one. These checks do not rely on that.
"""
from __future__ import annotations

import json
import pathlib
import subprocess
import sys

import lib

DATA_DIR = pathlib.Path(__file__).resolve().parent.parent / "data"
# A week's refresh adds rows; a whole read of a quarter of the roles removes
# only submissions Levels.fyi deleted. More than this gone is a broken read.
MAX_LEVELS_DROP = 0.05
# Companies listed on the site, against the copy committed on main.
MAX_COMPANIES_DROP = 0.10


def levels_rows(path: pathlib.Path) -> int:
    companies = lib.load_companies(path)
    return sum(1 for c in companies for e in c["entries"] if e.get("source") == "levels.fyi")


def committed_companies() -> int | None:
    try:
        text = subprocess.run(["git", "show", "HEAD:data/data.json"], capture_output=True,
                              text=True, check=True, cwd=DATA_DIR.parent).stdout
    except (subprocess.CalledProcessError, FileNotFoundError):
        return None
    return len(json.loads(text).get("companies") or [])


def fail(check: str, detail: str) -> int:
    print(f"guard: {check} FAILED: {detail}")
    return 1


def main(argv: list[str]) -> int:
    if len(argv) != 1:
        print(__doc__)
        return 2
    before = pathlib.Path(argv[0])

    # 1. The sources kept off everything public are known on this machine.
    sources = lib.DATA.parent / "private-sources.txt"
    if not sources.is_file() or not lib.UNPUBLISHED_SOURCES:
        return fail("private sources", "private-sources.txt is missing or empty")
    print(f"guard: private sources ok ({len(lib.UNPUBLISHED_SOURCES)})")

    # 2. None of them reached the public data, not even as a word.
    public = "\n".join(p.read_text(encoding="utf-8", errors="replace").lower()
                       for p in DATA_DIR.rglob("*") if p.is_file())
    leaked = [s for s in lib.UNPUBLISHED_SOURCES if s.lower() in public]
    if leaked:
        return fail("public data", f"{len(leaked)} unpublished source name(s) found in data/")
    print("guard: public data names no unpublished source")

    # 3. The Levels.fyi rows did not shrink.
    was, now = levels_rows(before), levels_rows(lib.DATA)
    if was and now < was * (1 - MAX_LEVELS_DROP):
        return fail("levels rows", f"{was} -> {now}")
    print(f"guard: levels rows ok ({was} -> {now})")

    # 4. The site does not lose a slice of its companies.
    was = committed_companies()
    now = len(json.loads((DATA_DIR / "data.json").read_text(encoding="utf-8"))["companies"])
    if was and now < was * (1 - MAX_COMPANIES_DROP):
        return fail("listed companies", f"{was} -> {now}")
    print(f"guard: listed companies ok ({was} -> {now})")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
