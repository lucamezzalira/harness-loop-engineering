---
description: Ensures environment variables are validated at boot rather than read inline
globs:
  - services/**
  - examples/two-services/services/**
alwaysApply: false
---

# Env validated at boot

When service code needs configuration from the environment, the system shall
read and validate it at boot in `config/env.js` (or `.mjs`) and never call
`process.env` inline in handlers, because inline reads skip validation and fail
late in production traffic.

## Signals of violation

- `process.env.FOO` inside `src/`, handlers, or consumers
- New env keys used in code but missing from the boot validator
- Defaults applied at call sites instead of in `config/env.js`

## How to satisfy it

Add the key to `config/env.js` with validation, export a typed config object,
and import that object from service code. Prefer the env-declared sensor to
catch undeclared keys.
