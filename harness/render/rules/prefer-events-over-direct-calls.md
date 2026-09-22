---
description: Ensures services prefer events over direct calls in an event-driven estate
globs:
  - services/**
  - examples/two-services/services/**
alwaysApply: false
---

# Prefer events over direct calls

When one service needs another to react in an event-driven estate, the system
shall publish a domain event (or document an ADR exception for a direct call),
because synchronous coupling recreates a distributed monolith and hides failure
modes.

## Signals of violation

- Service A importing Service B's HTTP client for a workflow that could be async
- New cross-service REST helpers without an ADR naming why events do not fit
- Orchestration that chains service calls in-process across deployable boundaries

## How to satisfy it

Publish via the contracts package publisher and let the peer consume the event.
If a sync call is required, add an ADR under `docs/adr/` that states the
exception and its revisit condition.
