#!/usr/bin/env python3
"""Company size and contacts from an outside agent, through issues.

    python3 scripts/enrich.py open [--limit N] [--dry-run]
    python3 scripts/enrich.py collect [--dry-run] [--closing FILE]
    python3 scripts/enrich.py close FILE
    python3 scripts/enrich.py check ANSWER.json

The contract with the agent is instinct/: brief.md (what it is told) and
schema.json (what it answers). `open` files issues of PER_ISSUE companies
that have no size in data/sizes.json or no contact check in contacts.json,
labelled `enrich`, in the private repo: the answers name people, and a public
issue would publish them. The agent can comment but not label, so `collect`
reads every open `enrich` issue for the last answer by ANSWERER: a JSON
block, or a NEEDS_HUMAN line. No answer yet leaves the issue as it is. Each
company's item that passes writes the size to data/sizes.json and the
contacts to contacts.json beside lib.DATA (private_data.sh push keeps it);
the rest go back in a comment with `needs-human`, and the issue stays open
until every company it asked about is on file. Its issues are closed by
`close` once the files are saved (enrich.yml runs it after the push), so a
failed push leaves them open to be stored again.

A first answer never overwrites: a size on file stays, and a contact on file
stays beside the new ones. A later answer in the same issue is a correction
and replaces what the earlier one left, size and contacts; `collect` reads
the issues closed in the last CORRECTION_DAYS for one. An email is kept only
if it appears at its evidence_url.

It prints counts only: enrich.yml's log is public.
"""
from __future__ import annotations

import datetime as dt
import html
import json
import pathlib
import re
import subprocess
import sys
import time
import urllib.request

import headcount
import lib

PRIVATE_REPO = "pugarte7/spanish-top-tech-companies-data"
INSTINCT = lib.ROOT / "instinct"
SCHEMA = INSTINCT / "schema.json"
BRIEF = "https://github.com/pugarte7/spanish-top-tech-companies/blob/main/instinct/brief.md"
JOBS_URL = "https://spanishtoptechcompanies.com/api/v1/jobs.json"
SIZES = headcount.SIZES
CONTACTS = headcount.CONTACTS
# A company whose contacts were checked this long ago is asked again: people move.
RECHECK_DAYS = 120
# One issue per company was more than the agent could take. An issue holds
# up to this many, fewer when their postings fill it first (BODY_MAX).
PER_ISSUE = 50
# Issues opened in one run.
LIMIT = 25
# The agent sees the private repo's newest 100 issues and no more: with more
# than that open, the oldest would never be answered.
OPEN_MAX = 80
# How long after an issue is closed a new answer in it is still read.
CORRECTION_DAYS = 14
LABELS = {"enrich": "0e8a16", "needs-human": "d93f0b"}
# The account the agent comments with. enrich.yml's token is this account's
# too, so this script's own comments carry MARK to tell them apart.
ANSWERER = "pugarte7"
MARK = "<!-- enrich.py -->"
NEEDS_HUMAN = re.compile(r"^\s*NEEDS_HUMAN\b", re.M)
UA = "Mozilla/5.0 (compatible; spanish-top-tech-companies enrich)"


# --- The answer's shape ----------------------------------------------------------

def _type_ok(value, kind: str) -> bool:
    return {"null": value is None, "string": isinstance(value, str), "object": isinstance(value, dict),
            "array": isinstance(value, list), "boolean": isinstance(value, bool),
            "integer": isinstance(value, int) and not isinstance(value, bool),
            "number": isinstance(value, (int, float)) and not isinstance(value, bool)}[kind]


def schema_errors(value, schema: dict, at: str = "$") -> list[str]:
    """The JSON Schema keywords schema.json uses, and no more: a dependency
    for a dozen keywords is not worth it in CI."""
    errors: list[str] = []
    if "type" in schema:
        kinds = schema["type"] if isinstance(schema["type"], list) else [schema["type"]]
        if not any(_type_ok(value, k) for k in kinds):
            return [f"{at}: expected {' or '.join(kinds)}"]
    if "enum" in schema and value not in schema["enum"]:
        errors.append(f"{at}: not one of {schema['enum']}")
    if isinstance(value, str):
        if "pattern" in schema and not re.search(schema["pattern"], value):
            errors.append(f"{at}: does not match {schema['pattern']}")
        if schema.get("format") == "uri" and not re.match(r"https?://\S+$", value):
            errors.append(f"{at}: not a URL")
        if schema.get("format") == "email" and not re.fullmatch(r"[^@\s]+@[^@\s]+\.[^@\s]+", value):
            errors.append(f"{at}: not an email")
    if isinstance(value, int) and not isinstance(value, bool) and "minimum" in schema and value < schema["minimum"]:
        errors.append(f"{at}: under {schema['minimum']}")
    if isinstance(value, dict):
        for key in schema.get("required", []):
            if key not in value:
                errors.append(f"{at}: missing {key}")
        props = schema.get("properties", {})
        for key, item in value.items():
            if key in props:
                errors += schema_errors(item, props[key], f"{at}.{key}")
            elif schema.get("additionalProperties") is False:
                errors.append(f"{at}: unexpected {key}")
    if isinstance(value, list):
        if "maxItems" in schema and len(value) > schema["maxItems"]:
            errors.append(f"{at}: more than {schema['maxItems']} items")
        if "minItems" in schema and len(value) < schema["minItems"]:
            errors.append(f"{at}: fewer than {schema['minItems']} items")
        for i, item in enumerate(value):
            errors += schema_errors(item, schema.get("items", {}), f"{at}[{i}]")
    for sub in schema.get("allOf", []):
        errors += schema_errors(value, sub, at)
    if "anyOf" in schema and all(schema_errors(value, sub, at) for sub in schema["anyOf"]):
        errors.append(f"{at}: matches none of anyOf")
    if "if" in schema and not schema_errors(value, schema["if"], at):
        errors += schema_errors(value, schema.get("then", {}), at)
    return errors


def item_errors(item, asked: dict[str, dict]) -> list[str]:
    """What is wrong with one company's item of an answer to the issue that
    asked about `asked` (slug to what was asked)."""
    schema = json.loads(SCHEMA.read_text(encoding="utf-8"))["properties"]["companies"]["items"]
    errors = schema_errors(item, schema)
    if errors:
        return errors
    if item["slug"] not in asked:
        return ["$.slug: the issue did not ask about it"]
    ids = {j["id"] for j in asked[item["slug"]].get("jobs", [])}
    for i, c in enumerate(item["contacts"]):
        unknown = [j for j in c["jobs"] if j not in ids]
        if unknown:
            errors.append(f"$.contacts[{i}].jobs: not in the issue: {', '.join(unknown)}")
    return errors


def sort_answer(answer, asked: dict[str, dict]) -> tuple[list[dict], list[str]]:
    """(the items to store, what is wrong with the rest) of one answer."""
    if not isinstance(answer, dict) or not isinstance(answer.get("companies"), list):
        return [], ["$: not an object with a `companies` list"]
    good, bad = [], []
    for n, item in enumerate(answer["companies"]):
        wrong = item_errors(item, asked)
        name = item.get("slug") if isinstance(item, dict) and isinstance(item.get("slug"), str) else f"item {n}"
        if wrong:
            bad += [f"{name}: {w}" for w in wrong[:6]]
        else:
            good.append(item)
    return good, bad


def json_block(text: str):
    """The last ```json block of a text that parses, or None. A block left
    open at the end of the text counts: the agent has sent one."""
    for block in reversed(re.findall(r"```json\s*\n(.*?)(?:```|\Z)", text or "", re.S)):
        try:
            return json.loads(block)
        except json.JSONDecodeError:
            continue
    return None


def reply(comments: list[dict]) -> tuple[str, object]:
    """What an issue's comments hold, read from the newest by ANSWERER:
    ("handled", None) when this script spoke after the last answer,
    ("needs-human", None), ("answer", the JSON or None if it does not parse),
    or ("pending", None) with no answer yet. Other accounts' comments, and
    ANSWERER's without a JSON block, are passed over."""
    for c in reversed(comments):
        if (c.get("author") or {}).get("login") != ANSWERER:
            continue
        body = c.get("body") or ""
        if MARK in body:
            return "handled", None
        if NEEDS_HUMAN.search(body):
            return "needs-human", None
        if "```json" in body:
            return "answer", json_block(body)
    return "pending", None


def corrects(comments: list[dict]) -> bool:
    """Whether the newest answer comes after an earlier one in the same issue:
    the agent corrects itself with a new comment, and the new one wins."""
    answers = [c for c in comments if (c.get("author") or {}).get("login") == ANSWERER
               and MARK not in (c.get("body") or "") and "```json" in (c.get("body") or "")]
    return len(answers) > 1


# --- What is stored ----------------------------------------------------------------

def size_entry(size: dict) -> list | None:
    """data/sizes.json's [bucket, employees(, 1 for a branch)] of an answer."""
    employees = size.get("employees")
    by = employees
    if by is None and size.get("range"):
        top = re.findall(r"\d+", size["range"])[-1]
        by = int(top) + (1 if size["range"].endswith("+") else 0)
    if by is None:
        return None
    if size.get("scope") == "branch":
        return [None, employees, 1]
    return [headcount.bucket(by), employees]


def stored_contact(c: dict) -> dict:
    """The fields api/mcp.js reads; evidence_quote and published_on stay out."""
    return {"kind": c["kind"], "name": c["name"], "role": c["role"], "email": c["email"],
            "linkedin": c["linkedin"], "jobs": c["jobs"], "scope": c["scope"],
            "published": c["link_evidence"], "source": c["evidence_url"]}


def merge_contacts(old: list[dict], new: list[dict]) -> list[dict]:
    """The contacts on file, then the new ones not already there (by email or profile)."""
    def keys(c):
        return {k.lower().rstrip("/") for k in (c.get("email"), c.get("linkedin")) if k}
    seen = set().union(*(keys(c) for c in old)) if old else set()
    out = list(old)
    for c in new:
        if keys(c) & seen:
            continue
        seen |= keys(c)
        out.append(c)
    return out


def published_at(url: str, email: str) -> bool:
    """Whether the address appears at the page given as its evidence."""
    try:
        req = urllib.request.Request(url, headers={"User-Agent": UA})
        with urllib.request.urlopen(req, timeout=20) as r:
            page = r.read(3_000_000).decode("utf-8", "replace")
    except Exception:
        return False
    page = html.unescape(page).lower()
    return email.lower() in page or email.lower().replace("@", " at ") in page


def read_json(path, default):
    return json.loads(path.read_text(encoding="utf-8")) if path.exists() else default


def write_json(path, value, indent) -> None:
    path.write_text(json.dumps(value, ensure_ascii=False, indent=indent) + "\n", encoding="utf-8")


# --- Issues ----------------------------------------------------------------------

# Seconds to wait when GitHub says issues are coming too fast, try after try.
TOO_FAST = (60, 180, 600)


def gh(*args: str, input: str | None = None) -> str:
    """gh's output. Its own words go to the log when it fails: without them a
    failed run says only that gh failed."""
    creating = args[:2] == ("issue", "create")
    for wait in (*TOO_FAST, None):
        done = subprocess.run(["gh", *args], input=input, capture_output=True, text=True)
        if done.returncode == 0:
            if creating:
                time.sleep(2)       # GitHub asks for a second between the things one creates
            return done.stdout
        said = " ".join(done.stderr.split())[:300]
        if wait is None or not re.search(r"too quickly|rate limit|abuse", said, re.I):
            break
        print(f"gh: {said}; waiting {wait}s", file=sys.stderr)
        time.sleep(wait)
    print(f"gh {' '.join(args[:2])}: {said}", file=sys.stderr)
    raise subprocess.CalledProcessError(done.returncode, ["gh", *args[:2]], done.stdout, done.stderr)


def issues(label: str) -> list[dict]:
    out = gh("issue", "list", "-R", PRIVATE_REPO, "--label", label, "--state", "open", "--limit", "1000",
             "--json", "number,title,body")
    return json.loads(out)


def room() -> int:
    """How many more issues can be opened without passing OPEN_MAX, whatever their label."""
    out = gh("issue", "list", "-R", PRIVATE_REPO, "--state", "open", "--limit", "1000", "--json", "number")
    return max(0, OPEN_MAX - len(json.loads(out)))


def closed_lately(label: str) -> list[dict]:
    """The issues closed and touched in the last CORRECTION_DAYS, where a
    correction may have come after the answer was stored."""
    since = (dt.date.today() - dt.timedelta(days=CORRECTION_DAYS)).isoformat()
    out = gh("issue", "list", "-R", PRIVATE_REPO, "--label", label, "--state", "closed", "--limit", "200",
             "--search", f"updated:>={since}", "--json", "number,title,body")
    return json.loads(out)


def comments_of(number: int) -> list[dict]:
    return json.loads(gh("issue", "view", str(number), "-R", PRIVATE_REPO, "--json", "comments"))["comments"]


def asked_in(issue: dict) -> dict[str, dict]:
    """Slug to what the issue asked about it."""
    block = json_block(issue["body"])
    companies = block.get("companies", []) if isinstance(block, dict) else []
    return {c["slug"]: c for c in companies if isinstance(c, dict) and c.get("slug")}


def ensure_labels() -> None:
    for name, color in LABELS.items():
        gh("label", "create", name, "-R", PRIVATE_REPO, "--color", color, "--force")


def wanted(data: dict, jobs: list[dict], sizes: dict, contacts: dict, today: dt.date) -> list[dict]:
    """The issue inputs of companies missing a size or a recent contact check,
    those with open postings first."""
    by_slug: dict[str, list] = {}
    for j in jobs:
        by_slug.setdefault(j.get("slug"), []).append(j)
    checked = contacts.get("checked", {})
    careers = read_json(lib.ROOT / "data" / "careers.json", {})
    out = []
    for c in data["companies"]:
        slug = c.get("levels")
        if not slug:
            continue
        when = checked.get(slug)
        stale = when is None or (today - dt.date.fromisoformat(when)).days >= RECHECK_DAYS
        if slug in sizes["companies"] and not stale:
            continue
        mine = by_slug.get(slug, [])
        out.append({"slug": slug, "name": c["name"], "website": c.get("url") or None,
                    "linkedin": c.get("linkedin") or None, "careers": careers.get(slug),
                    "jobs": [{"id": j["id"], "title": j["title"], "location": j.get("location"),
                              "url": j["url"]} for j in mine]})
    out.sort(key=lambda x: (not x["jobs"], x["slug"]))
    return out


# GitHub refuses an issue body over 65,536 characters, and a consultancy has
# hundreds of postings.
BODY_MAX = 60_000


def batches(items: list[dict]):
    """The companies in issues of PER_ISSUE, or of as many as fit with every
    posting of each."""
    room = BODY_MAX - len(issue_body([]))
    batch, used = [], 0
    for item in items:
        size = len(json.dumps(item, ensure_ascii=False)) + 2
        if batch and (len(batch) == PER_ISSUE or used + size > room):
            yield batch
            batch, used = [], 0
        batch.append(item)
        used += size
    if batch:
        yield batch


def issue_body(batch: list[dict]) -> str:
    """The issue's text, one company a line. A company with more postings
    than fit in an issue of its own lists the first that do."""
    def body(most: int) -> str:
        lines = ",\n".join(json.dumps({**c, "jobs": c["jobs"][:most]}, ensure_ascii=False) for c in batch)
        return (f"Instructions: {BRIEF}\n\nAnswer with one comment by {ANSWERER} holding one JSON block that "
                f"follows instinct/schema.json, with one item per company below, or a line starting "
                f"NEEDS_HUMAN and why. To correct an answer, comment again with the items to replace.\n\n"
                f"```json\n{{\"companies\": [\n{lines}\n]}}\n```\n")
    most = max((len(c["jobs"]) for c in batch), default=0)
    while most and len(body(most)) > BODY_MAX:
        most = most * 9 // 10
    return body(most)


def open_issues(limit: int, dry: bool) -> int:
    data = json.loads((lib.ROOT / "data" / "data.json").read_text(encoding="utf-8"))
    with urllib.request.urlopen(urllib.request.Request(JOBS_URL, headers={"User-Agent": UA}), timeout=60) as r:
        jobs = json.load(r)["jobs"]
    sizes = read_json(SIZES, {"companies": {}})
    contacts = read_json(CONTACTS, {"companies": {}, "checked": {}})
    todo = wanted(data, jobs, sizes, contacts, dt.date.today())
    if not dry:
        ensure_labels()
    asked: set[str] = set()
    for label in LABELS:
        for issue in ([] if dry else issues(label)):
            asked |= set(asked_in(issue))
    left = [item for item in todo if item["slug"] not in asked]
    if not dry:
        limit = min(limit, room())
    opened = 0
    for batch in batches(left):
        if opened >= limit:
            break
        if not dry:
            gh("issue", "create", "-R", PRIVATE_REPO, "--title",
               f"Enrich {len(batch)} companies ({batch[0]['slug']} to {batch[-1]['slug']})",
               "--label", "enrich", "--body-file", "-", input=issue_body(batch))
        opened += 1
    print(f"{len(todo)} companies to enrich, {len(asked)} already asked, {opened} issues opened")
    return 0


def note(number: int, text: str, label: str | None = None) -> None:
    gh("issue", "comment", str(number), "-R", PRIVATE_REPO, "--body-file", "-", input=f"{MARK}\n{text}")
    if label:
        gh("issue", "edit", str(number), "-R", PRIVATE_REPO, "--add-label", label)


def collect(dry: bool, closing: str | None) -> int:
    sizes = read_json(SIZES, {"companies": {}})
    contacts = read_json(CONTACTS, {"as_of": None, "companies": {}, "checked": {}})
    contacts.setdefault("checked", {})
    today = dt.date.today()
    stored = rejected = flagged = pending = sized = people = dropped = 0
    to_close = []

    def on_file(slug: str) -> bool:
        when = contacts["checked"].get(slug)
        return bool(when) and (today - dt.date.fromisoformat(when)).days < RECHECK_DAYS

    def store(item: dict, replace: bool) -> None:
        nonlocal sized, people, dropped, stored
        slug = item["slug"]
        entry = size_entry(item["size"])
        if entry and (replace or slug not in sizes["companies"]):
            sized += sizes["companies"].get(slug) != entry
            sizes["companies"][slug] = entry
        kept = []
        for c in item["contacts"]:
            if c["email"] and not published_at(c["evidence_url"], c["email"]):
                c = {**c, "email": None}
                dropped += 1
            if c["email"] or c["linkedin"]:
                kept.append(stored_contact(c))
        before = contacts["companies"].get(slug, [])
        merged = merge_contacts([], kept) if replace else merge_contacts(before, kept)
        people += len(merged) - len(before)
        if merged:
            contacts["companies"][slug] = merged
        else:
            contacts["companies"].pop(slug, None)
        contacts["checked"][slug] = today.isoformat()
        stored += 1

    for issue in issues("enrich"):
        asked = asked_in(issue)
        comments = comments_of(issue["number"])
        state, answer = reply(comments)
        if state in ("pending", "handled"):
            pending += state == "pending"
            continue
        if state == "needs-human":
            flagged += 1
            if not dry:
                note(issue["number"], "Left for a human.", "needs-human")
            continue
        good, bad = ([], ["the JSON block does not parse"]) if answer is None else sort_answer(answer, asked)
        for item in good:
            store(item, corrects(comments))
        missing = [slug for slug in asked if not on_file(slug)]
        if bad or missing:
            rejected += 1
            lines = [f"- {e}" for e in bad[:40]] + [f"- {slug}: no answer" for slug in missing[:60]]
            if not dry:
                note(issue["number"], f"{len(good)} stored. Not stored:\n\n" + "\n".join(lines), "needs-human")
        else:
            to_close.append({"number": issue["number"], "text": f"Stored: {len(good)} companies."})

    # A new answer in an issue already stored and closed is a correction.
    for issue in closed_lately("enrich"):
        comments = comments_of(issue["number"])
        state, answer = reply(comments)
        if state != "answer":
            continue
        good, bad = ([], ["the JSON block does not parse"]) if answer is None \
            else sort_answer(answer, asked_in(issue))
        for item in good:
            store(item, True)
        if not dry:
            note(issue["number"], f"Correction stored for {len(good)} companies."
                 + ("\n\nNot stored:\n\n" + "\n".join(f"- {e}" for e in bad[:40]) if bad else ""))

    if stored and not dry:
        sizes["companies"] = dict(sorted(sizes["companies"].items()))
        contacts["companies"] = dict(sorted(contacts["companies"].items()))
        contacts["as_of"] = today.isoformat()
        write_json(SIZES, sizes, 0)
        write_json(CONTACTS, contacts, 1)
    if closing and not dry:
        write_json(pathlib.Path(closing), to_close, 0)
    print(f"{stored} companies stored ({sized} sizes, {people} contacts, {dropped} emails not found at their "
          f"source), {rejected} answers sent back, {flagged} left for a human, {pending} issues not answered yet")
    return 0


def close(path: str) -> int:
    """Closes the issues collect stored, once enrich.yml has saved the files."""
    done = read_json(pathlib.Path(path), [])
    for item in done:
        gh("issue", "close", str(item["number"]), "-R", PRIVATE_REPO, "--comment", f"{MARK}\n{item['text']}")
    print(f"{len(done)} issues closed")
    return 0


def main(argv: list[str]) -> int:
    if len(argv) >= 2 and argv[0] == "check":
        answer = json.loads(open(argv[1], encoding="utf-8").read())
        errors = schema_errors(answer, json.loads(SCHEMA.read_text(encoding="utf-8")))
        print("\n".join(errors) or "valid")
        return 1 if errors else 0
    dry = "--dry-run" in argv
    if argv[:1] == ["open"]:
        limit = int(argv[argv.index("--limit") + 1]) if "--limit" in argv else LIMIT
        return open_issues(limit, dry)
    if argv[:1] == ["collect"]:
        return collect(dry, argv[argv.index("--closing") + 1] if "--closing" in argv else None)
    if len(argv) >= 2 and argv[0] == "close":
        return close(argv[1])
    print(__doc__, file=sys.stderr)
    return 2


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
