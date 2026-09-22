---
description: Ensures publishes go through the contracts package publisher with schemas
globs:
  - services/**
  - examples/two-services/services/**
alwaysApply: false
---

# Publish through contracts publisher

When a service publishes a domain event or outbound message, the system shall use
the contracts package publisher, because ad-hoc HTTP or bus helpers skip schema
validation and let invalid payloads reach consumers.

## Signals of violation

- Raw `fetch`, axios, or bus `publish` calls that bypass the contracts publisher
- Event payloads built as plain objects without the contracts schema helper
- Duplicate publisher wrappers copied into a service instead of importing
  contracts

## How to satisfy it

Import the publisher from the contracts package and pass a schema-validated
payload. Add new event shapes to contracts first, then publish from the service.
