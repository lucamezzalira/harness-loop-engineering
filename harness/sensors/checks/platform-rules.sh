#!/usr/bin/env bash
# platform-rules — compare the default branch ruleset with harness.yaml
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
exec node "$here/../../lib/checks/platform-rules.mjs"
