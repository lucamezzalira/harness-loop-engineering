# Node rules

- State the module system explicitly (ESM or CJS). Mixing them is the most common agent failure.
- Honour `engines.node` from package.json; do not use APIs below that floor.
- No synchronous filesystem calls on a request path.
- Every environment variable is validated at boot in `config/env.js` (or `.mjs`); never read `process.env` inline in service code.
- Structured logging only in service code (no ad-hoc `console.log` for request data).
