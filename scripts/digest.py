#!/usr/bin/env python3
"""What changed in companies.csv since a git revision, as Markdown.

    python3 scripts/digest.py            # working tree against HEAD
    python3 scripts/digest.py 3dd5b0e    # against an older commit

The weekly refresh posts this as an issue, so each Monday's new data points
arrive as a notification, with a draft post at the bottom. Rows carry no
submission id, so a new salary is a row that, minus the run date, was not on
file before.
"""
from __future__ import annotations

import collections
import pathlib
import subprocess
import sys
import tempfile

import build
import lib

REPO = "https://github.com/pugarte7/spanish-top-tech-companies"
POST_LIMIT = 280
LINK_LENGTH = 23  # X counts every link as 23 characters
MAIN, BEHIND = "60k+", "need to improve"


def at(revision: str) -> list[dict]:
    text = subprocess.run(["git", "show", f"{revision}:companies.csv"], cwd=lib.ROOT,
                          capture_output=True, text=True, check=True).stdout
    with tempfile.TemporaryDirectory() as directory:
        path = pathlib.Path(directory) / "companies.csv"
        path.write_text(text, encoding="utf-8")
        return lib.read(path)[0]


def table(company: dict | None) -> str | None:
    if company is None or not lib.listed(company):
        return None
    return MAIN if lib.competitive(company) else BEHIND


def salaries(companies) -> collections.Counter:
    return collections.Counter(
        (company["company"], *(entry.get(column) for column in lib.ENTRY_COLUMNS if column != "date"))
        for company in companies for entry in company["entries"])


def median(company: dict) -> str:
    return build.k(lib.median_base(company))


def post(date: str, on_main: int, change: int, arrived: list[dict], new: int) -> str:
    head = (f"Senior software engineer pay in Spain, week of {date}: {on_main} companies "
            f"with a median base of 60k+ ({change:+d}).")
    tail = f"{new} new salaries. {REPO}"
    names: list[str] = []
    for company in arrived:
        candidate = names + [f"{company['company']} ({median(company)})"]
        text = f"{head} New: {', '.join(candidate)}. {tail}"
        if len(text) - len(REPO) + LINK_LENGTH > POST_LIMIT:
            break
        names = candidate
    return " ".join([head, *([f"New: {', '.join(names)}."] if names else []), tail])


def main(argv: list[str]) -> int:
    before = {c["company"]: c for c in at(argv[0] if argv else "HEAD")}
    after = {c["company"]: c for c in lib.load_companies()}
    new = salaries(after.values()) - salaries(before.values())
    gone = salaries(before.values()) - salaries(after.values())
    by_median = lambda name: -(lib.median_base(after[name]) or 0)

    def count(companies, label: str) -> int:
        return sum(1 for company in companies if table(company) == label)

    def moved(was: str | None, now: str | None) -> list[str]:
        return sorted((name for name in after if table(before.get(name)) == was
                       and table(after[name]) == now), key=by_median)

    arrived = moved(None, MAIN) + moved(None, BEHIND)
    left = sorted(name for name in before if table(before[name]) and name not in after)
    changes = sorted(((name, lib.median_base(before[name]), lib.median_base(after[name]))
                      for name in after if name in before
                      and lib.median_base(before[name]) != lib.median_base(after[name])),
                     key=lambda change: -abs((change[2] or 0) - (change[1] or 0)))
    per_company: dict[str, list[int]] = collections.defaultdict(list)
    for name, base, *_ in new.elements():
        per_company[name].append(base or 0)

    on_main = count(after.values(), MAIN)
    change = on_main - count(before.values(), MAIN)
    behind = count(after.values(), BEHIND)
    engineers = sum(len(c["entries"]) for c in after.values())
    date = lib.today_utc().isoformat()

    out = [f"## Week of {date}", "",
           f"{on_main} companies at 60k+ ({change:+d}), {behind} need to improve "
           f"({behind - count(before.values(), BEHIND):+d}), {engineers} engineers "
           f"({engineers - sum(len(c['entries']) for c in before.values()):+d}): "
           f"{sum(new.values())} new salaries, {sum(gone.values())} no longer on file."]

    def section(title: str, lines: list[str]) -> None:
        if lines:
            out.extend(["", f"### {title}", "", *lines])

    section("New on the list", [f"- {name}: {median(after[name])} median, "
                                f"{len(after[name]['entries'])} engineers ({table(after[name])})"
                                for name in arrived])
    section("Up to 60k+", [f"- {name}: {median(after[name])}" for name in moved(BEHIND, MAIN)])
    section("Down to need to improve", [f"- {name}: {median(after[name])}"
                                        for name in moved(MAIN, BEHIND)])
    section("Off the list", [f"- {name} (was {median(before[name])})" for name in left])
    section("Median changes", [f"- {name}: {build.k(was)} → {build.k(now)}"
                               for name, was, now in changes[:15]])
    section("New salaries", [f"- {name}: {', '.join(build.k(base) for base in sorted(bases, reverse=True))}"
                             for name, bases in sorted(per_company.items(), key=lambda item: -len(item[1]))])
    section("Draft post", ["> " + post(date, on_main, change, [after[n] for n in arrived],
                                       sum(new.values()))])
    print("\n".join(out))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
