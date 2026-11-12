---
name: write-an-adr
description: Use when a unit makes a decision that outlives the unit (boundary, contract shape, storage).
---

Ask one question at a time. Write nothing before the answers.

1. What decision has to stay true after this unit?
2. Which paths does it constrain?
3. Does it replace an accepted ADR, or is it only related?

After those answers:

1. Copy `docs/adr/TEMPLATE.md` to `docs/adr/NNNN-kebab-title.md` (next free number).
2. Fill frontmatter (`id`, `title`, `status`, `date`, `tags`, `touches`, `supersedes`, `superseded-by`).
3. Fill body sections, especially **How the agent applies this**.
4. Run `node scripts/build-adr-index.mjs` and commit the regenerated `docs/adr/README.md`.
5. Never edit an `accepted` ADR in place. Supersede with a new ADR instead.
