#!/usr/bin/env bash
# contracts — depcruise publisher ruleset
set -euo pipefail
PKG=$(node -e 'const c=JSON.parse(process.env.HARNESS_CONFIG_JSON||"{}");process.stdout.write(c.project?.contractsPackage||"")')
[ -n "$PKG" ] || { echo "no contractsPackage in harness.yaml" >&2; exit 3; }
export P="$PKG"
node -e 'const fs=require("fs"),p="packages",n=process.env.P;if(!fs.existsSync(p))process.exit(3);let ok=0;for(const d of fs.readdirSync(p)){try{if(JSON.parse(fs.readFileSync(p+"/"+d+"/package.json","utf8")).name===n)ok=1}catch{}}process.exit(ok?0:3)' || {
  echo "contracts package $PKG not found on disk" >&2; exit 3; }
command -v npx >/dev/null 2>&1 || { echo "dependency-cruiser not installed" >&2; exit 3; }
CFG="$(ls .dependency-cruiser.cjs .dependency-cruiser.js 2>/dev/null | head -1)" || true
[ -n "${CFG:-}" ] || { echo "no dependency-cruiser config (contracts rules live there)" >&2; exit 3; }
exec npx depcruise --config "$CFG" --validate -- services packages
