# ADR 0001: Service boundaries

## Status

Accepted

## Context

The example estate has two Node services (orders, billing) that must not import each other's internals. Shared events go through a contracts package.

## Decision

Services may depend only on `@acme/contracts` for cross-service types and publishers. Direct `services/<other>` imports are forbidden. dependency-cruiser encodes this; the `boundaries` check runs it.

## Consequences

- Agents add events in the contracts package, not by reaching into another service
- Boundary violations fail the turn tier
- Future services follow the same rule without a new ADR unless the rule itself changes
