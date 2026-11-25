#!/usr/bin/env python3
"""The website and LinkedIn page of unverified companies, from an outside agent.

    python3 scripts/verify.py open [--limit N] [--dry-run]
    python3 scripts/verify.py collect [--dry-run] [--closing FILE]
    python3 scripts/verify.py close FILE
    python3 scripts/verify.py check ANSWER.json

A company with neither a LinkedIn page nor a website is unverified
(lib.verified()) and nothing of it is published; scripts/review.py lists them
for the maintainer. This asks the agent that already answers in the private
repo (scripts/enrich.py) to find them. The contract is instinct/verify/:
brief.md and schema.json. `open` files issues labelled `verify` there with
the unverified companies of the CSV; `collect` reads the answers and types
the website and the LinkedIn page into the CSV, in the fields that are empty
only: a value on file is never overwritten. `close` closes the stored issues
once verify.yml has pushed the CSV.

A company the agent could not find is noted in data/verify.json with the
date and asked again after RECHECK_DAYS. The company shows on the site from
the next refresh. The log shows counts only.
"""
from __future__ import annotations

import collections
import datetime as dt
import json
import pathlib
import re
import sys
import urllib.parse

import enrich
import lib
import review

INSTINCT = lib.ROOT / "instinct" / "verify"
SCHEMA = INSTINCT / "schema.json"
BRIEF = "https://github.com/pugarte7/spanish-top-tech-companies/blob/main/instinct/verify/brief.md"
NONE = lib.ROOT / "data" / "verify.json"
LABEL = "verify"
PER_ISSUE = enrich.PER_ISSUE
LIMIT = 2            # issues opened in one run
RECHECK_DAYS = 180
# Hosts that are someone else's page about the company, not its own site.
NOT_ITS_OWN = re.compile(r"(^|\.)(linkedin|levels|glassdoor|indeed|infojobs|crunchbase|facebook|x|twitter|"
                         r"instagram|wikipedia|github|google|einforma|empresite|axesor|infoempresa)\.[a-z.]+$")


def key(company: dict) -> str:
    return company.get("levels_slug") or lib.slugify(company["company"])


def read_none() -> dict:
    return enrich.read_json(NONE, {}).get("none", {})


def wanted(companies: list[dict], none: dict, today: dt.date) -> list[dict]:
    """The unverified companies not asked about lately, most salaries first."""
    out = []
    for company in review.unverified(companies):
        when = none.get(key(company))
        if when and (today - dt.date.fromisoformat(when)).days < RECHECK_DAYS:
            continue
        entries = company["entries"]
        top = lambda column: [v for v, _ in collections.Counter(
            e.get(column) for e in entries if e.get(column)).most_common(3)]
        slug = company.get("levels_slug")
        out.append({"slug": key(company), "name": company["company"],
                    "levels": f"https://www.levels.fyi/companies/{slug}/salaries" if slug else None,
                    "roles": top("role"), "cities": top("city"), "salaries": len(entries)})
    return out


def item_errors(item: dict, asked: dict[str, dict]) -> list[str]:
    """What is wrong with one company's item, beyond schema.json."""
    if item["slug"] not in asked:
        return ["the issue did not ask about it"]
    errors = []
    if (item["website"] or item["linkedin"]) and not item["evidence"]:
        errors.append("a website or LinkedIn page with no evidence")
    if not (item["website"] or item["linkedin"] or item["notes"]):
        errors.append("nothing found and no notes saying why")
    host = (urllib.parse.urlparse(item["website"] or "").hostname or "").lower()
    if item["website"] and (not host or NOT_ITS_OWN.search(host)):
        errors.append("website is not the company's own site")
    return errors


def sort_answer(answer, asked: dict[str, dict]) -> tuple[dict, list[str], list[str]]:
    """(slug to the fields found, slugs with nothing found, what is wrong) of one answer."""
    errors = enrich.schema_errors(answer, json.loads(SCHEMA.read_text(encoding="utf-8")))
    if errors:
        return {}, [], errors
    good, none, bad = {}, [], []
    for item in answer["companies"]:
        wrong = item_errors(item, asked)
        if wrong:
            bad += [f"{item['slug']}: {w}" for w in wrong]
        elif item["website"] or item["linkedin"]:
            good[item["slug"]] = {"website": item["website"], "linkedin_url": item["linkedin"]}
        else:
            none.append(item["slug"])
    return good, none, bad


def issue_body(companies: list[dict]) -> str:
    asked = json.dumps({"companies": companies}, ensure_ascii=False, indent=2)
    return (f"Instructions: {BRIEF}\n\nAnswer with one comment by {enrich.ANSWERER} holding one JSON "
            f"block that follows instinct/verify/schema.json, with one item per company below. To correct "
            f"an answer, comment again with the items to replace.\n\n"
            f"```json\n{asked}\n```\n")


def asked_in(issue: dict) -> dict[str, dict]:
    block = enrich.json_block(issue["body"])
    companies = block.get("companies", []) if isinstance(block, dict) else []
    return {c["slug"]: c for c in companies if isinstance(c, dict) and c.get("slug")}


def open_issues(limit: int, dry: bool) -> int:
    todo = wanted(lib.load_companies(), read_none(), dt.date.today())
    asked: set[str] = set()
    if not dry:
        enrich.gh("label", "create", LABEL, "-R", enrich.PRIVATE_REPO, "--color", "5319e7", "--force")
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
                      f"Find {len(batch)} companies ({batch[0]['slug']} to {batch[-1]['slug']})",
                      "--label", LABEL, "--body-file", "-", input=issue_body(batch))
        opened += 1
    print(f"{len(todo)} companies to verify, {len(asked)} already asked, {opened} issues opened")
    return 0


def collect(dry: bool, closing: str | None) -> int:
    companies = lib.load_companies()
    by_key = {key(c): c for c in companies}
    none = read_none()
    today = dt.date.today().isoformat()
    found = unfound = rejected = pending = 0
    to_close = []

    def store(good: dict, nothing: list[str]) -> None:
        nonlocal found, unfound
        for slug, fields in good.items():
            company = by_key.get(slug)
            if company is None:
                continue
            before = lib.verified(company)
            for column, value in fields.items():
                if value and company.get(column) in (None, "", "-"):
                    company[column] = value
            found += not before and lib.verified(company)
            none.pop(slug, None)
        for slug in nothing:
            unfound += slug not in none
            none[slug] = today

    def settled(slug: str) -> bool:
        company = by_key.get(slug)
        return slug in none or company is None or lib.verified(company)

    for issue in enrich.issues(LABEL):
        asked = asked_in(issue)
        state, answer = enrich.reply(enrich.comments_of(issue["number"]))
        if state in ("pending", "handled"):
            pending += state == "pending"
            continue
        if state == "needs-human":
            if not dry:
                enrich.note(issue["number"], "Left for a human.", "needs-human")
            continue
        good, nothing, bad = ({}, [], ["the JSON block does not parse"]) if answer is None \
            else sort_answer(answer, asked)
        store(good, nothing)
        missing = [s for s in asked if not settled(s)]
        if bad or missing:
            rejected += 1
            lines = [f"- {e}" for e in bad[:40]] + [f"- {s}: no answer" for s in missing[:40]]
            if not dry:
                enrich.note(issue["number"], f"{len(good)} found. Not stored:\n\n" + "\n".join(lines),
                            "needs-human")
        else:
            to_close.append({"number": issue["number"],
                             "text": f"Stored: {len(good)} companies found, {len(nothing)} not found."})

    if not dry:
        if found:
            lib.save_companies(companies)
        if found or unfound:
            enrich.write_json(NONE, {
                "as_of": today,
                "note": "Unverified companies an outside agent looked for and could not find "
                        "(instinct/verify), with the date, so they are not asked about again at once.",
                "none": dict(sorted(none.items()))}, 0)
        if closing:
            enrich.write_json(pathlib.Path(closing), to_close, 0)
    print(f"{found} companies verified, {unfound} not found, {rejected} answers sent back, "
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
