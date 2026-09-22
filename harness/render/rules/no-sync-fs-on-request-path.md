---
description: Ensures request paths never block the event loop on synchronous filesystem I/O
globs:
  - services/**
  - examples/two-services/services/**
alwaysApply: false
---

# No sync filesystem on request path

When handling a request or message on a hot path, the system shall not call
synchronous filesystem APIs (`readFileSync`, `writeFileSync`, `readdirSync`, and
kin), because sync I/O blocks the event loop and stalls every concurrent
request on that process.

## Signals of violation

- `*Sync` fs calls inside HTTP handlers, consumers, or middleware
- Boot-time sync reads copied into per-request helpers
- New code that wraps sync fs in a try/catch as if that made it safe on a
  request path

## How to satisfy it

Use promise-based `fs.promises` or `fs` methods with callbacks/async await.
Load config and templates once at boot, then reuse in memory on the request path.
