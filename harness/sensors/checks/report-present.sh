#!/usr/bin/env bash
# report-present — a fully passing spec needs a PASS report
set -euo pipefail
exec node "${HARNESS_ROOT}/harness/lib/checks/report-present.mjs"
