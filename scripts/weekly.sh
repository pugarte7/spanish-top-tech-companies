#!/bin/bash
# The Monday refresh, run by launchd on the maintainer's Mac: Levels.fyi
# refuses GitHub's runners, so the fetch has to come from a Spanish
# connection. It works in a clone of its own, reset to origin/main on every
# run, so it never touches a checkout someone is editing. The data is private
# and lives outside any clone (lib.DATA); only the README is pushed, with the
# week's digest as the commit body, which .github/workflows/weekly.yml turns
# into the week's issue.
set -Eeuo pipefail

main() {
  local logs="$HOME/Library/Logs/spanish-top-tech-companies"
  mkdir -p "$logs"
  exec >>"$logs/weekly.log" 2>&1
  echo "=== $(date '+%F %T')"
  trap 'osascript -e "display notification \"See ~/Library/Logs/spanish-top-tech-companies/weekly.log\" with title \"Salary refresh failed\""' ERR

  # Right after waking from sleep the network can take a while to come back.
  for _ in {1..20}; do curl -sfo /dev/null https://github.com && break; sleep 30; done

  cd "$HOME/.local/share/spanish-top-tech-companies"
  git fetch -q origin main
  git reset -q --hard origin/main
  local before
  before="$(mktemp)"
  cp "${STC_DATA:-$HOME/.local/share/spanish-top-tech-companies-data/companies.csv}" "$before"
  python3 scripts/fetch_spain.py --delay 3.0
  python3 tests/test_pipeline.py
  python3 scripts/validate.py
  python3 scripts/build.py
  git add README.md
  if git diff --cached --quiet; then
    echo "Nothing changed."
    return
  fi
  git commit -q -m "Refresh salaries $(date -u +%F)" -m "$(python3 scripts/digest.py "$before")"
  git push -q origin HEAD:main
}

# On one line so bash has read it before `git reset` can rewrite this file.
main "$@"; exit $?
