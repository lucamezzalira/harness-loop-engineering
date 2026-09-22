#!/usr/bin/env bash
# adr-frontmatter — validate ADR YAML frontmatter and supersession links
set -euo pipefail
exec node "${HARNESS_ROOT}/scripts/check-adr-frontmatter.mjs"
