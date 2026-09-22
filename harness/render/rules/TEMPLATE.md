<!--
  Rule template (copy to a new file under harness/render/rules/).

  Required fields:
  - description: one line, third person, what the rule ensures (1-200 chars)
  - globs: path patterns when scoped, OR alwaysApply: true when always-on (never both)
  - H1: short imperative restating the rule
  - First body paragraph: EARS form ("When X, the system shall Y, because Z")
  - ## Signals of violation: at least two concrete bullets
  - ## How to satisfy it: name a helper or show a short snippet (≥20 chars)
  - File under 100 lines; H1 must not contain "and"
-->
---
description: Ensures consumers complete each side effect at most once per messageId
globs: services/*/consumers/**/*.ts
alwaysApply: false
---

# Consumers are idempotent

When a message consumer handles an event, it shall complete the side
effect at most once per messageId, because the broker retries on any
error and duplicate side effects corrupt downstream state.

## Signals of violation

- Any consumer that mutates state without checking the idempotency
  store
- Any consumer that publishes to the outbox outside the idempotency
  wrapper
- Any test that asserts a side effect happened twice as if that were
  correct behaviour

## How to satisfy it

Wrap the handler in `withIdempotency` from `packages/idempotency`. The
wrapper takes the messageId from the event envelope and returns early
if it has been seen.
