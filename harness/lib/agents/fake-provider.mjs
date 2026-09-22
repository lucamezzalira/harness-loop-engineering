/**
 * Offline fake provider for tests. Selected by HARNESS_FAKE_PROVIDER=1.
 * Returns canned JSON and fixed token counts (or no usage when HARNESS_FAKE_NO_USAGE=1).
 */

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
  } else {
    data = [];
    text = '[]';
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
