#!/usr/bin/env bash
# protected-change — CI gate for protected paths and human-required lines
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
exec node "$here/../../lib/checks/protected-change.mjs"
