#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd)"
cd "$ROOT"

work_dir="$(CDPATH= cd -- "$(mktemp -d "${TMPDIR:-/tmp}/metis-release-test.XXXXXX")" && pwd)"
trap 'rm -rf -- "$work_dir"' EXIT

mkdir -p "$work_dir/dist"
package_version="$(node -p 'require("./package.json").version')"
release_tag="v${package_version}"
NEXT_DIST_DIR="$work_dir/dist" \
METIS_RELEASE_TAG="$release_tag" \
METIS_RELEASE_VERSION="$package_version" \
METIS_RELEASE_COMMIT=test-commit \
pnpm exec tsx scripts/write-release-manifest.ts >/dev/null

export EXPECTED_TAG="$release_tag" EXPECTED_VERSION="$package_version"
node - "$work_dir/dist/release-manifest.json" <<'NODE'
const fs = require("node:fs");
const manifest = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
if (manifest.schemaVersion !== 1 || manifest.tag !== process.env.EXPECTED_TAG || manifest.version !== process.env.EXPECTED_VERSION) {
  throw new Error(`unexpected stable manifest: ${JSON.stringify(manifest)}`);
}
if (manifest.channel !== "stable" || manifest.isRelease !== true || manifest.commit !== "test-commit") {
  throw new Error(`unexpected release metadata: ${JSON.stringify(manifest)}`);
}
console.log("STABLE_MANIFEST_OK");
NODE

# Dry-run contracts are offline fixtures, not checks of GitHub's rate limit.
mkdir -p "$work_dir/bin"
cat > "$work_dir/bin/curl" <<'FIXTURE'
#!/usr/bin/env bash
for argument in "$@"; do
  case "$argument" in
    https://api.github.com/repos/*/releases/latest|https://api.github.com/repos/*/releases/tags/*)
      printf '{"tag_name":"%s","draft":false,"prerelease":false,"assets":[{"name":"SHA256SUMS"}]}\n' "$METIS_RELEASE_FIXTURE_TAG"
      exit 0 ;;
  esac
done
printf 'Unexpected network operation in dry-run fixture\n' >&2
exit 1
FIXTURE
chmod 700 "$work_dir/bin/curl"
for platform in linux macos; do
  PATH="$work_dir/bin:$PATH" METIS_RELEASE_FIXTURE_TAG="$release_tag" bash "public/install/$platform.sh" --install-dir "$work_dir/$platform" --dry-run > "$work_dir/$platform.log"
  grep -F "$work_dir/$platform" "$work_dir/$platform.log"
  [[ ! -e "$work_dir/$platform" ]]
  if bash "public/install/$platform.sh" --docker --dry-run > "$work_dir/rejected.log" 2>&1; then
    echo "Removed installation option was accepted" >&2; exit 1
  fi
done
echo "NATIVE_DRY_RUN_OK"

printf 'release payload for checksum test\n' > "$work_dir/metis-ai-${release_tag}.tar.gz"
(cd "$work_dir" && sha256sum "metis-ai-${release_tag}.tar.gz" > SHA256SUMS)
(cd "$work_dir" && sha256sum --check SHA256SUMS)
echo "CHECKSUM_OK"

bash scripts/release-install-notes.sh "$release_tag" f1shyondrugs/metis-ai > "$work_dir/install-notes.md"
grep -F "bash metis-install.sh --version $release_tag" "$work_dir/install-notes.md"
! grep -Ei "master|-- --version|download/latest|docker|ghcr" "$work_dir/install-notes.md"
echo "PINNED_RELEASE_INSTRUCTIONS_OK"
