#!/usr/bin/env bash
# unit — package test script from config
set -euo pipefail
PM=$(node -e 'const c=JSON.parse(process.env.HARNESS_CONFIG_JSON||"{}");process.stdout.write(c.project?.packageManager||"npm")')
[ -f package.json ] || { echo "no package.json / test runner detected" >&2; exit 3; }
node -e 'const p=require("./package.json");if(!p.scripts?.test)process.exit(3)' 2>/dev/null || {
  echo "no test script. Add scripts.test to package.json" >&2; exit 3; }
case "$PM" in
  pnpm) exec pnpm test ;;
  yarn) exec yarn test ;;
  bun) exec bun test ;;
  *) exec npm test --silent ;;
esac
