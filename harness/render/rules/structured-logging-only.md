---
description: Ensures service code logs with structured loggers rather than console.log
globs:
  - services/**
  - examples/two-services/services/**
alwaysApply: false
---

# Structured logging only

When service code emits logs for requests, messages, or domain events, the
system shall use the structured logger (not ad-hoc `console.log` of request
data), because unstructured logs drop fields needed for correlation and can leak
payloads into plain stdout.

## Signals of violation

- `console.log` / `console.error` in service `src/` with request or event bodies
- String-concatenated log lines instead of fielded objects
- Debug prints left in handlers after a local investigation

## How to satisfy it

Use the service's logger helper with level and fields (`requestId`, `messageId`,
outcome). Keep `console.*` out of service runtime paths; use it only in CLIs or
one-off scripts outside `services/`.
