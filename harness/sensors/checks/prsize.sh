#!/usr/bin/env bash
# prsize — git diff --numstat vs threshold
set -euo pipefail
THR=$(node -e 'const c=JSON.parse(process.env.HARNESS_CONFIG_JSON||"{}");process.stdout.write(String(c.verify?.prSizeLines??800))')
git diff --numstat HEAD | awk -v t="$THR" '{a+=$1+$2} END{if(a>t){print "diff is "a" lines; threshold "t > "/dev/stderr"; exit 1} print "diff "a+0" lines (≤ "t")"}'
