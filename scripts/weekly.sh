#!/bin/bash
# The website's Monday refresh, run by launchd on the maintainer's Mac:
# Levels.fyi refuses GitHub's runners, so the fetch has to come from a Spanish
# connection. It works in a clone of its own, reset to origin/website on every
# run, so it never touches a checkout someone is editing, nor the clone main's
# refresh uses at 08:00. Its push to `website` triggers
# .github/workflows/deploy.yml, which puts the new data on the site.
set -Eeuo pipefail

BRANCH=website
CLONE="$HOME/.local/share/spanish-top-tech-companies-$BRANCH"
REPO=https://github.com/pugarte7/spanish-top-tech-companies.git

main() {
  local logs="$HOME/Library/Logs/spanish-top-tech-companies"
  mkdir -p "$logs"
  exec >>"$logs/weekly-$BRANCH.log" 2>&1
  echo "=== $(date '+%F %T')"
  trap 'osascript -e "display notification \"See ~/Library/Logs/spanish-top-tech-companies/weekly-'"$BRANCH"'.log\" with title \"Website salary refresh failed\""' ERR

  # Right after waking from sleep the network can take a while to come back.
  for _ in {1..20}; do curl -sfo /dev/null https://github.com && break; sleep 30; done

  [ -d "$CLONE/.git" ] || git clone -q --branch "$BRANCH" "$REPO" "$CLONE"
  cd "$CLONE"
  git fetch -q origin "$BRANCH"
  git reset -q --hard "origin/$BRANCH"
  python3 scripts/fetch_taxonomy.py
  python3 scripts/fetch_spain.py --delay 3.0
  python3 scripts/fetch_company.py --missing --delay 3.0
  python3 scripts/fetch_radar.py
  python3 tests/test_pipeline.py
  python3 scripts/validate.py
  python3 scripts/build.py
  git add README.md companies.csv scripts/taxonomy.py
  if git diff --cached --quiet; then
    echo "Nothing changed."
    return
  fi
  git commit -q -m "Refresh salaries $(date -u +%F)"
  git push -q origin "HEAD:$BRANCH"
}

# On one line so bash has read it before `git reset` can rewrite this file.
main "$@"; exit $?
