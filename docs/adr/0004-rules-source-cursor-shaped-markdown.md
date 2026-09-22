---
id: "0004"
title: "Rules source is Cursor-shaped markdown under harness/render/rules"
status: accepted
date: 2026-09-22
deciders:
  - Luca Mezzalira
tags:
  - rules
  - render
touches:
  - harness/render/rules/**
  - harness/lib/render/**
  - scripts/check-rule-shape.mjs
  - harness/sensors/checks/rule-shape.sh
supersedes: []
superseded-by: ""
related:
  - "0001"
---

# ADR 0004: Rules source is Cursor-shaped markdown under harness/render/rules

## Context and problem

Demo rules lived as loose bullets under `harness/rules/` and one YAML file under
`harness/render/rules/`. Shapes drifted (no shared description, scope, reason,
or checkable signals), which contradicted the workshop claim that a rule is a
scoped, checkable, single-purpose constraint plus its reason.

## Decision drivers

- One source format agents and humans can copy from a template
- Render still adapts to each tool's native file extension and tree
- Mechanical enforcement inside `verify.sh` so drift cannot merge

## Considered options

1. Keep YAML sources and only document a soft style guide
2. Canonical Cursor-shaped markdown under `harness/render/rules/`, render copies
   into the active tool adapter, `rule-shape` sensor enforces the contract
3. Hand-maintain `.cursor/rules/` and skip a shared source

## Decision outcome

Chosen option: 2.

- Template: `harness/render/rules/TEMPLATE.md`
- Guide: `docs/rules-guide.md`
- Checker: `scripts/check-rule-shape.mjs` via `harness/sensors/checks/rule-shape.sh`

## Consequences

### Positive

- Workshop demo matches the taught template
- Scope (always-on vs globs) is explicit per file
- Verify fails non-conformant rules on every push that runs sensors

### Negative

- Authors must write EARS prose and Signals/Satisfaction sections
- Claude/Codex receive Cursor frontmatter field names (`globs`, `alwaysApply`)

## How the agent applies this

- Add or edit rules only under `harness/render/rules/` (not generated adapters)
- Copy `TEMPLATE.md`; never invent new frontmatter fields
- Run `./verify.sh --render` after rule edits for the active tool

## Revisit when

- A tool requires incompatible frontmatter that cannot be adapted at render time
- Empiricism shows the two-bullet Signals minimum is wrong
