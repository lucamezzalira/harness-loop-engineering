#!/usr/bin/env bash
# scripts/hook.sh
# Normalise a tool-specific hook payload and dispatch portable handlers.
# HARNESS_TOOL is set by the generated adapter. Config is optional.

set -euo pipefail

HARNESS_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck source=lib/config.sh
source "$HARNESS_ROOT/scripts/lib/config.sh"

usage() {
  cat <<'EOF'
Usage: scripts/hook.sh
       scripts/hook.sh -h|--help
       scripts/hook.sh -v|--version

Reads a hook payload from stdin. HARNESS_TOOL selects the dialect
(claude|cursor|codex). Generated adapters set it; do not sniff the payload.

Only four events may carry a blocking gate: session_start, pre_tool,
post_tool, stop. Handlers for anything else belong in .verify/hooks/optional/.

The config file is optional. Every invocation is a fresh process that reads
the config at startup, so an edit takes effect on the next event.
EOF
}

harness_parse_flags -- "$@"
if [[ "${HARNESS_CLI_HELP}" -eq 1 ]]; then
  usage
  exit 0
fi
if [[ "${HARNESS_CLI_VERSION}" -eq 1 ]]; then
  harness_print_version_and_exit
fi

harness_config_load "$HARNESS_ROOT"

payload="{}"
if [[ ! -t 0 ]]; then
  payload="$(cat || true)"
  if [[ -z "$payload" ]]; then
    payload="{}"
  fi
fi

# T08 fills in normalisation and dispatch. Loading config is enough for T03.
echo "hook: config loaded (review.enabled=$(harness_config_get review.enabled) from $(harness_config_source review.enabled))" >&2
exit 0
