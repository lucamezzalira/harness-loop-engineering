/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: 'no-circular',
      severity: 'error',
      from: {},
      to: { circular: true },
    },
    {
      name: 'subscription-must-not-import-email',
      comment: 'subscription-service may depend only on packages/contracts, not on email-service.',
      severity: 'error',
      from: { path: '^services/subscription-service' },
      to: { path: '^services/email-service' },
    },
    {
      name: 'email-must-not-import-subscription',
      comment:
        'email-service may depend only on packages/contracts, not on subscription-service internals.',
      severity: 'error',
      from: { path: '^services/email-service' },
      to: { path: '^services/subscription-service' },
    },
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    tsPreCompilationDeps: true,
    baseDir: __dirname,
  },
}
