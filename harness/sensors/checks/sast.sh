#!/usr/bin/env bash
# sast — semgrep --config auto --error
set -euo pipefail
command -v semgrep >/dev/null 2>&1 || {
  echo "semgrep not installed. Install: pipx install semgrep (or brew install semgrep)" >&2; exit 3; }
exec semgrep --config auto --error
