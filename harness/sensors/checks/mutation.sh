#!/usr/bin/env bash
# mutation — stryker on changed files
set -euo pipefail
command -v npx >/dev/null 2>&1 || {
  echo "stryker not installed. Install: npm i -D @stryker-mutator/core" >&2; exit 3; }
{ command -v stryker >/dev/null 2>&1 || [ -d node_modules/@stryker-mutator ]; } || {
  echo "stryker not installed. Install: npm i -D @stryker-mutator/core" >&2; exit 3; }
MUT=$(printf '%s\n' "${HARNESS_CHANGED_FILES:-}" | grep -E '\.(js|mjs|ts)$' | paste -sd, - || true)
[ -n "${MUT:-}" ] || { echo "no changed source files for mutation"; exit 0; }
exec npx stryker run --mutate "$MUT"
