---
description: Ensures the contracts package is the only permitted cross-service import
globs:
  - services/**
  - packages/**
  - examples/two-services/**
alwaysApply: false
---

# Contracts only cross-service import

When a service imports code owned by another deployable, the system shall import
only from the shared contracts package, because any other shared module becomes a
hidden coupling surface that depcruise cannot treat as the public boundary.

## Signals of violation

- `import` paths from one service into another service's tree
- Shared utility packages used as a backdoor for domain types across services
- dependency-cruiser allowlists that exempt non-contracts packages between
  services

## How to satisfy it

Put schemas, event names, and publishers in `packages/contracts` (or the
example's contracts package). Keep service-local helpers inside the owning
service. Enforce with the contracts / boundaries sensors.
