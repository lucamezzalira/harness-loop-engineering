#!/usr/bin/env bash
# Example init: confirm the newsletter unit suite still runs.
# Safe at the start of every session. Does not install packages.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"
if [[ ! -f package.json ]]; then
  echo "init: package.json missing" >&2
  exit 2
fi
npx --no-install vitest run examples/10-newsletter/newsletter.test.ts
