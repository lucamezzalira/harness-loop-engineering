#!/usr/bin/env bash
# check-integrity — diff must not weaken or skip checks
set -euo pipefail
exec node "${HARNESS_ROOT}/harness/lib/checks/check-integrity.mjs"
