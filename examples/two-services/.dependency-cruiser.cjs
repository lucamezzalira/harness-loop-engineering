/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: 'no-service-to-service',
      comment: 'Services may not import another service. Use @acme/contracts only.',
      severity: 'error',
      from: { path: '^services/[^/]+/' },
      to: { path: '^services/[^/]+/', pathNot: '^services/[^/]+/' },
    },
    {
      name: 'no-deep-service-imports',
      comment: 'Disallow importing internals of a sibling service.',
      severity: 'error',
      from: { path: '^services/([^/]+)/' },
      to: {
        path: '^services/',
        pathNot: '^services/$1/',
      },
    },
    {
      name: 'publish-via-contracts-only',
      comment: 'Do not import bus publish helpers from outside contracts publisher usage pattern.',
      severity: 'error',
      from: { path: '^services/' },
      to: {
        path: 'bus/',
        pathNot: 'packages/contracts',
      },
    },
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    tsPreCompilationDeps: false,
  },
};
