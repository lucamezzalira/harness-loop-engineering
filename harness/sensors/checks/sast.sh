#!/usr/bin/env bash
# sast — semgrep --config auto --error (CI-only)
set -euo pipefail
if [[ "${HARNESS_ENV:-local}" != "ci" ]]; then
  echo "sast is a CI-only sensor; set HARNESS_ENV=ci to run it here" >&2
  exit 2
fi
command -v semgrep >/dev/null 2>&1 || {
  echo "semgrep not installed. Install: pipx install semgrep (or brew install semgrep)" >&2; exit 3; }
exec semgrep --config auto --error
