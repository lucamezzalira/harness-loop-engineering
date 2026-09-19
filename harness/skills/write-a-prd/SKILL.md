---
name: write-a-prd
description: Use when capturing a new product requirement before planning.
---

1. Copy `harness/templates/prd.md` to `specs/<slug>/PRD.md`.
2. Fill problem, users, behaviour, non-goals, and acceptance criteria ids (A-01…).
3. Do not invent implementation detail that belongs in an ADR.
4. Run `./verify.sh --plan` when ready to decompose.
