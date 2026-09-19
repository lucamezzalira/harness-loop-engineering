#!/usr/bin/env bash
# verify.sh — sole public entry point for the harness.
# Flags select the action. Configuration supplies every parameter. No flag takes a value.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
export HARNESS_ROOT="$ROOT"

if [[ -z "${HARNESS_IN_HOOK:-}" ]]; then
  export HARNESS_IN_HOOK=0
fi

exec node "$ROOT/harness/lib/cli.mjs" "$@"
