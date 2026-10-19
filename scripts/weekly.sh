#!/bin/bash
# The Monday refresh, run by launchd on the maintainer's Mac: Levels.fyi
# refuses GitHub's runners, so the fetch has to come from a Spanish
# connection. It works in a clone of its own, reset to origin/main on every
# run, so it never touches a checkout someone is editing. Its push triggers
# .github/workflows/weekly.yml, which opens the week's issue.
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
  python3 scripts/fetch_spain.py --delay 3.0
  python3 tests/test_pipeline.py
  python3 scripts/validate.py
  python3 scripts/build.py
  git add README.md companies.csv
  if git diff --cached --quiet; then
    echo "Nothing changed."
    return
  fi
  git commit -q -m "Refresh salaries $(date -u +%F)"
  git push -q origin HEAD:main
}

# On one line so bash has read it before `git reset` can rewrite this file.
main "$@"; exit $?
