#!/usr/bin/env python3
"""What a workflow run did, in counts.

    python3 scripts/run_summary.py LABEL TEXT    # in a workflow step
    python3 scripts/run_summary.py boards        # boards.yml: how many companies have one
    python3 scripts/run_summary.py postings JOBS.json [BUILD.log]   # deploy.yml: the job index
    python3 scripts/run_summary.py line RUN.json RUN.log

The first three add a line to the run's page (GITHUB_STEP_SUMMARY) and print
it as `RUN_SUMMARY {json}`. The last, in history.yml, takes `gh run view
--json` and the run's log and prints the one line kept per run in the private
repo (private_data.sh history).

Counts only, never a company or a person: the log and the page are public.
"""
from __future__ import annotations

import collections
import datetime
import json
import os
import re
import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
MARK = "RUN_SUMMARY "


def note(label: str, text: str) -> None:
    text = " ".join(text.split())
    page = os.environ.get("GITHUB_STEP_SUMMARY")
    if page:
        with open(page, "a", encoding="utf-8") as out:
            out.write(f"- **{label}:** {text or 'nothing'}\n")
    print(MARK + json.dumps({label: text}, ensure_ascii=False))


def minutes(start: str, end: str) -> int | None:
    try:
        span = datetime.datetime.fromisoformat(end) - datetime.datetime.fromisoformat(start)
    except (TypeError, ValueError):
        return None
    return round(span.total_seconds() / 60)


def line(run: dict, log: str) -> dict:
    summary = {}
    for found in re.findall(re.escape(MARK) + r"(\{.*\})\s*$", log, re.M):
        try:
            summary.update(json.loads(found))
        except ValueError:
            pass
    failed = [step["name"] for job in run.get("jobs") or [] for step in job.get("steps") or []
              if step.get("conclusion") == "failure"]
    return {"at": run.get("updatedAt"), "workflow": run.get("workflowName"), "run": run.get("databaseId"),
            "event": run.get("event"), "conclusion": run.get("conclusion"), "failed": failed,
            "minutes": minutes(run.get("startedAt"), run.get("updatedAt")),
            "sha": (run.get("headSha") or "")[:7], "summary": summary}


def refused(log: str) -> str:
    """What the crawl's refusals said, by message with the host and the wait left out."""
    said = collections.Counter(re.findall(r"refused .*\((\[\w+\] [^()]*)\); retrying", log))
    return ", ".join(f"{text} x{count}" for text, count in said.most_common(6))


def read(path) -> dict:
    return json.loads(pathlib.Path(path).read_text(encoding="utf-8"))


def main(argv: list[str]) -> int:
    if argv == ["boards"]:
        note("Boards", f"{len(read(ROOT / 'data' / 'boards.json'))} companies with a board, "
                       f"{len(read(ROOT / 'data' / 'boards-none.json'))} without")
        return 0
    if len(argv) in (2, 3) and argv[0] == "postings":
        index = read(argv[1])
        boards = index.get("boards", {})
        note("Postings", f"{len(index['jobs'])} postings as of {index.get('generated_at')}; "
                         f"{boards.get('queried')} boards read, {boards.get('failed')} failed, "
                         f"{boards.get('stale')} stale")
        if boards.get("issues"):
            note("Board failures", ", ".join(f"{kind} x{count}" for kind, count in sorted(boards["issues"].items())))
        log = pathlib.Path(argv[2]).read_text(encoding="utf-8", errors="replace") if len(argv) == 3 else ""
        refusals = refused(log)
        if refusals:
            note("Refusals", refusals)
        return 0
    if len(argv) == 3 and argv[0] == "line":
        run = json.loads(open(argv[1], encoding="utf-8").read())
        log = open(argv[2], encoding="utf-8", errors="replace").read() if os.path.exists(argv[2]) else ""
        print(json.dumps(line(run, log), ensure_ascii=False))
        return 0
    if len(argv) == 2:
        note(argv[0], argv[1])
        return 0
    print(__doc__, file=sys.stderr)
    return 2


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
