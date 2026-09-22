# Rules migration log (R5)

Migration of demo rules onto the R0 template (2026-09-22).

## Kept and rewritten

| Previous | New file | Notes |
| -------- | -------- | ----- |
| `architecture-adr-consult.yaml` | `consult-adr-before-architectural-change.md` | Full EARS + Signals + Satisfaction |
| `harness/rules/service.md` (owns data) | `service-owns-its-data.md` | Split out |
| `harness/rules/service.md` (events) | `prefer-events-over-direct-calls.md` | Split out |
| `harness/rules/service.md` (contracts import) | `contracts-only-cross-service-import.md` | Split out |
| `harness/rules/service.md` (publisher) | `publish-through-contracts-publisher.md` | Split out |
| `harness/rules/node.md` (module system) | `declare-module-system.md` | Split out |
| `harness/rules/node.md` (engines) | `honour-engines-node.md` | Split out |
| `harness/rules/node.md` (sync fs) | `no-sync-fs-on-request-path.md` | Split out |
| `harness/rules/node.md` (env) | `env-validated-at-boot.md` | Split out |
| `harness/rules/node.md` (logging) | `structured-logging-only.md` | Split out |
| `harness/rules/project.md` (adapters) | `adapters-only-via-render.md` | Always-on |
| `harness/rules/project.md` (state) | `do-not-commit-harness-state.md` | Always-on |

## Deleted

| Previous | Reason |
| -------- | ------ |
| `harness/rules/project.md` bullet "Scope path-specific rules with globs" | Meta guidance, not a constraint; lives in `docs/rules-guide.md` (R1) |
| `harness/rules/project.md`, `service.md`, `node.md` as bundled files | Replaced by one-constraint-per-file sources under `harness/render/rules/` |
| `architecture-adr-consult.yaml` | Superseded by markdown source; render copies `.md` → tool adapters |

## Promoted to skill

None. No rule body was a multi-step playbook.

## Pointer

`harness/rules/README.md` points at `harness/render/rules/`. New rules start from
`harness/render/rules/TEMPLATE.md`.
