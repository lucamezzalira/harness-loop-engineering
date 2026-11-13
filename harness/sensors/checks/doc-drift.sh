#!/usr/bin/env bash
# doc-drift — flags, sensors, roles, skills, config keys, and links
set -euo pipefail
exec node "${HARNESS_ROOT}/harness/lib/checks/doc-drift.mjs"
