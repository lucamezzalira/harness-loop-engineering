#!/usr/bin/env bash
# Thin Cursor adapter: language-agnostic. Only depends on verify.sh.
# Moment is injected via env so we never parse JSON here (no jq required).
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
export HARNESS_ROOT="$ROOT"
export HARNESS_IN_HOOK=1
export HARNESS_TOOL="${HARNESS_TOOL:-cursor}"
export HARNESS_HOOK_MOMENT="${HARNESS_HOOK_MOMENT:-sessionStart}"
exec "$ROOT/verify.sh" --hook
