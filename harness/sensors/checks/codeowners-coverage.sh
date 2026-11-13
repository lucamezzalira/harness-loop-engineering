#!/usr/bin/env bash
# codeowners-coverage — every protected glob has a CODEOWNERS owner
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
exec node "$here/../../lib/checks/codeowners-coverage.mjs"
