#!/usr/bin/env bash
# complexity — eslint complexity rule on changed files
set -euo pipefail
command -v npx >/dev/null 2>&1 || { echo "eslint not installed. Install: npm i -D eslint" >&2; exit 3; }
{ command -v eslint >/dev/null 2>&1 || [ -d node_modules/eslint ]; } || {
  echo "eslint not installed. Install: npm i -D eslint" >&2; exit 3; }
mapfile -t FILES < <(printf '%s\n' "${HARNESS_CHANGED_FILES:-}" | grep -E '\.(js|mjs|cjs|ts|tsx)$' || true)
[ "${#FILES[@]}" -gt 0 ] && [ -n "${FILES[0]:-}" ] || { echo "no matching files"; exit 0; }
N=$(node -e 'const b=JSON.parse(process.env.HARNESS_BASELINE_JSON||"{}");const d=15;process.stdout.write(String(b.maxComplexity!=null?Math.max(d,b.maxComplexity):d))')
OUT=$(npx eslint "${FILES[@]}" --rule "complexity: [error, $N]" -f json 2>/dev/null || true)
node -e 'const r=JSON.parse(process.argv[1]||"[]");const v=r.flatMap(f=>(f.messages||[]).filter(m=>m.ruleId==="complexity").map(m=>f.filePath+":"+m.line+" "+m.message));if(v.length){console.error(v.join("\n"));process.exit(1)}' "$OUT"
