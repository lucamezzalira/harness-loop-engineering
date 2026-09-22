#!/usr/bin/env bash
# session-state — verify per-session harness state is consistent (local only)
set -euo pipefail
if [[ "${HARNESS_ENV:-local}" != "local" ]]; then
  echo "session-state is a local-only sensor; skipping in ${HARNESS_ENV}"
  exit 0
fi
exec node "${HARNESS_ROOT}/scripts/check-session-state.mjs"
