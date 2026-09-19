# boundaries

## Why this exists
A service importing another service's internals passes format, lint, types, and unit tests. Nothing else looks for it. This is the defect class that turns a monorepo into a distributed monolith.

## What to do
1. Remove the deep import.
2. Depend only on the shared contracts package for cross-service types and publishers.
3. If you need behaviour from another service, call it through its published interface (HTTP/event), not its source tree.

## Thresholds
Not applicable. Add an exception in `.dependency-cruiser.cjs` only with an ADR explaining why.
