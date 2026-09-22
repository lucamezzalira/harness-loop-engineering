#!/usr/bin/env bash
# lint — eslint on changed files or .
set -euo pipefail
command -v npx >/dev/null 2>&1 || { echo "eslint not installed. Install: npm i -D eslint" >&2; exit 3; }
{ command -v eslint >/dev/null 2>&1 || [ -d node_modules/eslint ]; } || {
  echo "eslint not installed. Install: npm i -D eslint" >&2; exit 3; }
mapfile -t FILES < <(printf '%s\n' "${HARNESS_CHANGED_FILES:-}" | grep -E '\.(js|mjs|cjs|ts|tsx)$' || true)
if [ "${#FILES[@]}" -eq 0 ] || [ -z "${FILES[0]:-}" ]; then
  exec npx eslint . -f json >/dev/null
fi
exec npx eslint "${FILES[@]}" -f json >/dev/null
