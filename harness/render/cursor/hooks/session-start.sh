#!/usr/bin/env bash
# Thin Cursor adapter: language-agnostic. Only depends on verify.sh.
# Moment via env; stdin passes through. Walk up to find the repo root
# so the same script works from .cursor/hooks/ or harness/render/cursor/hooks/.
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
export HARNESS_HOOK_MOMENT="${HARNESS_HOOK_MOMENT:-sessionStart}"
exec "$ROOT/verify.sh" --hook
