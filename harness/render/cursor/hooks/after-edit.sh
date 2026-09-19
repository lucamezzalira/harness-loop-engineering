#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
export HARNESS_ROOT="$ROOT"
export HARNESS_IN_HOOK=1
export HARNESS_TOOL="${HARNESS_TOOL:-cursor}"
export HARNESS_HOOK_MOMENT=afterFileEdit
exec "$ROOT/verify.sh" --hook
