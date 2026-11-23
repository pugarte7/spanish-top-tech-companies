#!/usr/bin/env python3
"""Decide which of remote_boards.mjs's candidates join the daily crawl.

    node scripts/remote_boards.mjs && python3 scripts/remote_levels.py

A board with postings open to Spain (an office or hybrid job in Spain, or
remote work naming Spain or Europe) is kept when one of them states its pay,
or when Levels.fyi knows its employer as the site asks of its own companies:
lib.MIN_GLOBAL submissions anywhere and one of them in Spain. One that states
pay is kept without asking Levels.fyi. It is written
to data/remote-boards.json, which site.py adds to the boards scripts/jobs.mjs
crawls every day; the rest go to data/remote-boards-none.json with the day,
and are not asked about again for RECHECK_DAYS.

Levels.fyi has no open search, so its slug is guessed from the board's name,
and a guess can land on another company of the same name: Ashby's "paradox"
is a French firm, Levels.fyi's Paradox an American one. A match counts only
when the board's postings mention the domain Levels.fyi has for the company,
or the board is named after that domain.

Both files take hand edits, which no run undoes: an entry with "via": "hand"
in remote-boards.json stays whatever Levels.fyi says, and "no" instead of a
day in remote-boards-none.json strikes a board off for good.
"""
from __future__ import annotations

import argparse
import datetime
import json
import pathlib
import re
import sys
import urllib.parse

import fetch_spain as fs
import lib

ROOT = pathlib.Path(__file__).resolve().parent.parent
KEPT = ROOT / "data" / "remote-boards.json"
NONE = ROOT / "data" / "remote-boards-none.json"
CANDIDATES = ROOT / ".cache" / "remote" / "candidates.json"

RECHECK_DAYS = 90
# A board that has shown no posting open to Spain for this long, or none
# stating pay when that is why it is here, leaves the crawl.
DROP_DAYS = 45
# Asked about when engineers alone do not reach MIN_GLOBAL: the site sums
# every role, and the API answers one job family at a time.
OTHER_ROLES = ("product-manager", "data-scientist", "product-designer", "software-engineering-manager")
AFFIXES = re.compile(r"^(try|get|join|go|use|hello)-?|-?(hq|inc|careers|jobs|ai|io|app|labs|tech|group|gmbh)$")
GENERIC = {"www", "careers", "jobs", "global", "corporate", "group", "en", "es"}


def key(entry: dict) -> str:
    return f"{entry['ats']}:{str(entry['board']).lower()}"


def flat(text: str) -> str:
    return re.sub(r"[^a-z0-9]", "", text.lower())


def board_name(board: str) -> str:
    """The employer's part of a board: some ATS's is a host name."""
    name = board.lower()
    for suffix in (".teamtailor.com", ".pinpointhq.com", ".factorial.com"):
        name = name.removesuffix(suffix)
    return name


def guesses(board: str) -> list[str]:
    name = board_name(board).split(".")[0]
    tries = [name, AFFIXES.sub("", name), name.replace("-", ""),
             re.sub(r"(labs|ai|health|security)$", r"-\1", name)]
    return [g for g in dict.fromkeys(tries) if len(g) > 1]


def owns(board: str, domain: str | None, hosts: list[str]) -> bool:
    """Whether the company Levels.fyi has at `domain` is this board's."""
    if not domain:
        return False
    domain = domain.lower().removeprefix("www.")
    if any(h == domain or h.endswith("." + domain) for h in hosts):
        return True
    name = board_name(board)
    if "." in name:
        return name == domain
    labels = [label for label in domain.split(".")[:-1] if label not in GENERIC]
    return bool(labels) and flat(labels[-1]) == flat(name)


def ask(bearer: str, slug: str, role: str, delay: float, spain: bool = False) -> dict | None:
    """Levels.fyi's count for a slug and role anywhere, or in Spain, with the
    company's name and domain (its logo's). None when the answer could not be
    read."""
    query = urllib.parse.urlencode([
        ("companySlug", slug), ("jobFamilySlug", role),
        *([("countryIds[0]", fs.SPAIN_COUNTRY_ID)] if spain else []), ("offset", 0), ("limit", 5),
        ("sortBy", "offer_date"), ("sortOrder", "DESC")])
    body = fs.get(f"{fs.API}?{query}", delay,
                  headers=fs._api_headers(bearer, f"{fs.BASE}/companies/{slug}/salaries/{role}"))
    if body is None:
        return None
    try:
        data = json.loads(body)
        if isinstance(data, dict) and "payload" in data:
            data = fs.decrypt(data["payload"])
        rows = data["rows"]
        info = (rows[0].get("companyInfo") or {}) if rows else {}
        logo = re.search(r"logo\.dev/([^?/]+)", info.get("icon") or "")
        return {"total": max(int(data.get("total") or 0), len(rows)), "name": info.get("name"),
                "slug": info.get("slug") or slug, "domain": logo.group(1).lower() if logo else None}
    except Exception:  # an unreadable answer judges nothing
        return None


def in_spain(bearer: str, slug: str, delay: float) -> bool | None:
    """Whether Levels.fyi has a submission in Spain for the company, in the
    roles the count is made over. None when an answer could not be read."""
    for role in ("software-engineer", *OTHER_ROLES):
        found = ask(bearer, slug, role, delay, spain=True)
        if found is None:
            return None
        if found["total"]:
            return True
    return False


def on_levels(bearer: str, candidate: dict, delay: float) -> dict | None:
    """The Levels.fyi company behind a board with MIN_GLOBAL submissions, one
    of them in Spain, {} when there is none, None when Levels.fyi could not
    be read."""
    unread = False
    for slug in guesses(candidate["board"]):
        found = ask(bearer, slug, "software-engineer", delay)
        if found is None:
            unread = True
            continue
        if not found["total"] or not owns(candidate["board"], found["domain"], candidate.get("hosts", [])):
            continue
        total = found["total"]
        for role in OTHER_ROLES:
            if total >= lib.MIN_GLOBAL:
                break
            more = ask(bearer, found["slug"], role, delay)
            if more is None:
                unread = True
                break
            total += more["total"]
        if total >= lib.MIN_GLOBAL:
            here = in_spain(bearer, found["slug"], delay)
            if here:
                return found
            unread = unread or here is None
    return None if unread else {}


def pretty(board: str) -> str:
    return " ".join(w.capitalize() for w in re.split(r"[-_.]+", board_name(board).split(".")[0]) if w)


def decide(candidates: dict, kept: dict, none: dict, today: str, lookup) -> dict:
    """Update `kept` and `none` in place from one run's candidates. `lookup`
    answers on_levels() for a candidate; it may raise fs.Blocked, which leaves
    the rest of the candidates as they were."""
    report = {"seen": 0, "added": [], "dropped": [], "unread": 0, "blocked": False}
    day = lib.parse_date(today)
    for candidate in candidates.get("boards", []):
        k = key(candidate)
        if k in kept:
            # A board kept for its pay is seen while it still states it.
            if kept[k].get("via") != "pay" or candidate.get("paid"):
                kept[k]["seen"] = today
                report["seen"] += 1
            continue
        if none.get(k) == "no":
            continue
        checked = lib.parse_date(none.get(k))
        recent = bool(checked and (day - checked).days < RECHECK_DAYS)
        # Stated pay is enough: Levels.fyi is asked only about the rest.
        ask_levels = not recent and not candidate.get("paid")
        found = None if ask_levels else {}
        if ask_levels and not report["blocked"]:
            try:
                found = lookup(candidate)
            except fs.Blocked:
                report["blocked"] = True
                found = None
        if found:
            kept[k] = {"name": found["name"] or pretty(candidate["board"]), "ats": candidate["ats"],
                       "board": candidate["board"], "levels": found["slug"], "via": "levels", "seen": today}
        elif candidate.get("paid"):
            kept[k] = {"name": pretty(candidate["board"]), "ats": candidate["ats"],
                       "board": candidate["board"], "via": "pay", "seen": today}
        elif found is None:
            report["unread"] += 1
            continue
        else:
            if not recent:
                none[k] = today
            continue
        none.pop(k, None)
        report["added"].append(kept[k]["name"])
    incomplete = set(candidates.get("incomplete", []))
    for k, entry in list(kept.items()):
        seen = lib.parse_date(entry.get("seen"))
        if (entry.get("via") != "hand" and entry["ats"] not in incomplete
                and seen and (day - seen).days > DROP_DAYS):
            report["dropped"].append(entry["name"])
            del kept[k]
    return report


def load(path: pathlib.Path) -> dict:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except OSError:
        return {}


def dump(path: pathlib.Path, value: dict) -> None:
    lines = [f"  {json.dumps(k)}: {json.dumps(v, ensure_ascii=False)}" for k, v in sorted(value.items())]
    path.write_text("{\n" + ",\n".join(lines) + "\n}\n", encoding="utf-8")


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument("--candidates", type=pathlib.Path, default=CANDIDATES)
    parser.add_argument("--delay", type=float, default=3.0)
    args = parser.parse_args(argv)
    candidates = json.loads(args.candidates.read_text(encoding="utf-8"))
    kept, none = load(KEPT), load(NONE)
    today = datetime.date.today().isoformat()
    bearer = fs.token()
    if not bearer:
        print("No Levels.fyi login: only boards stating pay can be added.")

    def lookup(candidate: dict):
        return on_levels(bearer, candidate, args.delay) if bearer else None

    report = decide(candidates, kept, none, today, lookup)
    dump(KEPT, kept)
    dump(NONE, none)
    print(f"{len(kept)} remote boards on file: {report['seen']} seen again, "
          f"{len(report['added'])} added, {len(report['dropped'])} dropped, "
          f"{report['unread']} not judged.")
    for label in ("added", "dropped"):
        if report[label]:
            print(f"  {label}: {', '.join(sorted(report[label]))}")
    if report["blocked"]:
        print("Levels.fyi refused the run; the rest wait for the next one.")
        return fs.EXIT_BLOCKED
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
