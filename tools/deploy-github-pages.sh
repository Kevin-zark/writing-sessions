#!/usr/bin/env bash
# Needs an authenticated gh (gh auth login). Creates a public repo, pushes, enables Pages from main:/ .
set -euo pipefail
cd "$(dirname "$0")/.."
gh repo create writing-sessions --public --source=. --remote=origin --push
OWNER=$(gh api user -q .login)
gh api -X POST "repos/$OWNER/writing-sessions/pages" -f 'source[branch]=main' -f 'source[path]=/'
echo "Live (after ~1 min): https://$OWNER.github.io/writing-sessions/"
