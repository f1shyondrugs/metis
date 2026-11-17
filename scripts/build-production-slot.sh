#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd)"
cd "${AI_CHAT_ROOT:-$PROJECT_ROOT}"

BUILD_DIR="${1:-${NEXT_DIST_DIR:-.next-a}}"
case "$BUILD_DIR" in
  .next-a|.next-b) ;;
  *) echo "Refusing unsupported production build directory: $BUILD_DIR" >&2; exit 2 ;;
esac

export PATH="${METIS_PNPM_HOME:+$METIS_PNPM_HOME:}${METIS_NODE_HOME:+$METIS_NODE_HOME/bin:}$PROJECT_ROOT/.runtime/pnpm/bin:$PROJECT_ROOT/.runtime/node/bin:$PATH"
PNPM_BIN="${PNPM_BIN:-pnpm}"
command -v "$PNPM_BIN" >/dev/null 2>&1 || {
  echo "pnpm is not available (checked $PNPM_BIN and PATH)" >&2
  exit 127
}

# Next adds custom distDir type paths to tsconfig.json during builds. Keep those
# generated paths out of the source tree so the inactive slot can never make a
# later typecheck fail with stale generated route types.
tsconfig_backup="$(mktemp)"
next_env_backup="$(mktemp)"
cp tsconfig.json "$tsconfig_backup"
next_env_existed=0
if [[ -f next-env.d.ts ]]; then
  next_env_existed=1
  cp next-env.d.ts "$next_env_backup"
fi
restore_tsconfig() {
  cp "$tsconfig_backup" tsconfig.json
  if [[ "$next_env_existed" == "1" ]]; then
    cp "$next_env_backup" next-env.d.ts
  else
    rm -f next-env.d.ts
  fi
  rm -f "$tsconfig_backup" "$next_env_backup"
}
trap restore_tsconfig EXIT INT TERM

# Upgrades can change Next/pnpm paths. Use a clean cache by default so cached
# absolute module paths cannot break an existing installation.
# Local rebuilds may explicitly opt in to cache reuse.
rollback_dir="${BUILD_DIR}.rollback"
rm -rf -- "$rollback_dir"
if [[ -d "$BUILD_DIR" ]]; then
  mv -- "$BUILD_DIR" "$rollback_dir"
fi
mkdir -p "$BUILD_DIR"
if [[ "${METIS_REUSE_BUILD_CACHE:-0}" == "1" && -d "$rollback_dir/cache" ]]; then
  mv -- "$rollback_dir/cache" "$BUILD_DIR/cache"
fi
build_succeeded=0
restore_build_slot() {
  if [[ "$build_succeeded" != "1" ]]; then
    rm -rf -- "$BUILD_DIR"
    if [[ -d "$rollback_dir" ]]; then
      mv -- "$rollback_dir" "$BUILD_DIR"
    fi
  fi
  rm -rf -- "$rollback_dir"
}
trap 'restore_build_slot; restore_tsconfig' EXIT INT TERM
export NEXT_DIST_DIR="$BUILD_DIR"
export NODE_ENV=production
build_node_options="$(node "$SCRIPT_DIR/build-node-options.cjs")"
export NODE_OPTIONS="$build_node_options"
# Normal optimized production build. Tailwind source detection is explicitly
# bounded in app/globals.css, which avoids scanning runtime/workspace trees.
"$PNPM_BIN" build

[[ -s "$BUILD_DIR/BUILD_ID" ]] || {
  echo "Build completed without $BUILD_DIR/BUILD_ID" >&2
  exit 1
}

# Production serves compiled assets, not webpack/SWC compiler caches.
# Keep runtime image/fetch caches intact and allow explicit local cache reuse.
if [[ "${METIS_REUSE_BUILD_CACHE:-0}" != "1" ]]; then
  for compiler_cache in "$BUILD_DIR/cache/webpack" "$BUILD_DIR/cache/swc"; do
    if [[ -d "$compiler_cache" && ! -L "$BUILD_DIR/cache" && ! -L "$compiler_cache" ]]; then
      rm -rf -- "$compiler_cache"
    fi
  done
fi
build_succeeded=1
rm -rf -- "$rollback_dir"
restore_tsconfig
trap - EXIT INT TERM
