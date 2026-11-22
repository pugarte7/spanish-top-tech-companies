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
check("a word that is also the name may open the sentence",
      not broken(set_about("en", "Acme-style delivery platform for food and groceries.")))
check("the name with a comma first is refused", broken(set_about("en", "Acme, a delivery platform for food.")))
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



# --- collect, against issues that never leave this file --------------------------

import tempfile  # noqa: E402

import enrich  # noqa: E402

ME, BOT = {"login": enrich.ANSWERER}, {"login": "someone-else"}
fenced = lambda value: "```json\n" + json.dumps(value, ensure_ascii=False) + "\n```"
body = about.issue_body(list(asked.values()))
half = {"companies": [example["companies"][0]]}
praise = copy.deepcopy(example)
praise["companies"][0]["about"]["en"] = "Leading delivery platform for food and groceries."


def run_collect(comments: list[dict], on_file: dict | None = None):
    """collect() over one issue with these comments: (file written, issues to close, notes left)."""
    notes: list[tuple] = []
    with tempfile.TemporaryDirectory() as tmp:
        path, closing = pathlib.Path(tmp) / "about.json", pathlib.Path(tmp) / "closing.json"
        if on_file:
            path.write_text(json.dumps(on_file), encoding="utf-8")
        saved = about.ABOUT, enrich.issues, enrich.gh, enrich.note
        about.ABOUT = path
        enrich.issues = lambda label: [{"number": 7, "title": "t", "body": body}]
        enrich.gh = lambda *args, **kw: json.dumps({"comments": comments})
        enrich.note = lambda number, text, label=None: notes.append((number, text, label))
        try:
            about.collect(False, str(closing))
        finally:
            about.ABOUT, enrich.issues, enrich.gh, enrich.note = saved
        book = json.loads(path.read_text(encoding="utf-8")) if path.exists() else None
        return book, json.loads(closing.read_text(encoding="utf-8")), notes


book, closing, notes = run_collect([{"author": ME, "body": "Here it is.\n\n" + fenced(example)}])
check("a whole answer is stored and its issue closed",
      book and set(book["companies"]) == {"acme"} and set(book["none"]) == {"initech"}
      and [c["number"] for c in closing] == [7] and not notes, (book, closing, notes))

book, closing, notes = run_collect([])
check("no answer yet: nothing written, nothing closed, nothing said", book is None and not closing and not notes)

book, closing, notes = run_collect([{"author": BOT, "body": fenced(example)}])
check("another account's answer is ignored", book is None and not closing and not notes)

book, closing, notes = run_collect([{"author": ME, "body": fenced(half)}])
check("half an answer is stored, and the issue stays open naming what is missing",
      book and set(book["companies"]) == {"acme"} and not closing
      and notes and "initech: no answer" in notes[0][1] and notes[0][2] == "needs-human", (book, notes))

book, closing, notes = run_collect([{"author": ME, "body": fenced(praise)}])
check("a refused sentence is sent back and the rest stored",
      book and not book["companies"] and set(book["none"]) == {"initech"} and not closing
      and "acme: en: 'leading'" in notes[0][1], (book, notes))

book, closing, notes = run_collect([{"author": ME, "body": "```json\n{not json\n```"}])
check("a block that does not parse is sent back", book is None and not closing and "does not parse" in notes[0][1])

book, closing, notes = run_collect([{"author": ME, "body": fenced(praise)},
                                    {"author": ME, "body": enrich.MARK + "\nNot stored"}])
check("an answer already sent back is not read twice", book is None and not closing and not notes)

book, closing, notes = run_collect([{"author": ME, "body": fenced(praise)},
                                    {"author": ME, "body": enrich.MARK + "\nNot stored"},
                                    {"author": ME, "body": fenced(example)}])
check("a corrected answer below it is read", book and set(book["companies"]) == {"acme"} and len(closing) == 1)

book, closing, notes = run_collect([{"author": ME, "body": "NEEDS_HUMAN the list is ambiguous"}])
check("NEEDS_HUMAN is left for a human", book is None and not closing and notes[0][2] == "needs-human")

mine = {"companies": {"acme": {"es": "A mano.", "en": "By hand."}}, "none": {}}
book, closing, notes = run_collect([{"author": ME, "body": fenced(example)}], mine)
check("a sentence on file is never overwritten", book["companies"]["acme"]["en"] == "By hand."
      and set(book["none"]) == {"initech"} and len(closing) == 1, book)

print()
print("FAILED: " + ", ".join(failures) if failures else "all passed")
sys.exit(1 if failures else 0)
