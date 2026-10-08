#!/usr/bin/env bash
# unit — scoped package tests from HARNESS_CHANGED_FILES (full suite if unset/empty
# or HARNESS_UNIT_FULL=1)
set -euo pipefail
[ -f package.json ] || { echo "no package.json / test runner detected" >&2; exit 3; }
node -e 'const p=require("./package.json");if(!p.scripts?.test)process.exit(3)' 2>/dev/null || {
  echo "no test script. Add scripts.test to package.json" >&2; exit 3; }

ROOT="${HARNESS_ROOT:-.}"
set +e
out=$(node "$ROOT/harness/lib/checks/scope-tests.mjs" 2>&1)
code=$?
set -e
printf '%s\n' "$out"
# ADR 0003: 3 = tool missing. 127 = command not found. Do not remap test failures (1).
if [ "$code" -eq 3 ] || [ "$code" -eq 127 ]; then
  echo "unit: test runner missing; run npm install at repo root" >&2; exit 3
fi
exit "$code"
