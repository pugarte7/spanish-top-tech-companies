#!/usr/bin/env python3
"""scripts/about.py: the agent's sentences are checked before anything is stored.

    python3 tests/test_about.py
"""
from __future__ import annotations

import copy
import datetime as dt
import json
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts"))

import about  # noqa: E402

failures: list[str] = []


def check(name: str, ok: bool, detail=None) -> None:
    print(("ok   " if ok else "FAIL ") + name)
    if not ok:
        failures.append(name)
        if detail is not None:
            print("     ", detail)


brief = (ROOT / "instinct" / "about" / "brief.md").read_text(encoding="utf-8")
blocks = re.findall(r"```json\n(.*?)```", brief, re.S)
asked = {c["slug"]: c for c in json.loads(blocks[0])["companies"]}
example = json.loads(blocks[1])

good, none, bad = about.sort_answer(example, asked)
check("the brief's example answer is stored whole", not bad and set(good) == {"acme"}
      and set(none) == {"initech"}, (good, none, bad))


def broken(change) -> list[str]:
    answer = copy.deepcopy(example)
    change(answer["companies"][0])
    return about.sort_answer(answer, asked)[2]


def set_about(lang: str, text: str):
    return lambda item: item["about"].__setitem__(lang, text)


check("a sentence over 140 characters is refused", broken(set_about("es", "Plataforma " + "x" * 140)))
check("two lines are refused", broken(set_about("en", "Delivery platform.\nFor consumers too.")))
check("two sentences are refused", broken(set_about("en", "Delivery platform. It serves consumers.")))
check("an abbreviation is not a second sentence",
      not broken(set_about("es", "Software de nóminas y RR. HH. para pymes y autónomos.")))
check("praise is refused", broken(set_about("en", "Leading delivery platform for food and groceries.")))
check("the company's name first is refused", broken(set_about("es", "Acme es una plataforma de reparto.")))
check("a sentence with no source is refused", broken(lambda item: item.__setitem__("source_url", None)))
check("a company the issue did not ask about is refused",
      broken(lambda item: item.__setitem__("slug", "other")))
check("null with no notes is refused",
      broken(lambda item: item.update({"about": None, "notes": None})))
check("an extra field is refused", broken(lambda item: item.__setitem__("ceo", "Jane Doe")))

mixed = copy.deepcopy(example)
mixed["companies"][0]["about"]["en"] = "World-class delivery platform for food."
good, none, bad = about.sort_answer(mixed, asked)
check("one bad item does not lose the others", not good and set(none) == {"initech"} and bad)

today = dt.date(2026, 11, 22)
data = {"companies": [{"name": "Acme", "levels": "acme", "n": 2, "web": "https://acme.com"},
                      {"name": "Big", "levels": "big", "n": 40},
                      {"name": "Done", "levels": "done", "n": 9},
                      {"name": "Lost", "levels": "lost", "n": 9},
                      {"name": "Old", "levels": "old", "n": 1}]}
book = {"companies": {"done": {"es": "x", "en": "y"}},
        "none": {"lost": "2026-11-01", "old": "2026-01-01"}}
check("companies without a sentence are asked, most salaries first, and a recent blank is not",
      [c["slug"] for c in about.wanted(data, book, today)] == ["big", "acme", "old"])
check("the issue's body reads back", set(about.asked_in({"body": about.issue_body(
      about.wanted(data, book, today))})) == {"big", "acme", "old"})

print()
print("FAILED: " + ", ".join(failures) if failures else "all passed")
sys.exit(1 if failures else 0)
