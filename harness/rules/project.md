# Project rules

- Scope path-specific rules with globs (example: `services/billing/**` keeps PCI data out of info logs).
- Generated adapters under `.cursor/`, `.claude/`, or `.codex/` are written only by `./verify.sh --render`.
- `harness/state/` is machine output; do not commit it.
