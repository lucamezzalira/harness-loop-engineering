---
name: add-a-consumer
description: Use when adding an event consumer; prefer idempotency keys.
---

Ask one question at a time. Write nothing before the answers.

1. Which event, and which contracts package publishes it?
2. What stable key makes a duplicate delivery a no-op?
3. Which acceptance id names the retry test?

After those answers:

1. Subscribe via the contracts package, not a deep service import.
2. Deduplicate with that key.
3. Add the retry test.
4. Run `./verify.sh --turn`.
