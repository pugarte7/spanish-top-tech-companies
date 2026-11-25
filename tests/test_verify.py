#!/usr/bin/env python3
"""scripts/verify.py: what the agent found is checked before the CSV is touched.

    python3 tests/test_verify.py
"""
from __future__ import annotations

import copy
import datetime as dt
import json
import pathlib
import re
import sys
import tempfile

ROOT = pathlib.Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts"))

import enrich  # noqa: E402
import lib  # noqa: E402
import verify  # noqa: E402

failures: list[str] = []


def check(name: str, ok: bool, detail=None) -> None:
    print(("ok   " if ok else "FAIL ") + name)
    if not ok:
        failures.append(name)
        if detail is not None:
            print("     ", detail)


brief = (ROOT / "instinct" / "verify" / "brief.md").read_text(encoding="utf-8")
blocks = re.findall(r"```json\n(.*?)```", brief, re.S)
asked = {c["slug"]: c for c in json.loads(blocks[0])["companies"]}
example = json.loads(blocks[1])
item = example["companies"][0]

good, none, bad = verify.sort_answer(example, asked)
check("the brief's example answer is stored", not bad and not none
      and good == {"acme": {"website": item["website"], "linkedin_url": item["linkedin"]}}, (good, none, bad))


def answer(**change) -> dict:
    return {"companies": [{**copy.deepcopy(item), **change}]}


check("nothing found, with why, is a valid answer",
      verify.sort_answer(answer(website=None, linkedin=None, evidence=None, notes="Three companies share the name."),
                         asked) == ({}, ["acme"], []))
check("nothing found and no reason is sent back",
      bool(verify.sort_answer(answer(website=None, linkedin=None, evidence=None), asked)[2]))
check("a find with no evidence is sent back", bool(verify.sort_answer(answer(evidence=None), asked)[2]))
check("a profile on another site is not the company's website",
      all(verify.sort_answer(answer(website=url), asked)[2] for url in (
          "https://www.linkedin.com/company/acme", "https://www.levels.fyi/companies/acme",
          "https://es.wikipedia.org/wiki/Acme", "https://www.crunchbase.com/organization/acme")))
check("a person's LinkedIn profile is refused",
      bool(verify.sort_answer(answer(linkedin="https://www.linkedin.com/in/jane"), asked)[2]))
check("a company the issue did not ask about is refused", bool(verify.sort_answer(answer(slug="other"), asked)[2]))

row = {"role": "software-engineer", "base": 50000, "city": "Málaga"}
companies = [
    {**lib.blank_company("Acme", levels_slug="acme"), "entries": [dict(row), dict(row)]},
    {**lib.blank_company("Known", levels_slug="known", website="https://known.com"), "entries": [dict(row)]},
    {**lib.blank_company("Old Miss", levels_slug="old-miss"), "entries": [dict(row)]},
    {**lib.blank_company("No Slug"), "entries": [dict(row)]},
]
today = dt.date(2026, 11, 25)
todo = verify.wanted(companies, {"old-miss": "2026-10-01"}, today)
check("the unverified are asked about, most salaries first, without the verified or those just missed",
      [c["slug"] for c in todo] == ["acme", "no-slug"] and todo[0]["salaries"] == 2
      and todo[0]["cities"] == ["Málaga"] and todo[0]["levels"].endswith("/acme/salaries")
      and todo[1]["levels"] is None, todo)
check("a miss older than RECHECK_DAYS is asked about again",
      "old-miss" in [c["slug"] for c in verify.wanted(companies, {"old-miss": "2026-01-01"}, today)])
check("no salary reaches the issue", "50000" not in verify.issue_body(todo))

BODY = verify.issue_body(todo)
me = enrich.ANSWERER


def said(body: str) -> dict:
    return {"author": {"login": me}, "body": body}


def run_collect(items: list[dict], on_file: list[dict]):
    """collect() over one issue: (the companies saved or None, verify.json's none, issues to close, notes)."""
    notes, saved = [], []
    with tempfile.TemporaryDirectory() as tmp:
        tmp = pathlib.Path(tmp)
        names = ("issues", "comments_of", "note")
        kept = {n: getattr(enrich, n) for n in names}
        kept_lib = (lib.load_companies, lib.save_companies, verify.NONE)
        enrich.issues = lambda label: [{"number": 7, "title": "t", "body": BODY}]
        enrich.comments_of = lambda number: [said("```json\n" + json.dumps({"companies": items}) + "\n```")]
        enrich.note = lambda number, text, label=None: notes.append((text, label))
        lib.load_companies = lambda: on_file
        lib.save_companies = lambda companies: saved.append(companies)
        verify.NONE = tmp / "verify.json"
        try:
            verify.collect(False, str(tmp / "closing.json"))
        finally:
            for n, v in kept.items():
                setattr(enrich, n, v)
            lib.load_companies, lib.save_companies, verify.NONE = kept_lib
        book = tmp / "verify.json"
        none = json.loads(book.read_text())["none"] if book.exists() else {}
        return (saved[0] if saved else None), none, json.loads((tmp / "closing.json").read_text()), notes


miss = {"slug": "no-slug", "website": None, "linkedin": None, "evidence": None, "notes": "Too common a name."}
saved, none, closing, notes = run_collect([item, miss], copy.deepcopy(companies))
check("a found company gets its website and LinkedIn page, a miss is dated, and the issue closes",
      saved[0]["website"] == item["website"] and saved[0]["linkedin_url"] == item["linkedin"]
      and lib.verified(saved[0]) and set(none) == {"no-slug"} and len(closing) == 1 and not notes,
      (saved, none, closing, notes))

saved, none, closing, notes = run_collect([item], copy.deepcopy(companies))
check("half an answer is stored and the issue stays open naming who is missing",
      saved is not None and not closing and "no-slug: no answer" in notes[0][0] and notes[0][1] == "needs-human", notes)

typed = copy.deepcopy(companies)
typed[0]["linkedin_url"] = "https://www.linkedin.com/company/acme-by-hand"
saved, none, closing, notes = run_collect([item, miss], typed)
check("a value on file is never overwritten",
      saved is None and typed[0]["linkedin_url"].endswith("acme-by-hand") and len(closing) == 1, (saved, typed[0]))

print(f"{len(failures)} failed" if failures else "verify.py checks answers as expected")
sys.exit(1 if failures else 0)
