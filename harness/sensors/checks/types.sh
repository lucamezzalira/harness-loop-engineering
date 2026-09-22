#!/usr/bin/env bash
# types — tsc --allowJs --checkJs --noEmit
set -euo pipefail
command -v npx >/dev/null 2>&1 || { echo "tsc not installed. Install: npm i -D typescript" >&2; exit 3; }
{ command -v tsc >/dev/null 2>&1 || [ -d node_modules/typescript ]; } || {
  echo "tsc not installed. Install: npm i -D typescript" >&2; exit 3; }
exec npx tsc --allowJs --checkJs --noEmit --pretty false
