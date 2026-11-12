---
name: write-a-prd
description: Use when capturing a new product requirement before planning.
---

Ask one question at a time. Write nothing before the answers.

1. Who is the user, and what are they unable to do today?
2. What behaviour counts as done, as acceptance ids A-01 and on?
3. What is explicitly out of scope?

After those answers:

1. Copy `harness/templates/prd.md` to `specs/<slug>/PRD.md`.
2. Fill problem, users, behaviour, non-goals, and the acceptance ids from the answers.
3. Do not invent implementation detail that belongs in an ADR.
4. Run `./verify.sh --plan` when ready to decompose.
