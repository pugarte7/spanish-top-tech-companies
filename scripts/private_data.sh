#!/bin/bash
# The private files beside companies.csv (lib.DATA): the CSV itself,
# global.json, feed.json and usage.csv. They live encrypted in the private
# repo pugarte7/spanish-top-tech-companies-data so the Monday refresh can run
# on GitHub Actions (refresh.yml) and the Mac can still edit them by hand.
#
#   scripts/private_data.sh pull   # private repo -> files beside lib.DATA
#   scripts/private_data.sh push   # files -> private repo, as one new commit
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
FILES=(companies.csv global.json feed.json usage.csv)
BLOB=data.tar.gz.enc

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

remote_head() { git -C "$clone" rev-parse -q --verify origin/main || true; }

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
  echo "$head" > "$pulled"
  echo "Pulled $(git -C "$clone" log -1 --format='%h %s')"
}

push() {
  key
  sync_clone
  local head
  head="$(remote_head)"
  if [ -n "$head" ] && [ "$head" != "$(cat "$pulled" 2>/dev/null)" ]; then
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
  git -C "$clone" push -q origin main
  git -C "$clone" rev-parse HEAD > "$pulled"
  echo "Pushed $(git -C "$clone" log -1 --format='%h %s')"
}

case "${1:-}" in
  pull) pull ;;
  push) push ;;
  *) echo "usage: $0 pull|push" >&2; exit 2 ;;
esac
