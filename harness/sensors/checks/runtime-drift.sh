#!/usr/bin/env bash
# runtime-drift — compare trace edges to import graph
set -euo pipefail
TRACE="${HARNESS_ROOT}/harness/state/traces/calls.json"
[ -f "$TRACE" ] || {
  echo "no trace source at harness/state/traces/calls.json. Wire OpenTelemetry first" >&2; exit 3; }
node -e 'const c=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));const d=(c.edges||[]).filter(e=>e.inImportGraph===false);if(d.length){console.error("runtime edges with no import:\n"+d.map(e=>e.from+" → "+e.to).join("\n"));process.exit(1)}' "$TRACE"
