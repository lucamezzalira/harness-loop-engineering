#!/usr/bin/env bash
# rule-shape — enforce Cursor-shaped rule contract under harness/render/rules/
set -euo pipefail
exec node "${HARNESS_ROOT}/scripts/check-rule-shape.mjs"
