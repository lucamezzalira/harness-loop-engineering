#!/usr/bin/env bash
# duplication — jscpd against baseline threshold
set -euo pipefail
command -v npx >/dev/null 2>&1 || { echo "jscpd not installed. Install: npm i -D jscpd" >&2; exit 3; }
{ command -v jscpd >/dev/null 2>&1 || [ -d node_modules/jscpd ]; } || {
  echo "jscpd not installed. Install: npm i -D jscpd" >&2; exit 3; }
OUT=$(npx jscpd . --silent --reporters json 2>/dev/null || true)
node -e 'const b=JSON.parse(process.env.HARNESS_BASELINE_JSON||"{}");let j={};try{j=JSON.parse(process.argv[1]||"{}")}catch{}const c=j.statistics?.total?.clones??j.duplicates?.length??0;const bl=b.duplicatedBlocks;if(bl!=null&&c>bl){console.error(`duplicated blocks ${c} > baseline ${bl}`);process.exit(1)}' "$OUT"
