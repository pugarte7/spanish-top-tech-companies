#!/usr/bin/env python3
"""The line history.yml keeps per run is built from the run and its log."""
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent / "scripts"))
import run_summary

RUN = {"databaseId": 7, "workflowName": "about", "event": "schedule", "conclusion": "success",
       "startedAt": "2026-11-22T22:00:00Z", "updatedAt": "2026-11-22T22:28:30Z", "headSha": "0123456789abcdef"}
LOG = """about\tStore\t2026-11-22T22:01:00Z ##[group]Run python3 scripts/run_summary.py Stored "$(tail -1 out.txt)"
about\tStore\t2026-11-22T22:01:01Z RUN_SUMMARY {"Stored": "20 sentences stored, 0 sent back"}
about\tAsk\t2026-11-22T22:02:00Z RUN_SUMMARY {"Asked": "727 companies without a sentence"}\r
about\tAsk\t2026-11-22T22:02:01Z RUN_SUMMARY {not json}
"""

line = run_summary.line(RUN, LOG)
assert line == {"at": "2026-11-22T22:28:30Z", "workflow": "about", "run": 7, "event": "schedule",
                "conclusion": "success", "minutes": 28, "sha": "0123456",
                "summary": {"Stored": "20 sentences stored, 0 sent back",
                            "Asked": "727 companies without a sentence"}}, line
# A run with no log, or cut before it started, still leaves its line.
bare = run_summary.line({"workflowName": "refresh", "conclusion": "failure"}, "")
assert bare["summary"] == {} and bare["minutes"] is None and bare["sha"] == "", bare
print("all passed")
