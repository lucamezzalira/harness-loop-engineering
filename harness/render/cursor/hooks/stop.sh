#!/usr/bin/env bash
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
export HARNESS_TOOL="${HARNESS_TOOL:-cursor}"
export HARNESS_HOOK_MOMENT=stop
exec "$ROOT/verify.sh" --hook
