#!/usr/bin/env bash
# types — tsc --allowJs --checkJs --noEmit, ratcheted by baseline.typesErrors
set -euo pipefail
command -v npx >/dev/null 2>&1 || { echo "tsc not installed. Install: npm i -D typescript" >&2; exit 3; }
{ command -v tsc >/dev/null 2>&1 || [ -d node_modules/typescript ]; } || {
  echo "tsc not installed. Install: npm i -D typescript" >&2; exit 3; }
OUT=$(npx tsc --allowJs --checkJs --noEmit --pretty false 2>&1 || true)
node -e 'const o=process.argv[1]||"";const n=(o.match(/error TS/g)||[]).length;const b=JSON.parse(process.env.HARNESS_BASELINE_JSON||"{}");const cap=b.typesErrors;if(!n)process.exit(0);if(cap!=null&&n<=Number(cap)){console.log("types: "+n+" (baseline "+cap+")");process.exit(0)}console.error(o);process.exit(1)' "$OUT"
