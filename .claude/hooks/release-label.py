#!/usr/bin/env python3
"""PreToolUse gate: a PR into main must say how big a release it is.

release.yml turns every merged PR into a release, bumped by its label. This
blocks `gh pr create` into main without --label patch|minor|major, so the
choice is made when the PR is opened, not forgotten until after the merge.
"""
import json
import re
import shlex
import sys

LEVELS = {"patch", "minor", "major"}
WHY = (
    "Every PR merged into main becomes a release (release.yml). Add one label "
    "to `gh pr create`: --label patch (fixes, copy, data, small tweaks, tooling), "
    "--label minor (something new and visible: a site section, an MCP tool, a "
    "data field), --label major (breaks whoever consumes us: data/ format, MCP "
    "tool names or arguments, URLs removed). When unsure, patch."
)


def deny(reason):
    print(json.dumps({"hookSpecificOutput": {
        "hookEventName": "PreToolUse",
        "permissionDecision": "deny",
        "permissionDecisionReason": reason,
    }}))


def main():
    data = json.load(sys.stdin)
    tool, inp = data.get("tool_name"), data.get("tool_input") or {}
    if tool == "mcp__github__create_pull_request":
        if (inp.get("base") or "main") == "main":
            deny("This tool cannot label a PR. Use `gh pr create` with a label. " + WHY)
        return
    cmd = inp.get("command") or ""
    m = re.search(r"\bgh\s+pr\s+create\b", cmd)
    if not m:
        return
    try:
        args = shlex.split(cmd[m.start():])
    except ValueError:
        args = cmd[m.start():].split()
    base, labels = "main", set()
    for i, a in enumerate(args):
        nxt = args[i + 1] if i + 1 < len(args) else ""
        if a in ("-B", "--base"):
            base = nxt
        elif a.startswith("--base="):
            base = a.split("=", 1)[1]
        elif a in ("-l", "--label"):
            labels.update(nxt.split(","))
        elif a.startswith("--label="):
            labels.update(a.split("=", 1)[1].split(","))
    if base == "main" and not labels & LEVELS:
        deny(WHY)


if __name__ == "__main__":
    try:
        main()
    except Exception:
        pass  # never block a PR because the gate itself broke
