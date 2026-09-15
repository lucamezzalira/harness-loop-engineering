# scripts/lib/treehash.sh
# Hash of git ls-files -s plus the working tree diff. Everything that asks
# "has the code changed since X" uses this, never mtimes.

if [[ -n "${HARNESS_TREEHASH_LOADED:-}" ]]; then
  return 0 2>/dev/null || true
fi
HARNESS_TREEHASH_LOADED=1

if [[ -z "${HARNESS_ROOT:-}" ]]; then
  HARNESS_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
fi

# shellcheck source=version.sh
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/version.sh"

harness_treehash() {
  local root="${1:-${VERIFY_ROOT:-$HARNESS_ROOT}}"
  harness_need_cmd git
  harness_need_cmd shasum
  (
    cd "$root" || exit 2
    {
      git ls-files -s 2>/dev/null || true
      git diff HEAD 2>/dev/null || git diff 2>/dev/null || true
      git diff --cached 2>/dev/null || true
    } | shasum -a 256 | awk '{print $1}'
  )
}
