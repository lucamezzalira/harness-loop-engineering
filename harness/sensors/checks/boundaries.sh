#!/usr/bin/env bash
# boundaries — service isolation via dependency-cruiser
set -euo pipefail
command -v npx >/dev/null 2>&1 || {
  echo "dependency-cruiser not installed. Install: npm i -D dependency-cruiser" >&2; exit 3; }
{ command -v depcruise >/dev/null 2>&1 || [ -d node_modules/dependency-cruiser ]; } || {
  echo "dependency-cruiser not installed. Install: npm i -D dependency-cruiser" >&2; exit 3; }
CFG="$(ls .dependency-cruiser.cjs .dependency-cruiser.js 2>/dev/null | head -1)" || true
[ -n "${CFG:-}" ] || { echo "no dependency-cruiser config. Run: npx depcruise --init" >&2; exit 3; }
GLOB=$(node -e 'const c=JSON.parse(process.env.HARNESS_CONFIG_JSON||"{}");process.stdout.write(c.project?.servicesGlob||"services")')
exec npx depcruise --config "$CFG" --validate -- ${GLOB%%/\*} src services 2>/dev/null || \
  exec npx depcruise --config "$CFG" --validate -- services
