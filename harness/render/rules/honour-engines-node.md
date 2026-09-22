---
description: Ensures code uses only Node APIs available at the package engines floor
globs:
  - "**/package.json"
  - "**/*.{js,mjs,cjs}"
alwaysApply: false
---

# Honour engines.node

When writing Node code, the system shall use only APIs supported by
`engines.node` in the nearest package.json, because calling newer APIs fails in
CI and on developer machines that match the declared floor.

## Signals of violation

- Use of APIs introduced after the declared `engines.node` minimum
- Lowering `engines.node` in package.json without checking callers
- Docs or comments that assume a newer runtime than `engines.node`

## How to satisfy it

Read `engines.node` (repo root requires `>=20`). Prefer APIs stable on that
floor. If you need a newer API, raise `engines.node` in the same change and
update CI.
