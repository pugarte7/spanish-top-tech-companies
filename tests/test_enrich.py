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
asked_block, example_block = json.loads(blocks[0]), json.loads(blocks[1])
schema = json.loads(enrich.SCHEMA.read_text(encoding="utf-8"))
# One company of the brief's example: what was asked about it and its item.
asked = {c["slug"]: c for c in asked_block["companies"]}
example = example_block["companies"][0]

check("the brief's example answer follows schema.json", enrich.schema_errors(example_block, schema) == []
      and enrich.sort_answer(example_block, asked) == ([example], []), enrich.sort_answer(example_block, asked))
check("the issue's body is read back as what it asked",
      enrich.asked_in({"body": enrich.issue_body(asked_block["companies"])}) == asked)
many = [{"slug": f"c{n}", "name": f"C{n}", "website": None, "linkedin": None, "careers": None,
         "jobs": [{"id": f"c{n}-{j}", "title": "Senior Backend Engineer, Payments Platform", "location": "Madrid",
                   "url": f"https://jobs.example.com/company-{n}/postings/{j}-senior-backend-engineer"}
                  for j in range(300)]} for n in range(enrich.PER_ISSUE)]
fitted = enrich.issue_body(many)
check("fifty companies with hundreds of postings fit in one issue, each with some",
      len(fitted) <= 65536 and len(enrich.asked_in({"body": fitted})) == enrich.PER_ISSUE
      and all(0 < len(c["jobs"]) <= enrich.JOBS_MAX for c in enrich.asked_in({"body": fitted}).values()), len(fitted))


def broken(change) -> list[str]:
    answer = copy.deepcopy(example)
    change(answer)
    return enrich.item_errors(answer, asked)


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
check("one answer is not a correction; a second one is, whatever this script said in between",
      not enrich.corrects([said(enrich.ANSWERER, good), said(enrich.ANSWERER, enrich.MARK + "\nStored")])
      and enrich.corrects([said(enrich.ANSWERER, good), said(enrich.ANSWERER, enrich.MARK + "\nStored"),
                           said(enrich.ANSWERER, good)])
      and not enrich.corrects([said("someone-else", good), said(enrich.ANSWERER, good)]))
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

check("a block left open at the end is read", enrich.json_block("```json\n{\"a\": 1}\n") == {"a": 1})

saved_gh = enrich.gh
enrich.gh = lambda *args, **kw: json.dumps([{"number": n} for n in range(enrich.OPEN_MAX - 3)])
check("there is room for issues only up to OPEN_MAX open ones", enrich.room() == 3)
enrich.gh = lambda *args, **kw: json.dumps([{"number": n} for n in range(enrich.OPEN_MAX + 40)])
check("with more open than that there is room for none", enrich.room() == 0)
enrich.gh = saved_gh

# --- collect, with the private repo and the files replaced -------------------------
import tempfile  # noqa: E402

BODY = enrich.issue_body(asked_block["companies"] + [{"slug": "beta", "name": "Beta", "website": None,
                                                      "linkedin": None, "careers": None, "jobs": []}])
beta = {**copy.deepcopy(example), "slug": "beta", "contacts": []}
beta["size"] = {**beta["size"], "employees": 40}


def fenced(*items) -> str:
    return "```json\n" + json.dumps({"companies": list(items)}) + "\n```"


def run_collect(comments, sizes=None, contacts=None, closed=False):
    """collect() over one issue: (sizes, contacts, issues to close, notes left)."""
    notes = []
    with tempfile.TemporaryDirectory() as tmp:
        tmp = pathlib.Path(tmp)
        (tmp / "sizes.json").write_text(json.dumps(sizes or {"companies": {}}))
        (tmp / "contacts.json").write_text(json.dumps(contacts or {"as_of": None, "companies": {}, "checked": {}}))
        names = ("SIZES", "CONTACTS", "issues", "closed_lately", "comments_of", "note", "published_at")
        saved = {n: getattr(enrich, n) for n in names}
        issue = [{"number": 9, "title": "t", "body": BODY}]
        enrich.SIZES, enrich.CONTACTS = tmp / "sizes.json", tmp / "contacts.json"
        enrich.issues = lambda label: [] if closed else issue
        enrich.closed_lately = lambda label: issue if closed else []
        enrich.comments_of = lambda number: comments
        enrich.note = lambda number, text, label=None: notes.append((text, label))
        enrich.published_at = lambda url, email: True
        try:
            enrich.collect(False, str(tmp / "closing.json"))
        finally:
            for n, v in saved.items():
                setattr(enrich, n, v)
        return (json.loads((tmp / "sizes.json").read_text())["companies"],
                json.loads((tmp / "contacts.json").read_text()),
                json.loads((tmp / "closing.json").read_text()), notes)


sizes, contacts, closing, notes = run_collect([said(me, fenced(example, beta))])
check("a whole answer stores every company and closes the issue",
      set(sizes) == {"acme", "beta"} and len(contacts["companies"]["acme"]) == 1
      and "beta" not in contacts["companies"] and set(contacts["checked"]) == {"acme", "beta"}
      and [c["number"] for c in closing] == [9] and not notes, (sizes, closing, notes))

sizes, contacts, closing, notes = run_collect([said(me, fenced(example))])
check("half an answer is stored, and the issue stays open naming who is missing",
      set(sizes) == {"acme"} and not closing and "beta: no answer" in notes[0][0] and notes[0][1] == "needs-human",
      (sizes, notes))

bad = copy.deepcopy(example)
bad["contacts"][1]["jobs"] = ["other-1"]
sizes, contacts, closing, notes = run_collect([said(me, fenced(bad, beta))])
check("one company's bad item is sent back and the others are stored",
      set(sizes) == {"beta"} and not closing and "acme: $.contacts[1].jobs" in notes[0][0], (sizes, notes))

on_file = {"companies": {"acme": ["51-200", 90]}}
sizes, contacts, closing, notes = run_collect([said(me, fenced(example, beta))], on_file)
check("a first answer never overwrites a size on file", sizes["acme"] == ["51-200", 90] and len(closing) == 1, sizes)

fixed = copy.deepcopy(example)
fixed["size"]["employees"] = 90
fixed["contacts"] = []
first = said(me, fenced(example, beta))
sizes1, contacts1, _, _ = run_collect([first])
ours = said(me, enrich.MARK + "\nStored: 2 companies.")
sizes, contacts, closing, notes = run_collect([first, ours, said(me, fenced(fixed))], {"companies": sizes1}, contacts1,
                                              closed=True)
check("a new answer in a closed issue replaces the size and the contacts it names, and only those",
      sizes["acme"] == ["51-200", 90] and sizes["beta"] == sizes1["beta"] and "acme" not in contacts["companies"]
      and not closing and "Correction stored for 1" in notes[0][0] and notes[0][1] is None, (sizes, contacts, notes))

sizes, contacts, closing, notes = run_collect([first, ours], {"companies": sizes1}, contacts1, closed=True)
check("a closed issue with nothing new is left alone", sizes == sizes1 and contacts == contacts1 and not notes)

sizes, contacts, closing, notes = run_collect([first, said(me, fenced(fixed))], {"companies": sizes1}, contacts1)
check("a second answer in an open issue replaces the first", sizes["acme"] == ["51-200", 90]
      and "acme" not in contacts["companies"] and len(closing) == 1, (sizes, closing))

print(f"{len(failures)} failed" if failures else "enrich.py checks answers as expected")
sys.exit(1 if failures else 0)
