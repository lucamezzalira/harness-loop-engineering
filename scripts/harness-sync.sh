#!/usr/bin/env bash
# scripts/harness-sync.sh
# Consumer-side pull of canonical shared/ assets. Never pushes. Never overwrites
# a local file whose hash no longer matches harness.lock (exit 1; fix upstream).
#
# harness.lock:
#   source: path-or-url
#   version: tag-or-sha-or-local
#   manifest: MANIFEST.yaml   # optional, default MANIFEST.yaml under source
#   installed:
#     relative/path: sha256...
set -euo pipefail

HARNESS_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck source=lib/config.sh
source "$HARNESS_ROOT/scripts/lib/config.sh"
# shellcheck source=lib/version.sh
source "$HARNESS_ROOT/scripts/lib/version.sh"

usage() {
  cat <<'EOF'
Usage: scripts/harness-sync.sh
       scripts/harness-sync.sh --check
       scripts/harness-sync.sh --status
       scripts/harness-sync.sh -h|--help
       scripts/harness-sync.sh -v|--version

Reads harness.lock at the consumer root (VERIFY_ROOT or PWD). Pulls the pinned
version of shared assets into place. --check verifies without writing.
--status prints pin vs upstream without writing.

No flag takes a value. Combining action flags is an error.
EOF
}

harness_parse_flags --check --status -- "$@"
if [[ "${HARNESS_CLI_HELP}" -eq 1 ]]; then usage; exit 0; fi
if [[ "${HARNESS_CLI_VERSION}" -eq 1 ]]; then harness_print_version_and_exit; fi

action="sync"
if [[ ${#HARNESS_CLI_ACTIONS[@]} -gt 0 ]]; then
  action="${HARNESS_CLI_ACTIONS[0]}"
fi

harness_need_cmd jq
harness_need_cmd yq
harness_need_cmd python3
harness_need_cmd shasum

ROOT="${VERIFY_ROOT:-$PWD}"
ROOT="$(cd "$ROOT" && pwd)"
LOCK="$ROOT/harness.lock"

if [[ ! -f "$LOCK" ]]; then
  echo "harness-sync: no harness.lock at ${ROOT}" >&2
  exit 2
fi

source_path="$(yq -r '.source // ""' "$LOCK")"
version="$(yq -r '.version // ""' "$LOCK")"
manifest_name="$(yq -r '.manifest // "MANIFEST.yaml"' "$LOCK")"

if [[ -z "$source_path" ]]; then
  echo "harness-sync: harness.lock missing source" >&2
  exit 2
fi

# Resolve local source trees (path relative to lock root or absolute).
resolve_source() {
  local src=$1
  if [[ "$src" = /* ]]; then
    printf '%s\n' "$src"
    return
  fi
  if [[ -d "$ROOT/$src" ]]; then
    printf '%s\n' "$(cd "$ROOT/$src" && pwd)"
    return
  fi
  if [[ -d "$HARNESS_ROOT/$src" ]]; then
    printf '%s\n' "$(cd "$HARNESS_ROOT/$src" && pwd)"
    return
  fi
  echo "harness-sync: unsupported or missing source '${src}' (local paths only in this template)" >&2
  exit 2
}

SRC="$(resolve_source "$source_path")"
MANIFEST="$SRC/$manifest_name"
if [[ ! -f "$MANIFEST" ]]; then
  echo "harness-sync: manifest not found: ${MANIFEST}" >&2
  exit 2
fi

sha_file() {
  shasum -a 256 "$1" | awk '{print $1}'
}

python3 - "$ROOT" "$SRC" "$MANIFEST" "$LOCK" "$action" "$version" <<'PY'
import hashlib, json, os, shutil, subprocess, sys

root, src, manifest, lock_path, action, version = sys.argv[1:7]

def shasum(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(65536), b""):
            h.update(chunk)
    return h.hexdigest()

raw = subprocess.check_output(["yq", "-o", "json", ".", manifest], text=True)
assets = json.loads(raw).get("assets") or []
lock = json.loads(subprocess.check_output(["yq", "-o", "json", ".", lock_path], text=True))
installed = dict(lock.get("installed") or {})

upstream = {}
for a in assets:
    shared_rel = a["shared"]
    install_rel = a["install"]
    shared_path = os.path.join(src, shared_rel)
    if not os.path.isfile(shared_path):
        print(f"harness-sync: missing upstream file {shared_path}", file=sys.stderr)
        sys.exit(2)
    upstream[install_rel] = (shared_path, shasum(shared_path))

ec = 0
lines = []
lines.append(f"source: {src}")
lines.append(f"version: {version}")

for install_rel, (shared_path, up_hash) in sorted(upstream.items()):
    dest = os.path.join(root, install_rel)
    lock_hash = installed.get(install_rel)
    local_hash = shasum(dest) if os.path.isfile(dest) else None

    if action == "--status":
        state = "missing"
        if local_hash and lock_hash and local_hash == lock_hash == up_hash:
            state = "current"
        elif local_hash and lock_hash and local_hash == lock_hash and lock_hash != up_hash:
            state = "behind"
        elif local_hash and lock_hash and local_hash != lock_hash:
            state = "local-edit"
        elif local_hash and not lock_hash:
            state = "untracked-local"
        lines.append(f"  {install_rel}: {state}")
        continue

    if action == "--check":
        if local_hash and lock_hash and local_hash != lock_hash:
            print(f"harness-sync: local edit not in lock: {install_rel}", file=sys.stderr)
            ec = 1
        elif local_hash and lock_hash and local_hash == lock_hash and lock_hash != up_hash:
            print(f"harness-sync: behind upstream (ok for --check warn path): {install_rel}", file=sys.stderr)
        elif not local_hash:
            print(f"harness-sync: missing installed file: {install_rel}", file=sys.stderr)
            ec = 1
        continue

    # sync
    if local_hash and lock_hash and local_hash != lock_hash:
        print(
            f"harness-sync: refusing to overwrite local edit: {install_rel}\n"
            f"  Send the fix upstream to {shared_path} then bump the pin.",
            file=sys.stderr,
        )
        ec = 1
        continue
    os.makedirs(os.path.dirname(dest), exist_ok=True)
    shutil.copy2(shared_path, dest)
    installed[install_rel] = up_hash
    lines.append(f"  synced {install_rel}")

if action == "sync" and ec == 0:
    # rewrite lock installed map via yq-less python write as yaml-ish json then yq
    lock["installed"] = installed
    lock["version"] = version
    tmp = lock_path + ".tmp"
    # keep YAML by asking yq to rebuild from json
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(lock, f)
    yaml_out = subprocess.check_output(["yq", "-P", ".", tmp], text=True)
    with open(lock_path, "w", encoding="utf-8") as f:
        f.write(yaml_out)
    os.remove(tmp)

print("\n".join(lines))
sys.exit(ec)
PY
