#!/usr/bin/env bash
# env — process.env confined to the validated env module
set -euo pipefail
command -v npx >/dev/null 2>&1 || { echo "eslint not installed. Install: npm i -D eslint" >&2; exit 3; }
{ command -v eslint >/dev/null 2>&1 || [ -d node_modules/eslint ]; } || {
  echo "eslint not installed. Install: npm i -D eslint" >&2; exit 3; }
exec npx eslint . --rule 'no-process-env: error' -f json \
  | node -e 'const r=JSON.parse(require("fs").readFileSync(0,"utf8")||"[]");const v=r.flatMap(f=>(f.messages||[]).filter(m=>m.ruleId==="no-process-env").map(m=>`${f.filePath}:${m.line}`));if(v.length){console.error(v.join("\n"));process.exit(1)}'
