# PRD: Idempotent consumers for order.confirmed

## Problem

The billing service in `examples/two-services` handles `order.confirmed` without an idempotency key.
A redelivered message can charge twice.

## Users

Service owners running the example estate under agent-driven changes.

## Behaviour

1. `order.confirmed` events include an `idempotencyKey` (stable per order id).
2. Billing stores processed keys and skips duplicate deliveries.
3. Orders publishes through `@acme/contracts` only (no deep import of billing).

## Non-goals

- Changing the HTTP surface of either service
- Introducing a new message bus
- Production-grade storage (in-memory map is enough for the example)

## Acceptance

- A-01: Publishing `order.confirmed` twice with the same key results in one charge record
- A-02: A second key for a different order creates a second charge
- A-03: Billing does not import orders internals
