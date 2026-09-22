---
id: "0002"
title: "Checks return only pass or fail"
status: superseded
date: 2026-09-19
deciders:
  - Luca Mezzalira
tags:
  - sensors
  - exit-codes
touches:
  - harness/sensors/**
  - harness/lib/checks/**
supersedes: []
superseded-by: "0003"
related:
  - "0001"
---

# ADR 0002: Checks return only pass or fail

## Context and problem

Early sensor modules mixed "tool missing" with "code wrong" by returning skip
or harness-error from inside each check, so `sensors.yaml` could not control
missing-tool policy.

## Decision drivers

- Keep checks tiny
- Make absence of a tool a first-class outcome

## Considered options

1. Boolean pass/fail only, with skip hardcoded in each check
2. A richer exit-code contract owned by the registry

## Decision outcome

Chosen option: 1 (historical). Checks effectively behaved as pass/fail/skip
with policy inside the module.

## Consequences

### Positive

- Simple mental model for early prototypes

### Negative

- `missing: exit2` in YAML was ignored; secrets policy lived in code

## How the agent applies this

- Do not follow this ADR. It is superseded by 0003.

## Revisit when

- Superseded; see 0003
