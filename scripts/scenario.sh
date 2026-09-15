#!/usr/bin/env bash
# scripts/scenario.sh
# Create and manage lesson worktrees under ../.scenarios/<name>.
#
# Worktree failure modes (why Phase 2 adds containers):
# 1. Port and dev server collisions when two worktrees bind the same port.
# 2. Shared external state that worktrees do not isolate (databases, caches,
#    cloud resources). This is the honest argument for Phase 2 containers.
# 3. Undeclared file ownership causing conflicts when the same path is edited
#    in two worktrees that share an object store.
#
# Port allocation derives deterministically from a hash of the scenario name so
# parallel worktrees never collide and the brief can name the exact URL.

set -euo pipefail

HARNESS_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck source=lib/config.sh
source "$HARNESS_ROOT/scripts/lib/config.sh"

usage() {
  cat <<'EOF'
Usage: scripts/scenario.sh start <name>
       scripts/scenario.sh reset <name>
       scripts/scenario.sh list
       scripts/scenario.sh clean
       scripts/scenario.sh -h|--help
       scripts/scenario.sh -v|--version

start   create a worktree at ../.scenarios/<name> on branch scenario/<name>,
        apply examples/<name>/seed.patch if present, write .env.local, print
        the example README
reset   discard the worktree and recreate it from start
list    show existing scenario worktrees
clean   remove all scenario worktrees and branches created by this script

No flag takes a value. Ports and DB names are derived from the scenario name.
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

harness_need_cmd git
harness_need_cmd python3

SCENARIOS_ROOT="$(cd "$HARNESS_ROOT/.." && pwd)/.scenarios"
EXAMPLES_DIR="$HARNESS_ROOT/examples"

scenario_port() {
  local name=$1
  # Stable port in 4100-4999 from sha of name.
  python3 -c "
import hashlib, sys
h = hashlib.sha256(sys.argv[1].encode()).hexdigest()
print(4100 + (int(h[:8], 16) % 900))
" "$name"
}

scenario_db_name() {
  local name=$1
  echo "harness_$(echo "$name" | tr '-' '_' | tr '[:upper:]' '[:lower:]')"
}

cmd_list() {
  if [[ ! -d "$SCENARIOS_ROOT" ]]; then
    echo "no scenarios"
    return 0
  fi
  find "$SCENARIOS_ROOT" -mindepth 1 -maxdepth 1 -type d -exec basename {} \; | sort
}

cmd_clean() {
  if [[ -d "$SCENARIOS_ROOT" ]]; then
    for d in "$SCENARIOS_ROOT"/*; do
      [[ -d "$d" ]] || continue
      local name
      name="$(basename "$d")"
      git -C "$HARNESS_ROOT" worktree remove --force "$d" 2>/dev/null || rm -rf "$d"
      git -C "$HARNESS_ROOT" branch -D "scenario/$name" 2>/dev/null || true
    done
  fi
  git -C "$HARNESS_ROOT" worktree prune
  echo "cleaned"
}

cmd_start() {
  local name=$1
  local example="$EXAMPLES_DIR/$name"
  if [[ ! -d "$example" ]]; then
    echo "scenario: unknown example '${name}'. Look under examples/." >&2
    exit 2
  fi

  mkdir -p "$SCENARIOS_ROOT"
  local dest="$SCENARIOS_ROOT/$name"
  local branch="scenario/$name"

  if [[ -d "$dest" ]]; then
    echo "scenario: ${dest} already exists. Use reset ${name} or clean." >&2
    exit 2
  fi

  if git -C "$HARNESS_ROOT" show-ref --verify --quiet "refs/heads/$branch"; then
    git -C "$HARNESS_ROOT" worktree add "$dest" "$branch"
  else
    git -C "$HARNESS_ROOT" worktree add -b "$branch" "$dest"
  fi

  if [[ -f "$example/seed.patch" ]]; then
    if ! git -C "$dest" apply "$example/seed.patch"; then
      echo "scenario: seed.patch failed to apply" >&2
      exit 1
    fi
  fi

  local port db
  port="$(scenario_port "$name")"
  db="$(scenario_db_name "$name")"

  {
    echo "PORT=${port}"
    echo "DB_NAME=${db}"
    if [[ -d "$example/.verify/stages" ]]; then
      echo "VERIFY_STAGES=${dest}/examples/${name}/.verify/stages"
    fi
  } >"$dest/.env.local"

  # Copy example-local VERIFY_STAGES path: worktree has the same tree, so path
  # inside the worktree is examples/<name>/.verify/stages when present.
  if [[ -d "$dest/examples/$name/.verify/stages" ]]; then
    printf 'VERIFY_STAGES=%s\n' "$dest/examples/$name/.verify/stages" >>"$dest/.env.local"
  fi

  echo "scenario: ${name}"
  echo "  worktree: ${dest}"
  echo "  branch:   ${branch}"
  echo "  PORT:     ${port}"
  echo "  DB_NAME:  ${db}"
  echo
  if [[ -f "$example/README.md" ]]; then
    cat "$example/README.md"
  fi
}

cmd_reset() {
  local name=$1
  local dest="$SCENARIOS_ROOT/$name"
  if [[ -d "$dest" ]]; then
    git -C "$HARNESS_ROOT" worktree remove --force "$dest" 2>/dev/null || rm -rf "$dest"
  fi
  git -C "$HARNESS_ROOT" branch -D "scenario/$name" 2>/dev/null || true
  git -C "$HARNESS_ROOT" worktree prune
  cmd_start "$name"
}

if [[ ${#HARNESS_CLI_POSITIONAL[@]} -eq 0 ]]; then
  echo "scenario: missing subcommand" >&2
  usage >&2
  exit 2
fi

sub="${HARNESS_CLI_POSITIONAL[0]}"
case "$sub" in
  list) cmd_list ;;
  clean) cmd_clean ;;
  start)
    if [[ ${#HARNESS_CLI_POSITIONAL[@]} -lt 2 ]]; then
      echo "scenario: start requires <name>" >&2
      exit 2
    fi
    cmd_start "${HARNESS_CLI_POSITIONAL[1]}"
    ;;
  reset)
    if [[ ${#HARNESS_CLI_POSITIONAL[@]} -lt 2 ]]; then
      echo "scenario: reset requires <name>" >&2
      exit 2
    fi
    cmd_reset "${HARNESS_CLI_POSITIONAL[1]}"
    ;;
  *)
    echo "unrecognised subcommand: ${sub}" >&2
    echo "valid: start reset list clean" >&2
    exit 2
    ;;
esac
