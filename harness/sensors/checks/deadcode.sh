#!/usr/bin/env bash
# deadcode — knip
set -euo pipefail
command -v npx >/dev/null 2>&1 || { echo "knip not installed. Install: npm i -D knip" >&2; exit 3; }
{ command -v knip >/dev/null 2>&1 || [ -d node_modules/knip ]; } || {
  echo "knip not installed. Install: npm i -D knip" >&2; exit 3; }
exec npx knip
