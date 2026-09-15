# scripts/lib/version.sh
# Version string and the shared CLI surface. Every script in scripts/ supports
# exactly four options and no others, except loop.sh which adds --resume and
# --status. No flag takes a value.

if [[ -n "${HARNESS_VERSION_LOADED:-}" ]]; then
  return 0 2>/dev/null || true
fi
HARNESS_VERSION_LOADED=1

if [[ -z "${HARNESS_ROOT:-}" ]]; then
  HARNESS_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
fi

harness_need_cmd() {
  local cmd=$1
  if ! command -v "$cmd" >/dev/null 2>&1; then
    echo "harness: missing tool: ${cmd}" >&2
    echo "The harness cannot continue. Install ${cmd} and retry. This is exit 2 (harness wrong), not a code defect." >&2
    exit 2
  fi
}

harness_version() {
  harness_need_cmd jq
  local ver sha
  ver="$(jq -r '.version' "$HARNESS_ROOT/package.json")"
  if [[ ! -d "$HARNESS_ROOT/.git" ]]; then
    printf 'harness %s+unknown\n' "$ver"
    return 0
  fi
  harness_need_cmd git
  if [[ -n "$(git -C "$HARNESS_ROOT" status --porcelain 2>/dev/null)" ]]; then
    printf 'harness %s+dirty\n' "$ver"
    return 0
  fi
  sha="$(git -C "$HARNESS_ROOT" rev-parse --short HEAD 2>/dev/null || echo unknown)"
  printf 'harness %s+%s\n' "$ver" "$sha"
}

# Parse argv. Known extra action flags are passed as the first arguments,
# terminated by --. Sets:
#   HARNESS_CLI_HELP, HARNESS_CLI_VERSION
#   HARNESS_CLI_ACTIONS   space-separated extra actions that were set
#   HARNESS_CLI_POSITIONAL remaining positional args
# Combining any two action flags exits 2 naming both.
harness_parse_flags() {
  local extras=()
  while [[ $# -gt 0 && "$1" != "--" ]]; do
    extras+=("$1")
    shift
  done
  if [[ $# -gt 0 && "$1" == "--" ]]; then
    shift
  fi

  HARNESS_CLI_HELP=0
  HARNESS_CLI_VERSION=0
  HARNESS_CLI_ACTIONS=()
  HARNESS_CLI_POSITIONAL=()

  local seen=()
  local arg extra matched
  for arg in "$@"; do
    case "$arg" in
      -h|--help)
        seen+=("help")
        HARNESS_CLI_HELP=1
        ;;
      -v|--version)
        seen+=("version")
        HARNESS_CLI_VERSION=1
        ;;
      -*)
        matched=0
        for extra in "${extras[@]+"${extras[@]}"}"; do
          if [[ "$arg" == "$extra" ]]; then
            seen+=("$arg")
            HARNESS_CLI_ACTIONS+=("$arg")
            matched=1
            break
          fi
        done
        if [[ $matched -eq 0 ]]; then
          echo "unrecognised option: ${arg}" >&2
          echo "valid: -h --help -v --version ${extras[*]+${extras[*]}}" >&2
          exit 2
        fi
        ;;
      *)
        HARNESS_CLI_POSITIONAL+=("$arg")
        ;;
    esac
  done

  if [[ ${#seen[@]} -gt 1 ]]; then
    echo "cannot combine action flags: ${seen[*]}" >&2
    echo "valid: -h --help -v --version ${extras[*]+${extras[*]}}" >&2
    exit 2
  fi
}

harness_print_version_and_exit() {
  harness_version
  exit 0
}
