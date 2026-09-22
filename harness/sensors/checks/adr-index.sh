#!/usr/bin/env bash
# adr-index — docs/adr/README.md must match build-adr-index.mjs
set -euo pipefail
exec node "${HARNESS_ROOT}/scripts/build-adr-index.mjs" --check
