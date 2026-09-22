#!/usr/bin/env bash
# secrets — gitleaks protect --staged
set -euo pipefail
command -v gitleaks >/dev/null 2>&1 || {
  echo "gitleaks not installed. Install: https://github.com/gitleaks/gitleaks#installing" >&2; exit 3; }
exec gitleaks protect --staged --no-banner
