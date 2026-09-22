---
description: Ensures agents consult matching ADRs before changing architectural paths
globs:
  - services/**
  - packages/**
  - examples/two-services/services/**
  - examples/two-services/packages/**
  - infra/**
  - harness/**
alwaysApply: false
---

# Consult ADR before architectural change

When a change adds or edits files under a path listed in this rule's globs, the
system shall list matching ADRs from `docs/adr/README.md` and read each in full
before editing, because standing decisions live in ADRs and silent drift
recreates the problems those ADRs already closed.

## Signals of violation

- A plan or PR that touches `services/`, `packages/`, `infra/`, or `harness/`
  without naming any ADR (or stating that none apply)
- A diff that contradicts an accepted ADR without a superseding ADR file
- An agent reply that invents a new boundary or entry-point convention while
  ADRs already cover that area

## How to satisfy it

Open `docs/adr/README.md`, match `touches` to the paths in scope, read those
ADRs fully, and name them in the plan or PR (or write "none apply" with the
paths checked). New standing decisions go in a new ADR; never edit an
`accepted` ADR in place.
