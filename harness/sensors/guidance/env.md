# env

## Why this exists

Agents often read `process.env` inline. That skips boot-time validation and hides missing config until a request blows up. Every environment variable must be validated in one module (`config/env.js`); everywhere else is forbidden.

## What to do

1. Move the read into `config/env.js` (or `config/env.mjs`) and export a typed/validated value.
2. Import that export at the call site.
3. Do not add eslint disables for `no-process-env` outside the env module.

## Thresholds

Not applicable. Service code may read the environment only in `config/env.js`. The harness tool, `scripts/`, and tests are outside this sensor.
