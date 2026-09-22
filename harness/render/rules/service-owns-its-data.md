---
description: Ensures each service keeps its data and internals private to itself
globs:
  - services/**
  - examples/two-services/services/**
alwaysApply: false
---

# Service owns its data

When code in one service needs another service's data or internals, the system
shall not reach into that service's database or internal modules, because shared
storage and deep imports couple deployables and break independent change.

## Signals of violation

- Imports that reach another service's `src/`, `db/`, or private packages
- Direct SQL or client usage against another service's database
- Tests that boot two services and assert on shared tables as if they were one
  schema

## How to satisfy it

Call the other service through its published API or consume its events. Cross-
service types and publishers live only in the shared contracts package.
