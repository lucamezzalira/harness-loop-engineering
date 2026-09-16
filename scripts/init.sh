#!/usr/bin/env bash
# scripts/init.sh
# Start whatever this project needs for an end-to-end check. Safe to run at the
# start of every session. Distinct from setup.sh, which installs dependencies
# once and needs the network.
#
# Template contract: exit 0. Examples replace this with a real starter (services,
# migrations, local resources). Do not install packages here.
set -euo pipefail
HARNESS_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$HARNESS_ROOT"
# Nothing to boot in the bare template. Examples ship their own init.sh.
exit 0
