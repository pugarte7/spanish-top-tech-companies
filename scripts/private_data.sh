#!/bin/bash
# The private files beside companies.csv (lib.DATA): the CSV itself,
# global.json, feed.json, usage.csv and contacts.json. They live
# encrypted in the private repo pugarte7/spanish-top-tech-companies-data so the Monday refresh can run
# on GitHub Actions (refresh.yml) and the Mac can still edit them by hand.
#
#   scripts/private_data.sh pull   # private repo -> files beside lib.DATA
#   scripts/private_data.sh push   # files -> private repo, as one new commit
#   scripts/private_data.sh log    # print the last refresh's log
#   scripts/private_data.sh log-push FILE   # keep FILE as that log (refresh.yml)
#   scripts/private_data.sh history         # one line per workflow run, oldest first
#   scripts/private_data.sh history-push FILE [LOG RUN]   # add FILE's lines to it, and keep
#                                           # LOG as failed run RUN's log (history.yml)
#   scripts/private_data.sh failed [RUN]    # the failed runs with a log kept, or one's log
#
# Encrypted with AES-256 (openssl, PBKDF2) under DATA_KEY: the env variable
# on Actions, the login Keychain on the Mac (service spanish-top-tech-companies,
# account data-key). A private repo alone would hand every row to anyone who
# ever gets read access to it.
#
# push refuses when the private repo moved since this machine's last pull:
# the refresh writes it every Monday, and a push from a stale copy would undo
# that week. pull, edit, push.
set -Eeuo pipefail

REPO="${STC_PRIVATE_REPO:-git@github.com:pugarte7/spanish-top-tech-companies-data.git}"
FILES=(companies.csv global.json feed.json usage.csv contacts.json)
BLOB=data.tar.gz.enc
# What a refresh on Actions printed: its public log shows only which steps
# passed, since the scripts' output names companies, counts and sources.
LOG=logs/latest.log.enc
# One JSON line per workflow run (scripts/run_summary.py): counts only, so it
# is kept as it is.
HISTORY=logs/history.jsonl
# The end of what a failed run's failed steps printed, one file per run.
FAILED=logs/failed

csv="${STC_DATA:-$HOME/.local/share/spanish-top-tech-companies-data/website/companies.csv}"
dir="$(dirname "$csv")"
clone="$(dirname "$dir")/private-repo"
pulled="$clone/.git/pulled"

key() {
  if [ -n "${DATA_KEY:-}" ]; then return; fi
  DATA_KEY="$(security find-generic-password -s spanish-top-tech-companies -a data-key -w 2>/dev/null)" \
    || { echo "No DATA_KEY and none in the Keychain (account data-key)." >&2; exit 1; }
  export DATA_KEY
}

crypt() { openssl enc -aes-256-cbc -pbkdf2 -iter 600000 -md sha256 -pass env:DATA_KEY "$@"; }

sync_clone() {
  if [ -d "$clone/.git" ]; then
    git -C "$clone" fetch -q origin
  else
    mkdir -p "$(dirname "$clone")"
    git clone -q "$REPO" "$clone"
  fi
}

# history.yml may add its line between the fetch and the push: its commit
# touches another file, so the push goes on top of it. Anything else there
# conflicts and stops, as before.
push_main() {
  git -C "$clone" push -q origin main 2> /dev/null && return
  git -C "$clone" pull -q --rebase origin main || { git -C "$clone" rebase --abort; return 1; }
  git -C "$clone" push -q origin main
}

remote_head() { git -C "$clone" rev-parse -q --verify origin/main || true; }
# The last commit that changed the data; log commits in between do not count.
data_head() { git -C "$clone" log -1 --format=%H origin/main -- "$BLOB" 2>/dev/null || true; }

pull() {
  key
  sync_clone
  local head
  head="$(remote_head)"
  [ -n "$head" ] || { echo "The private repo is empty: push first." >&2; exit 1; }
  git -C "$clone" checkout -q -B main "$head"
  mkdir -p "$dir"
  # Whatever this machine had goes to backups/ before it is replaced.
  local saved=()
  for f in "${FILES[@]}"; do [ -f "$dir/$f" ] && saved+=("$f"); done
  if [ ${#saved[@]} -gt 0 ]; then
    mkdir -p "$(dirname "$dir")/backups"
    tar -C "$dir" -czf "$(dirname "$dir")/backups/before-pull-$(date -u +%Y%m%dT%H%M%S).tar.gz" "${saved[@]}"
  fi
  # Whole and readable before a single file is replaced: a wrong key or a cut
  # download must not leave half a CSV.
  local tarball
  tarball="$(mktemp)"
  crypt -d -in "$clone/$BLOB" -out "$tarball"
  tar -tzf "$tarball" > /dev/null
  tar -xzf "$tarball" -C "$dir"
  rm -f "$tarball"
  data_head > "$pulled"
  echo "Pulled $(git -C "$clone" log -1 --format='%h %s')"
}

push() {
  key
  sync_clone
  local head
  head="$(remote_head)"
  if [ -n "$head" ] && [ "$(data_head)" != "$(cat "$pulled" 2>/dev/null)" ]; then
    echo "The private repo moved since the last pull here. Pull, redo the edit, push." >&2
    exit 1
  fi
  [ -f "$csv" ] || { echo "No $csv to push." >&2; exit 1; }
  local present=()
  for f in "${FILES[@]}"; do [ -f "$dir/$f" ] && present+=("$f"); done
  if [ -n "$head" ]; then git -C "$clone" checkout -q -B main "$head"; else git -C "$clone" checkout -q -B main; fi
  tar -C "$dir" -czf - "${present[@]}" | crypt -e -salt -out "$clone/$BLOB"
  git -C "$clone" add "$BLOB"
  git -C "$clone" -c user.name="${GIT_AUTHOR_NAME:-$(git config user.name || echo refresh)}" \
    -c user.email="${GIT_AUTHOR_EMAIL:-$(git config user.email || echo refresh@localhost)}" \
    commit -q -m "Data $(date -u +%F)"
  push_main
  git -C "$clone" rev-parse HEAD > "$pulled"
  echo "Pushed $(git -C "$clone" log -1 --format='%h %s')"
}

log_push() {
  key
  sync_clone
  local head
  head="$(remote_head)"
  if [ -n "$head" ]; then git -C "$clone" checkout -q -B main "$head"; else git -C "$clone" checkout -q -B main; fi
  mkdir -p "$clone/logs"
  crypt -e -salt -in "$1" -out "$clone/$LOG"
  git -C "$clone" add "$LOG"
  git -C "$clone" -c user.name="${GIT_AUTHOR_NAME:-$(git config user.name || echo refresh)}" \
    -c user.email="${GIT_AUTHOR_EMAIL:-$(git config user.email || echo refresh@localhost)}" \
    commit -q -m "Log $(date -u +%F)"
  push_main
  echo "Log kept in the private repo."
}

history_push() {
  sync_clone
  local try
  for try in 1 2 3 4 5; do
    git -C "$clone" fetch -q origin
    git -C "$clone" checkout -q -B main origin/main
    mkdir -p "$clone/logs"
    cat "$1" >> "$clone/$HISTORY"
    git -C "$clone" add "$HISTORY"
    if [ -n "${2:-}" ]; then
      mkdir -p "$clone/$FAILED"
      cp "$2" "$clone/$FAILED/${3:?the run of the log}.log"
      git -C "$clone" add "$FAILED"
    fi
    git -C "$clone" -c user.name="${GIT_AUTHOR_NAME:-$(git config user.name || echo history)}" \
      -c user.email="${GIT_AUTHOR_EMAIL:-$(git config user.email || echo history@localhost)}" \
      commit -q -m "History $(date -u +%F)"
    if git -C "$clone" push -q origin main 2> /dev/null; then echo "History kept."; return; fi
    sleep $((try * 3))
  done
  echo "Could not keep the history." >&2
  exit 1
}

history() {
  sync_clone
  git -C "$clone" show "origin/main:$HISTORY"
}

failed() {
  sync_clone
  if [ -n "${1:-}" ]; then
    git -C "$clone" show "origin/main:$FAILED/$1.log"
  else
    git -C "$clone" ls-tree --name-only "origin/main:$FAILED" 2> /dev/null | sed 's/\.log$//'
  fi
}

log() {
  key
  sync_clone
  git -C "$clone" show "origin/main:$LOG" > "$clone/.git/log.enc"
  crypt -d -in "$clone/.git/log.enc"
  rm -f "$clone/.git/log.enc"
}

case "${1:-}" in
  pull) pull ;;
  push) push ;;
  log) log ;;
  log-push) log_push "${2:?usage: $0 log-push FILE}" ;;
  history) history ;;
  history-push) history_push "${2:?usage: $0 history-push FILE [LOG RUN]}" "${3:-}" "${4:-}" ;;
  failed) failed "${2:-}" ;;
  *) echo "usage: $0 pull|push|log|log-push FILE|history|history-push FILE [LOG RUN]|failed [RUN]" >&2; exit 2 ;;
esac
