# env-declared

`.env.example` declares which variables exist (keys only, no values).
`config/env.js` (or `.mjs` / `.ts`) validates them.

Keep both lists in sync:

1. Add the key to `.env.example` with a short comment.
2. Add validation in the allowlisted env module.
3. Never put secrets in `.env.example`.
