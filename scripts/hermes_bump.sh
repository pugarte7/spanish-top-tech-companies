#!/usr/bin/env bash
# Moves the Hermes plugin catalog's pin to this commit.
#
# The catalog (NousResearch/hermes-agent, plugin-catalog/) installs
# hermes-plugin/ at an exact commit, so a change there reaches Hermes users
# only through a pull request that moves the pin. This opens that pull request
# from the owner's fork, or updates the one already open: one at a time, since
# their maintainers review every one.
#
# Needs GH_TOKEN, a token of the plugin's owner that can push to the fork and
# open pull requests (classic: public_repo and workflow). DRY_RUN=1 prints the
# entry it would send and changes nothing.
set -euo pipefail

upstream="NousResearch/hermes-agent"
owner="${GITHUB_REPOSITORY_OWNER:?}"
fork="$owner/hermes-agent"
entry="plugin-catalog/spanish-top-tech-companies.yaml"
branch="bump-spanish-top-tech-companies"
new="${GITHUB_SHA:?}"

gh api "repos/$upstream/contents/$entry" --jq .content | base64 -d > entry.yaml
old="$(sed -n 's/^sha: *//p' entry.yaml)"
if ! [[ "$old" =~ ^[0-9a-f]{40}$ ]]; then echo "the catalog entry has no pin" >&2; exit 1; fi

if git diff --quiet "$old" "$new" -- hermes-plugin; then
  echo "hermes-plugin/ is the same at $old and $new: nothing to move"
  exit 0
fi

version="$(jq -r .version hermes-plugin/plugin.json)"
sed -i.bak -e "s/$old/$new/g" -e "s/^version: .*/version: \"$version\"/" entry.yaml && rm entry.yaml.bak
title="chore(plugin-catalog): bump spanish-top-tech-companies to $version"
body="Moves the pin from \`$old\` to \`$new\`; the card image and \`docs_url\` follow it. I own the plugin repo.

Changed under \`hermes-plugin/\` in that range:

\`\`\`
$(git diff --stat "$old" "$new" -- hermes-plugin)
\`\`\`

Range: https://github.com/${GITHUB_REPOSITORY:?}/compare/$old...$new

Still configuration only (\`plugin.json\`, \`mcp.json\` and the skill): no code, hooks, middleware or env vars, so \`capabilities\` stays empty and the disclosures in the entry hold.

Opened by the plugin repo's own workflow when \`hermes-plugin/\` changes."

if [ -n "${DRY_RUN:-}" ]; then
  echo "$title"; echo; echo "$body"; echo; cat entry.yaml
  exit 0
fi

gh repo sync "$fork" --source "$upstream" --branch main
base="$(gh api "repos/$fork/commits/main" --jq .sha)"
# One commit on top of the fork's main, then the branch moved to it in one step:
# resetting the branch to main first leaves an open pull request with no diff,
# and GitHub closes it.
tree="$(gh api "repos/$fork/git/trees" -f base_tree="$base" -f "tree[][path]=$entry" -f "tree[][mode]=100644" \
  -f "tree[][type]=blob" -f "tree[][content]=$(cat entry.yaml)" --jq .sha)"
commit="$(gh api "repos/$fork/git/commits" -f message="$title" -f tree="$tree" -f "parents[]=$base" --jq .sha)"
gh api -X PATCH "repos/$fork/git/refs/heads/$branch" -f sha="$commit" -F force=true >/dev/null 2>&1 ||
  gh api "repos/$fork/git/refs" -f ref="refs/heads/$branch" -f sha="$commit" >/dev/null

# Through the API: this repository's release-label hook reads any pull request
# opened from a shell as one of its own.
open="$(gh api "repos/$upstream/pulls?state=open&head=$owner:$branch" --jq '.[0].number // empty')"
if [ -n "$open" ]; then
  gh api -X PATCH "repos/$upstream/pulls/$open" -f title="$title" -f body="$body" --jq .html_url
else
  gh api "repos/$upstream/pulls" -f title="$title" -f body="$body" -f head="$owner:$branch" -f base=main --jq .html_url
fi
