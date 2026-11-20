#!/usr/bin/env python3
"""Company size and contacts from an outside agent, through issues.

    python3 scripts/enrich.py open [--limit N] [--dry-run]
    python3 scripts/enrich.py collect [--dry-run]
    python3 scripts/enrich.py check ANSWER.json

The contract with the agent is instinct/: brief.md (what it is told) and
schema.json (what it answers). `open` files one issue per company that has no
size in data/sizes.json or no contact check in contacts.json, labelled
`enrich`, in the private repo: the answers name people, and a public issue
would publish them. `collect` reads the issues the agent labelled `enriched`,
checks the answer and writes the size to data/sizes.json and the contacts to
contacts.json beside lib.DATA (private_data.sh push keeps it). A bad answer
goes back labelled `needs-human` and nothing is written.

Never overwrites: a size on file stays, and a contact on file stays beside
the new ones. An email is kept only if it appears at its evidence_url.

It prints counts only: enrich.yml's log is public.
"""
from __future__ import annotations

import datetime as dt
import html
import json
import re
import subprocess
import sys
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
# Issues opened in one run, so the agent gets a queue it can keep up with.
LIMIT = 25
LABELS = {"enrich": "0e8a16", "enriched": "1d76db", "needs-human": "d93f0b"}
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


def answer_errors(answer, asked: dict) -> list[str]:
    """What is wrong with an answer to the issue that asked `asked`."""
    errors = schema_errors(answer, json.loads(SCHEMA.read_text(encoding="utf-8")))
    if errors:
        return errors
    if answer["slug"] != asked["slug"]:
        errors.append(f"$.slug: the issue asked about {asked['slug']}")
    ids = {j["id"] for j in asked.get("jobs", [])}
    for i, c in enumerate(answer["contacts"]):
        unknown = [j for j in c["jobs"] if j not in ids]
        if unknown:
            errors.append(f"$.contacts[{i}].jobs: not in the issue: {', '.join(unknown)}")
    return errors


def json_block(text: str):
    """The last ```json block of a text that parses, or None."""
    for block in reversed(re.findall(r"```json\s*\n(.*?)```", text or "", re.S)):
        try:
            return json.loads(block)
        except json.JSONDecodeError:
            continue
    return None


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

def gh(*args: str, input: str | None = None) -> str:
    return subprocess.run(["gh", *args], input=input, capture_output=True, text=True, check=True).stdout


def issues(label: str) -> list[dict]:
    out = gh("issue", "list", "-R", PRIVATE_REPO, "--label", label, "--state", "open", "--limit", "1000",
             "--json", "number,title,body")
    return json.loads(out)


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


def issue_body(asked: dict) -> str:
    return (f"Instructions: {BRIEF}\n\nAnswer with one comment holding one JSON block that follows "
            f"instinct/schema.json, then label this issue `enriched` (or `needs-human`).\n\n"
            f"```json\n{json.dumps(asked, ensure_ascii=False, indent=2)}\n```\n")


def open_issues(limit: int, dry: bool) -> int:
    data = json.loads((lib.ROOT / "data" / "data.json").read_text(encoding="utf-8"))
    with urllib.request.urlopen(urllib.request.Request(JOBS_URL, headers={"User-Agent": UA}), timeout=60) as r:
        jobs = json.load(r)["jobs"]
    sizes = read_json(SIZES, {"companies": {}})
    contacts = read_json(CONTACTS, {"companies": {}, "checked": {}})
    todo = wanted(data, jobs, sizes, contacts, dt.date.today())
    if not dry:
        ensure_labels()
    asked = set()
    for label in LABELS:
        for issue in ([] if dry else issues(label)):
            block = json_block(issue["body"])
            if isinstance(block, dict) and block.get("slug"):
                asked.add(block["slug"])
    opened = 0
    for item in todo:
        if opened >= limit:
            break
        if item["slug"] in asked:
            continue
        if not dry:
            gh("issue", "create", "-R", PRIVATE_REPO, "--title", f"Enrich {item['name']} ({item['slug']})",
               "--label", "enrich", "--body-file", "-", input=issue_body(item))
        opened += 1
    print(f"{len(todo)} companies to enrich, {len(asked)} already asked, {opened} issues opened")
    return 0


def collect(dry: bool) -> int:
    sizes = read_json(SIZES, {"companies": {}})
    contacts = read_json(CONTACTS, {"as_of": None, "companies": {}, "checked": {}})
    contacts.setdefault("checked", {})
    today = dt.date.today().isoformat()
    stored = rejected = sized = people = dropped = 0
    for issue in issues("enriched"):
        asked = json_block(issue["body"])
        comments = json.loads(gh("issue", "view", str(issue["number"]), "-R", PRIVATE_REPO,
                                 "--json", "comments"))["comments"]
        answer = next((b for b in (json_block(c["body"]) for c in reversed(comments)) if isinstance(b, dict)), None)
        errors = ["no JSON block in the comments"] if answer is None else answer_errors(answer, asked or {})
        if errors:
            rejected += 1
            if not dry:
                gh("issue", "comment", str(issue["number"]), "-R", PRIVATE_REPO, "--body-file", "-",
                   input="Not stored:\n\n" + "\n".join(f"- {e}" for e in errors[:30]))
                gh("issue", "edit", str(issue["number"]), "-R", PRIVATE_REPO,
                   "--remove-label", "enriched", "--add-label", "needs-human")
            continue
        slug = answer["slug"]
        entry = size_entry(answer["size"])
        added = bool(entry) and slug not in sizes["companies"]
        if added:
            sizes["companies"][slug] = entry
            sized += 1
        kept = []
        for c in answer["contacts"]:
            if c["email"] and not published_at(c["evidence_url"], c["email"]):
                c = {**c, "email": None}
                dropped += 1
            if c["email"] or c["linkedin"]:
                kept.append(stored_contact(c))
        before = contacts["companies"].get(slug, [])
        merged = merge_contacts(before, kept)
        people += len(merged) - len(before)
        if merged:
            contacts["companies"][slug] = merged
        contacts["checked"][slug] = today
        stored += 1
        if not dry:
            gh("issue", "close", str(issue["number"]), "-R", PRIVATE_REPO, "--comment",
               f"Stored: size {'added' if added else 'unchanged'}, {len(merged) - len(before)} new contacts.")
    if stored and not dry:
        sizes["companies"] = dict(sorted(sizes["companies"].items()))
        contacts["companies"] = dict(sorted(contacts["companies"].items()))
        contacts["as_of"] = today
        write_json(SIZES, sizes, 0)
        write_json(CONTACTS, contacts, 1)
    print(f"{stored} answers stored ({sized} sizes, {people} contacts, {dropped} emails not found at their "
          f"source), {rejected} sent back")
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
        return collect(dry)
    print(__doc__, file=sys.stderr)
    return 2


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
