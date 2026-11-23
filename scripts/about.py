#!/usr/bin/env python3
"""What each company does, in one sentence, from an outside agent through issues.

    python3 scripts/about.py open [--limit N] [--dry-run]
    python3 scripts/about.py collect [--dry-run] [--closing FILE]
    python3 scripts/about.py close FILE
    python3 scripts/about.py check ANSWER.json

The contract with the agent is instinct/about/: brief.md (what it is told) and
schema.json (what it answers). `open` files issues labelled `about` in the
private repo, where the agent already answers (scripts/enrich.py), each asking
about PER_ISSUE companies of data.json that have no sentence in
data/about.json. `collect` reads every open `about` issue for the last answer
by enrich.ANSWERER and stores each company's sentence that passes; the rest go
back in a comment with `needs-human`, and the issue stays open until every
company it asked about is on file. `close` closes the finished ones once
about.yml has pushed the file.

A first answer never overwrites a sentence on file, so one corrected by hand
stays. A later answer in the same issue is the agent correcting itself and
replaces what the earlier one left; `collect` reads the issues closed in the
last enrich.CORRECTION_DAYS for one. A company the agent could not place is
noted under `none` with the date and asked again after RECHECK_DAYS.

Nothing here is private, but the log still shows counts only.
"""
from __future__ import annotations

import datetime as dt
import json
import pathlib
import re
import sys

import enrich
import lib

INSTINCT = lib.ROOT / "instinct" / "about"
SCHEMA = INSTINCT / "schema.json"
BRIEF = "https://github.com/pugarte7/spanish-top-tech-companies/blob/main/instinct/about/brief.md"
ABOUT = lib.ROOT / "data" / "about.json"
LABEL = "about"
PER_ISSUE = enrich.PER_ISSUE
LIMIT = 10           # issues opened in one run
RECHECK_DAYS = 180
# A full stop after a word, then a capital: "RR. HH." and "S.A." are not that.
SECOND_SENTENCE = re.compile(r"[a-záéíóúñ]{3}[.!?] [A-ZÁÉÍÓÚÑ]")
# "Acme is a...", "Acme, la plataforma...": the name as the subject. A sentence
# may still open with a word that is also a name ("Remote work platform").
NAME_THEN = r"(,| (es|son|is|are|ofrece|offers|provides|desarrolla|develops|fabrica|makes|builds|vende|sells)\b)"
# Words that sell instead of describing; the brief forbids them.
PRAISE = ("leading", "innovative", "world-class", "cutting-edge", "best-in-class", "revolutionary",
          "líder", "innovador", "puntera", "pionera", "pionero", "revolucionari")


def read_about() -> dict:
    book = enrich.read_json(ABOUT, {})
    return {"as_of": book.get("as_of"), "companies": book.get("companies", {}),
            "none": book.get("none", {})}


def item_errors(item: dict, asked: dict[str, dict]) -> list[str]:
    """What is wrong with one company's item, beyond schema.json."""
    slug = item["slug"]
    if slug not in asked:
        return ["the issue did not ask about it"]
    about = item["about"]
    if about is None:
        return [] if item["notes"] else ["about is null with no notes saying why"]
    errors = []
    if not item["source_url"]:
        errors.append("no source_url")
    for lang, text in about.items():
        low = text.lower()
        if re.match(re.escape(asked[slug]["name"].lower()) + NAME_THEN, low):
            errors.append(f"{lang}: starts with the company's name")
        errors += [f"{lang}: '{word}'" for word in PRAISE if word in low]
        if SECOND_SENTENCE.search(text):
            errors.append(f"{lang}: more than one sentence")
    return errors


def sort_answer(answer, asked: dict[str, dict]) -> tuple[dict, dict, list[str]]:
    """(sentences to store, slugs with none, what is wrong) of one answer."""
    errors = enrich.schema_errors(answer, json.loads(SCHEMA.read_text(encoding="utf-8")))
    if errors:
        return {}, {}, errors
    good, none, bad = {}, {}, []
    for item in answer["companies"]:
        wrong = item_errors(item, asked)
        if wrong:
            bad += [f"{item['slug']}: {w}" for w in wrong]
        elif item["about"] is None:
            none[item["slug"]] = item["notes"]
        else:
            good[item["slug"]] = {"es": item["about"]["es"], "en": item["about"]["en"]}
    return good, none, bad


def wanted(data: dict, book: dict, today: dt.date) -> list[dict]:
    """The companies with no sentence, those with most salaries first."""
    out = []
    for company in sorted(data["companies"], key=lambda c: (-c.get("n", 0), c["name"])):
        slug = company.get("levels")
        when = book["none"].get(slug)
        fresh = when and (today - dt.date.fromisoformat(when)).days < RECHECK_DAYS
        if slug and slug not in book["companies"] and not fresh:
            out.append({"slug": slug, "name": company["name"], "website": company.get("web") or None,
                        "linkedin": company.get("linkedin") or None})
    return out


def issue_body(companies: list[dict]) -> str:
    asked = json.dumps({"companies": companies}, ensure_ascii=False, indent=2)
    return (f"Instructions: {BRIEF}\n\nAnswer with one comment by {enrich.ANSWERER} holding one JSON "
            f"block that follows instinct/about/schema.json, with one item per company below. To correct "
            f"an answer, comment again with the items to replace.\n\n"
            f"```json\n{asked}\n```\n")


def asked_in(issue: dict) -> dict[str, dict]:
    block = enrich.json_block(issue["body"])
    companies = block.get("companies", []) if isinstance(block, dict) else []
    return {c["slug"]: c for c in companies if isinstance(c, dict) and c.get("slug")}


def open_issues(limit: int, dry: bool) -> int:
    data = json.loads((lib.ROOT / "data" / "data.json").read_text(encoding="utf-8"))
    # The employers known only by their board are asked about too, last.
    data = {"companies": [*data["companies"], *lib.unlisted_employers(data)]}
    todo = wanted(data, read_about(), dt.date.today())
    asked: set[str] = set()
    if not dry:
        enrich.gh("label", "create", LABEL, "-R", enrich.PRIVATE_REPO, "--color", "1d76db", "--force")
        enrich.gh("label", "create", "needs-human", "-R", enrich.PRIVATE_REPO,
                  "--color", enrich.LABELS["needs-human"], "--force")
        for issue in enrich.issues(LABEL):
            asked |= set(asked_in(issue))
    todo = [c for c in todo if c["slug"] not in asked]
    if not dry:
        limit = min(limit, enrich.room())
    opened = 0
    for start in range(0, len(todo), PER_ISSUE):
        if opened >= limit:
            break
        batch = todo[start:start + PER_ISSUE]
        if not dry:
            enrich.gh("issue", "create", "-R", enrich.PRIVATE_REPO, "--title",
                      f"What {len(batch)} companies do ({batch[0]['slug']} to {batch[-1]['slug']})",
                      "--label", LABEL, "--body-file", "-", input=issue_body(batch))
        opened += 1
    print(f"{len(todo)} companies without a sentence, {len(asked)} already asked, {opened} issues opened")
    return 0


def collect(dry: bool, closing: str | None) -> int:
    book = read_about()
    today = dt.date.today().isoformat()
    stored = unplaced = rejected = pending = 0
    to_close = []
    def store(good: dict, none: dict, replace: bool) -> None:
        nonlocal stored, unplaced
        for slug, sentence in good.items():
            if replace or slug not in book["companies"]:
                stored += book["companies"].get(slug) != sentence
                book["companies"][slug] = sentence
                book["none"].pop(slug, None)
        for slug in none:
            if replace or slug not in book["companies"]:
                unplaced += slug not in book["none"]
                book["companies"].pop(slug, None)
                book["none"][slug] = today

    for issue in enrich.issues(LABEL):
        asked = asked_in(issue)
        comments = enrich.comments_of(issue["number"])
        state, answer = enrich.reply(comments)
        if state in ("pending", "handled"):
            pending += state == "pending"
            continue
        if state == "needs-human":
            if not dry:
                enrich.note(issue["number"], "Left for a human.", "needs-human")
            continue
        good, none, bad = ({}, {}, ["the JSON block does not parse"]) if answer is None \
            else sort_answer(answer, asked)
        store(good, none, enrich.corrects(comments))
        missing = [s for s in asked if s not in book["companies"] and s not in book["none"]]
        if bad or missing:
            rejected += 1
            lines = [f"- {e}" for e in bad[:40]] + [f"- {s}: no answer" for s in missing[:40]]
            if not dry:
                enrich.note(issue["number"], f"{len(good)} stored. Not stored:\n\n" + "\n".join(lines),
                            "needs-human")
        else:
            to_close.append({"number": issue["number"],
                             "text": f"Stored: {len(good)} sentences, {len(none)} companies not placed."})
    # A new answer in an issue already stored and closed is a correction.
    for issue in enrich.closed_lately(LABEL):
        state, answer = enrich.reply(enrich.comments_of(issue["number"]))
        if state != "answer":
            continue
        good, none, bad = ({}, {}, ["the JSON block does not parse"]) if answer is None \
            else sort_answer(answer, asked_in(issue))
        store(good, none, True)
        if not dry:
            enrich.note(issue["number"], f"Correction stored for {len(good) + len(none)} companies."
                        + ("\n\nNot stored:\n\n" + "\n".join(f"- {e}" for e in bad[:40]) if bad else ""))

    if (stored or unplaced) and not dry:
        enrich.write_json(ABOUT, {
            "as_of": today,
            "note": "What each company does, in one sentence, written by an outside agent from the "
                    "company's own site and other public pages (instinct/about).",
            "companies": dict(sorted(book["companies"].items())),
            "none": dict(sorted(book["none"].items()))}, 0)
    if closing and not dry:
        enrich.write_json(pathlib.Path(closing), to_close, 0)
    print(f"{stored} sentences stored, {unplaced} companies not placed, {rejected} answers sent back, "
          f"{pending} issues not answered yet")
    return 0


def main(argv: list[str]) -> int:
    if len(argv) >= 2 and argv[0] == "check":
        answer = json.loads(open(argv[1], encoding="utf-8").read())
        errors = enrich.schema_errors(answer, json.loads(SCHEMA.read_text(encoding="utf-8")))
        print("\n".join(errors) or "valid")
        return 1 if errors else 0
    dry = "--dry-run" in argv
    if argv[:1] == ["open"]:
        return open_issues(int(argv[argv.index("--limit") + 1]) if "--limit" in argv else LIMIT, dry)
    if argv[:1] == ["collect"]:
        return collect(dry, argv[argv.index("--closing") + 1] if "--closing" in argv else None)
    if len(argv) >= 2 and argv[0] == "close":
        return enrich.close(argv[1])
    print(__doc__, file=sys.stderr)
    return 2


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
