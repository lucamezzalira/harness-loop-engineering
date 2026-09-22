#!/usr/bin/env bash
# audit — package manager audit high+
set -euo pipefail
PM=$(node -e 'const c=JSON.parse(process.env.HARNESS_CONFIG_JSON||"{}");process.stdout.write(c.project?.packageManager||"npm")')
command -v "$PM" >/dev/null 2>&1 || { echo "$PM not available for audit" >&2; exit 3; }
case "$PM" in
  pnpm) exec pnpm audit --audit-level high ;;
  yarn) exec yarn npm audit --level high ;;
  bun) exec bun pm audit --level high ;;
  *) exec npm audit --audit-level=high ;;
esac
