#!/usr/bin/env bash
# scripts/verify.sh
# Run verification stages up to a tier: edit, turn, or commit (default).
# Config: verify.failFast, verify.editTierBudgetMs. The config file is optional.

set -euo pipefail

HARNESS_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck source=lib/config.sh
source "$HARNESS_ROOT/scripts/lib/config.sh"

usage() {
  cat <<'EOF'
Usage: scripts/verify.sh [edit|turn|commit]
       scripts/verify.sh -h|--help
       scripts/verify.sh -v|--version

Runs every stage up to and including the named tier. Default: commit.

Exit codes
  0  pass
  1  the code under test is wrong
  2  the harness is wrong (missing tool, bad or absent config)

Config (verify.*)
  failFast           default true. Stop at the first failing stage. Set false in
                     CI so a human sees every failure. Agents given nine failures
                     pick the wrong one to start on.
  maxStopRetries     default 2. How many times the stop hook may block on a red
                     turn tier before allowing the stop.
  editTierBudgetMs   default 1000. A stage exceeding this is recorded as a
                     budget breach.

The whole config file is optional. Delete it and verify runs on defaults.
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

tier="commit"
if [[ ${#HARNESS_CLI_POSITIONAL[@]} -gt 0 ]]; then
  tier="${HARNESS_CLI_POSITIONAL[0]}"
fi
case "$tier" in
  edit|turn|commit) ;;
  *)
    echo "unrecognised tier: ${tier}" >&2
    echo "valid: edit turn commit" >&2
    exit 2
    ;;
esac

# T07 fills in stage execution. Loading config and accepting a tier is enough
# for the T03 contract: this script works with the config file deleted.
echo "verify: config loaded (failFast=$(harness_config_get verify.failFast) from $(harness_config_source verify.failFast))" >&2
echo "verify: ${tier} (stages not yet installed)" >&2
exit 0
