import fs from 'node:fs';
import path from 'node:path';

/**
 * Manual tier: compare observed call graph from traces against import graph.
 * Skips without a trace source. Ships OTEL wiring notes in guidance.
 */
export async function run({ root }) {
  const traceFile = path.join(root, 'harness', 'state', 'traces', 'calls.json');
  if (!fs.existsSync(traceFile)) {
    return {
      status: 'skipped',
      reason:
        'no trace source at harness/state/traces/calls.json. Wire OpenTelemetry and run examples/two-services/scripts/smoke-runtime-drift.sh',
    };
  }
  const calls = JSON.parse(fs.readFileSync(traceFile, 'utf8'));
  const edges = calls.edges || [];
  const drift = edges.filter((e) => e.inImportGraph === false);
  if (drift.length) {
    return {
      status: 'fail',
      exitCode: 1,
      output:
        'runtime edges with no import (likely HTTP coupling):\n' +
        drift.map((e) => `${e.from} → ${e.to}`).join('\n'),
    };
  }
  return { status: 'pass', exitCode: 0, output: 'runtime graph matches imports' };
}
