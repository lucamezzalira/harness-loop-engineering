#!/usr/bin/env bash
# scripts/setup.sh
# Install tooling deps and render adapters. Shape matches what Phase 3 cloud
# runners need: install with network on, then run the agent with it off.

set -euo pipefail

HARNESS_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck source=lib/version.sh
source "$HARNESS_ROOT/scripts/lib/version.sh"

usage() {
  cat <<'EOF'
Usage: scripts/setup.sh
       scripts/setup.sh -h|--help
       scripts/setup.sh -v|--version

Runs npm install and adapters/render.sh. Requires Node 22+, jq, yq, git.
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

harness_need_cmd npm
harness_need_cmd node
harness_need_cmd jq
harness_need_cmd yq
harness_need_cmd git

node_major="$(node -p 'process.versions.node.split(".")[0]')"
if (( node_major < 22 )); then
  echo "setup: Node 22+ required (found $(node -v))" >&2
  exit 2
fi

cd "$HARNESS_ROOT"
npm install
./adapters/render.sh
echo "setup: ok ($(harness_version))"
