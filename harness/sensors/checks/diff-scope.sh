#!/usr/bin/env bash
# diff-scope — refuse multi-context diffs without an ADR
set -euo pipefail
exec node "${HARNESS_ROOT}/scripts/check-diff-scope.mjs"
