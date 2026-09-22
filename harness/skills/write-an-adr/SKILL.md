---
name: write-an-adr
description: Use when a unit makes a decision that outlives the unit (boundary, contract shape, storage).
---

1. Copy `docs/adr/TEMPLATE.md` to `docs/adr/NNNN-kebab-title.md` (next free number).
2. Fill frontmatter (`id`, `title`, `status`, `date`, `tags`, `touches`, `supersedes`, `superseded-by`).
3. Fill body sections, especially **How the agent applies this**.
4. Run `node scripts/build-adr-index.mjs` and commit the regenerated `docs/adr/README.md`.
5. Never edit an `accepted` ADR in place; supersede with a new ADR instead.
