---
name: add-a-consumer
description: Use when adding an event consumer; prefer idempotency keys.
---

1. Subscribe via the contracts package, not a deep service import.
2. Deduplicate with a stable key (usually eventId).
3. Add a retry/idempotency test.
4. Run `./verify.sh --turn`.
