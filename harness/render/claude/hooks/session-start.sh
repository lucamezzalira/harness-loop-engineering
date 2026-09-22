#!/usr/bin/env bash
# Thin Claude adapter: SessionStart → verify.sh --hook
set -euo pipefail

find_root() {
  local dir
  dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  while [[ "$dir" != "/" ]]; do
    if [[ -x "$dir/verify.sh" && -d "$dir/harness" ]]; then
      echo "$dir"
      return 0
    fi
    dir="$(dirname "$dir")"
  done
  echo "harness hook: could not find verify.sh above $(dirname "${BASH_SOURCE[0]}")" >&2
  exit 2
}

ROOT="$(find_root)"
export HARNESS_ROOT="$ROOT"
export HARNESS_IN_HOOK=1
export HARNESS_TOOL="${HARNESS_TOOL:-claude}"
export HARNESS_HOOK_MOMENT=SessionStart
exec "$ROOT/verify.sh" --hook
