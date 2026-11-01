#!/bin/bash
# The website's Monday refresh, run by launchd on the maintainer's Mac:
# Levels.fyi refuses GitHub's runners, so the fetch has to come from a Spanish
# connection. It works in a clone of its own, reset to origin/website on every
# run, so it never touches a checkout someone is editing. The salaries are
# private and live outside any clone (lib.DATA); the push carries only the
# README and the site's public aggregates in data/, with the week's digest as
# the commit body. On GitHub that push makes deploy.yml rebuild the site from
# data/ and weekly.yml open the week's issue.
set -Eeuo pipefail

BRANCH=website
before=""

main() {
  local logs="$HOME/Library/Logs/spanish-top-tech-companies"
  mkdir -p "$logs"
  exec >>"$logs/weekly.log" 2>&1
  echo "=== $(date '+%F %T')"
  trap 'osascript -e "display notification \"See ~/Library/Logs/spanish-top-tech-companies/weekly.log\" with title \"Salary refresh failed\""' ERR
  trap 'rm -f "$before"' EXIT

  # Right after waking from sleep the network can take a while to come back,
  # and on 2026-10-19 GitHub answered while levels.fyi did not resolve yet.
  # No -f on the second: any HTTP answer means the network is up.
  for _ in {1..20}; do
    curl -sfo /dev/null https://github.com && curl -so /dev/null -m 10 https://api.levels.fyi && break
    sleep 30
  done

  cd "$HOME/.local/share/spanish-top-tech-companies"
  git fetch -q origin "$BRANCH"
  # -B also moves a clone still on main, which this one followed until 2026-11.
  git checkout -q -f -B "$BRANCH" "origin/$BRANCH"

  before="$(mktemp)"
  cp "$(python3 -c 'import sys; sys.path.insert(0, "scripts"); import lib; print(lib.DATA)')" "$before"

  python3 scripts/fetch_taxonomy.py
  python3 scripts/fetch_spain.py --delay 3.0
  python3 scripts/fetch_company.py --missing --delay 3.0
  python3 scripts/fetch_radar.py
  python3 tests/test_pipeline.py
  python3 scripts/validate.py
  python3 scripts/build.py
  python3 scripts/site.py --refresh

  git add README.md data scripts/taxonomy.py
  if git diff --cached --quiet; then
    echo "Nothing changed."
    return
  fi
  git commit -q -m "Refresh salaries $(date -u +%F)" -m "$(python3 scripts/digest.py "$before")"
  # The fetch takes most of an hour; a PR merged meanwhile must not fail the push.
  git pull -q --rebase origin "$BRANCH"
  git push -q origin "HEAD:$BRANCH"
}

# On one line so bash has read it before `git checkout` can rewrite this file.
main "$@"; exit $?
