#!/usr/bin/env bash
# format — prettier --check on changed files or .
set -euo pipefail
command -v npx >/dev/null 2>&1 || { echo "prettier not installed. Install: npm i -D prettier" >&2; exit 3; }
{ command -v prettier >/dev/null 2>&1 || [ -d node_modules/prettier ]; } || {
  echo "prettier not installed. Install: npm i -D prettier" >&2; exit 3; }
FILES=$(printf '%s\n' "${HARNESS_CHANGED_FILES:-}" | grep -E '\.(js|mjs|cjs|ts|tsx|json|md|yml|yaml)$' || true)
if [ -z "$FILES" ]; then
  exec npx prettier --check .
fi
printf '%s\n' "$FILES" | xargs npx prettier --check
