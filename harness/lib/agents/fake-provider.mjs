/**
 * Offline fake provider for tests. Selected by HARNESS_FAKE_PROVIDER=1.
 * Returns canned JSON and fixed token counts (or no usage when HARNESS_FAKE_NO_USAGE=1).
 */
import fs from 'node:fs';
import path from 'node:path';

const PLAN_JSON = {
  prd: 'specs/example-idempotent-consumers/PRD.md',
  units: [
    {
      id: 'U1',
      title: 'Add idempotencyKey to order.confirmed contract',
      touches: ['examples/two-services/packages/contracts'],
      dependsOn: [],
      acceptance: ['A-01'],
      estimatedTurns: 2,
      contractChange: 'additive',
    },
    {
      id: 'U2',
      title: 'Billing stores processed keys and skips duplicates',
      touches: ['examples/two-services/services/billing'],
      dependsOn: ['U1'],
      acceptance: ['A-01', 'A-02'],
      estimatedTurns: 3,
      contractChange: 'none',
    },
    {
      id: 'U3',
      title: 'Confirm boundary: billing does not import orders',
      touches: ['examples/two-services'],
      dependsOn: ['U2'],
      acceptance: ['A-03'],
      estimatedTurns: 1,
      contractChange: 'none',
    },
  ],
  waves: [['U1'], ['U2'], ['U3']],
  sharedDecisions: ['ADR 0001 service boundaries'],
  contextRisk: 'low',
};

/** Fixed usage when usage is reported. */
export const FAKE_USAGE = Object.freeze({
  inputTokens: 100,
  outputTokens: 50,
  costUsd: 0.01,
  estimated: false,
});

/**
 * @param {{ binding: object, systemPrompt: string, userPrompt: string, expect: string }} opts
 */
export async function invokeFake(opts) {
  const role = opts.binding?.role || 'unknown';
  const noUsage = process.env.HARNESS_FAKE_NO_USAGE === '1';
  let data;
  let text;

  if (role === 'planner' || /decompos/i.test(opts.userPrompt || '')) {
    data = PLAN_JSON;
    text = JSON.stringify(data);
  } else if (role === 'integrity-checker') {
    data = integrityVerdict(opts.systemPrompt, opts.userPrompt);
    text = JSON.stringify(data);
  } else if (/Harness retro/i.test(`${opts.systemPrompt || ''}\n${opts.userPrompt || ''}`)) {
    text = [
      '1. Add a format guidance line. Evidence: format failed twice.',
      '2. Tighten the stall note. Evidence: one stall.',
      '3. Record needs-human in the handoff template. Evidence: one needs-human unit.',
      '4. This fourth item must be dropped.',
    ].join('\n');
    data = text;
  } else {
    writeFakeFile(opts.userPrompt || '');
    if (process.env.HARNESS_FAKE_FINDINGS) {
      data = JSON.parse(process.env.HARNESS_FAKE_FINDINGS);
      text = process.env.HARNESS_FAKE_FINDINGS;
    } else {
      data = [];
      text = '[]';
    }
  }

  const usage = noUsage
    ? { inputTokens: 0, outputTokens: 0, costUsd: 0, estimated: true }
    : { ...FAKE_USAGE };

  return {
    ok: true,
    text,
    data: opts.expect === 'json' ? data : text,
    usage,
    estimated: Boolean(noUsage || usage.estimated),
    path: 'fake',
  };
}

/**
 * The integrity-checker prompt names `check-weakened`. A fixture diff that
 * deletes a test file is that category. Anything else is a pass.
 */
function integrityVerdict(systemPrompt, userPrompt) {
  const knows = /check-weakened/.test(systemPrompt || '');
  const file = knows ? deletedTestPath(userPrompt) : null;
  if (!file) return { verdict: 'PASS', findings: [] };
  return {
    verdict: 'FAIL',
    findings: [
      {
        category: 'check-weakened',
        file,
        line: 1,
        message: 'test file removed',
      },
    ],
  };
}

function writeFakeFile(userPrompt) {
  const spec = process.env.HARNESS_FAKE_WRITE || '';
  const root = process.env.HARNESS_FAKE_ROOT || '';
  if (!spec || !root) return;
  const eq = spec.indexOf('=');
  if (eq < 0) return;
  const id = spec.slice(0, eq);
  const rel = spec.slice(eq + 1);
  if (!userPrompt.includes(`Continue unit ${id}`)) return;
  const dest = path.join(root, rel);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, 'export const login = () => true;\n');
}

function deletedTestPath(diff) {
  const chunks = String(diff || '')
    .split(/^diff --git /m)
    .slice(1);
  for (const chunk of chunks) {
    const header = chunk.split('\n')[0] || '';
    const match = header.match(/^a\/(\S+)/);
    if (!match) continue;
    const file = match[1];
    if (!/\.test\.(?:mjs|js|cjs|ts|tsx)$/.test(file)) continue;
    if (/^deleted file mode /m.test(chunk)) return file;
  }
  return null;
}
