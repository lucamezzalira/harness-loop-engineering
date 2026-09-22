---
description: Ensures each package states ESM or CJS explicitly and stays consistent
globs:
  - "**/package.json"
  - "**/*.{js,mjs,cjs}"
alwaysApply: false
---

# Declare the module system

When adding or editing a Node package, the system shall state the module system
explicitly (ESM via `"type": "module"` / `.mjs`, or CJS via `.cjs` / no type) and
keep imports consistent with it, because mixed module systems are the most common
agent failure and break at runtime rather than at edit time.

## Signals of violation

- `require()` inside a `"type": "module"` package without a `.cjs` boundary
- `import` in a CJS package without a defined ESM bridge
- New files that omit extension or package `type` while neighbours disagree

## How to satisfy it

Set `"type": "module"` for ESM packages (this repo's default) or use `.cjs` for
CJS islands. Match existing import style in the package; do not mix in one tree.
