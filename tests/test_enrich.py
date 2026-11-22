#!/usr/bin/env python3
"""scripts/enrich.py: the agent's answers are checked before anything is stored.

    python3 tests/test_enrich.py
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

import enrich  # noqa: E402

failures: list[str] = []


def check(name: str, ok: bool, detail=None) -> None:
    print(("ok   " if ok else "FAIL ") + name)
    if not ok:
        failures.append(name)
        if detail is not None:
            print("     ", detail)


blocks = re.findall(r"```json\n(.*?)```", (ROOT / "instinct" / "brief.md").read_text(encoding="utf-8"), re.S)
asked, example = json.loads(blocks[0]), json.loads(blocks[1])
schema = json.loads(enrich.SCHEMA.read_text(encoding="utf-8"))

check("the brief's example answer follows schema.json", enrich.answer_errors(example, asked) == [],
      enrich.answer_errors(example, asked))


def broken(change) -> list[str]:
    answer = copy.deepcopy(example)
    change(answer)
    return enrich.answer_errors(answer, asked)


check("a manager tied to no posting is refused",
      any("jobs" in e for e in broken(lambda a: a["contacts"][1].update(jobs=[]))))
check("an email without the sentence it was published in is refused",
      bool(broken(lambda a: a["contacts"][1].update(email="john@acme.com"))))
check("a contact with neither email nor profile is refused",
      bool(broken(lambda a: a["contacts"][0].update(email=None, evidence_quote=None, linkedin=None))))
check("a field the schema does not know is refused",
      any("unexpected phone" in e for e in broken(lambda a: a["contacts"][0].update(phone="+34 600"))))
check("a job id the issue did not list is refused",
      any("not in the issue" in e for e in broken(lambda a: a["contacts"][1].update(jobs=["other-1"]))))
check("an answer about another company is refused",
      any("slug" in e for e in broken(lambda a: a.update(slug="other"))))
check("more than five contacts are refused",
      any("more than 5" in e for e in broken(lambda a: a.update(contacts=a["contacts"] * 3))))
check("a profile that is not a LinkedIn person is refused",
      bool(broken(lambda a: a["contacts"][1].update(linkedin="https://www.linkedin.com/company/acme"))))

check("a figure is bucketed", enrich.size_entry({"employees": 1234, "range": None, "scope": "group"}) == ["1001-5000", 1234])
check("a LinkedIn band is bucketed by its top",
      enrich.size_entry({"employees": None, "range": "51-200", "scope": "company"}) == ["51-200", None])
check("an open band goes above its floor",
      enrich.size_entry({"employees": None, "range": "10001+", "scope": "company"}) == ["5001+", None])
check("a branch gets no bucket", enrich.size_entry({"employees": 300, "range": None, "scope": "branch"}) == [None, 300, 1])
check("no figure, no size", enrich.size_entry({"employees": None, "range": None, "scope": None}) is None)

old = [{"email": "ana@acme.com", "linkedin": None}]
new = [{"email": "ANA@acme.com", "linkedin": "https://www.linkedin.com/in/ana"},
       {"email": None, "linkedin": "https://www.linkedin.com/in/bo/"}]
merged = enrich.merge_contacts(old, new)
check("a contact on file stays and is not added twice", merged[0] is old[0] and len(merged) == 2, merged)

stored = enrich.stored_contact(example["contacts"][1])
check("the stored contact holds the fields api/mcp.js reads, not the quote",
      set(stored) == {"kind", "name", "role", "email", "linkedin", "jobs", "scope", "published", "source"}, stored)

data = {"companies": [{"name": "Acme", "levels": "acme", "url": "https://acme.com", "linkedin": None},
                      {"name": "Beta", "levels": "beta", "url": "https://beta.com", "linkedin": None},
                      {"name": "Gamma", "levels": "gamma", "url": "https://gamma.com", "linkedin": None}]}
jobs = [{"id": "g-1", "slug": "gamma", "title": "Engineer", "location": "Madrid", "url": "https://gamma.com/1"}]
today = dt.date(2026, 11, 20)
todo = enrich.wanted(data, jobs, {"companies": {"acme": ["51-200", 90]}},
                     {"companies": {}, "checked": {"acme": "2026-10-01"}}, today)
check("a company with a size and a recent check is not asked; one with postings is asked first",
      [t["slug"] for t in todo] == ["gamma", "beta"] and todo[0]["jobs"][0]["id"] == "g-1", todo)
stale = enrich.wanted(data, [], {"companies": {"acme": ["51-200", 90]}},
                      {"companies": {}, "checked": {"acme": "2026-01-01"}}, today)
check("a check older than RECHECK_DAYS is asked again", "acme" in [t["slug"] for t in stale])

check("the last JSON block of a comment is read", enrich.json_block("x\n```json\n{\"a\": 1}\n```\n```json\n{\"a\": 2}\n```") == {"a": 2})

def said(login: str, body: str) -> dict:
    return {"author": {"login": login}, "body": body}


good = "Here:\n```json\n" + json.dumps(example) + "\n```"
me, other = enrich.ANSWERER, "someone-else"
check("no answer yet leaves the issue pending", enrich.reply([said(other, "hi"), said(me, "looking")]) == ("pending", None))
check("the answerer's last JSON is read", enrich.reply([said(me, good)]) == ("answer", example))
check("another account's JSON is ignored and does not hide the answer",
      enrich.reply([said(me, good), said(other, good.replace("acme", "evil"))]) == ("answer", example))
check("a comment without JSON after the answer does not hide it",
      enrich.reply([said(me, good), said(me, "thanks")]) == ("answer", example))
check("NEEDS_HUMAN is read as such", enrich.reply([said(me, "NEEDS_HUMAN: two companies share the name")])
      == ("needs-human", None))
check("an answer this script already replied to is handled",
      enrich.reply([said(me, good), said(me, enrich.MARK + "\nNot stored")]) == ("handled", None))
check("a new answer after a rejection is read again",
      enrich.reply([said(me, enrich.MARK + "\nNot stored"), said(me, good)]) == ("answer", example))
check("a JSON block that does not parse is an answer to send back",
      enrich.reply([said(me, "```json\n{oops\n```")]) == ("answer", None))

print(f"{len(failures)} failed" if failures else "enrich.py checks answers as expected")
sys.exit(1 if failures else 0)
