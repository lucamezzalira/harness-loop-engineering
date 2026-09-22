---
id: "0003"
title: "Checks return four exit codes; registry maps missing"
status: accepted
date: 2026-09-22
deciders:
  - Luca Mezzalira
tags:
  - sensors
  - exit-codes
touches:
  - harness/sensors/**
  - harness/lib/checks/**
  - harness/sensors/sensors.yaml
supersedes:
  - "0002"
superseded-by: ""
related:
  - "0001"
---

# ADR 0003: Checks return four exit codes; registry maps missing

## Context and problem

`sensors.yaml` advertised `missing` policy that the runner never read. Checks
hardcoded skip vs exit-2, so changing YAML did nothing.

## Decision drivers

- Checks report facts; the registry decides policy
- Thin shell sensors must not grow bespoke parsers
- Align with CLI exit codes 0 / 1 / 2 while adding "tool absent"

## Considered options

1. Keep hardcoded skip inside each check
2. Exit 0/1/2/3 from each check; map 3 via `sensors.yaml` `missing`

## Decision outcome

Chosen option: 2.

| Code | Meaning |
| ---- | ------- |
| 0 | pass |
| 1 | code under test is wrong |
| 2 | check itself is broken |
| 3 | required tool is not installed |

`missing` is one of `skip`, `warn`, `exit2`, `n/a`. The runner never infers
policy from the filename.

## Consequences

### Positive

- `missing: skip` vs `exit2` on secrets is controlled by the registry
- Shell checks stay under the 15-line executable budget

### Negative

- Authors must remember exit 3 for absence, not skip inside the script

## How the agent applies this

- When writing or editing a sensor, return 3 if the tool is missing; do not
  choose skip/warn yourself.
- Put policy only in `harness/sensors/sensors.yaml`.
- Treat runner exit 2 after a check exit 2 or mapped `missing: exit2` as
  harness-wrong.

## Revisit when

- A fifth outcome is needed that cannot be expressed as skip/warn/exit2
- Checks move off shell and need a different transport than process exit codes
