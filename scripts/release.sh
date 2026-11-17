#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Usage: pnpm release vX.Y.Z[-prerelease]

Creates the tag, builds native installer assets and publishes the GitHub release
using the locally authenticated GitHub account.
EOF
}
tag="${1:-}"
if [[ "$tag" == "-h" || "$tag" == "--help" || -z "$tag" ]]; then
  usage
  [[ -n "$tag" ]] && exit 0
  exit 2
fi
[[ "$tag" =~ ^v[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.-]+)?$ ]] || { echo "Invalid release tag: $tag" >&2; exit 2; }
expected_version="${tag#v}"
package_version="$(node -p 'require("./package.json").version')"
[[ "$package_version" == "$expected_version" ]] || { echo "package.json is $package_version but the tag is $tag" >&2; exit 2; }
command -v gh >/dev/null || { echo "gh CLI is required" >&2; exit 2; }
gh auth status >/dev/null
repo="$(gh repo view --json nameWithOwner --jq .nameWithOwner)"
owner="${repo%%/*}"
login="$(gh api user --jq .login)"
[[ "$login" == "$owner" ]] || { echo "GitHub login $login does not match repository owner $owner" >&2; exit 2; }
[[ -z "$(git status --porcelain)" ]] || { echo "Working tree must be clean before releasing." >&2; exit 2; }
replace_release="${METIS_REPLACE_RELEASE:-0}"
if git rev-parse "$tag" >/dev/null 2>&1; then
  if [[ "$replace_release" == "1" ]]; then git tag -d "$tag";
  else echo "Tag already exists locally: $tag" >&2; exit 2; fi
fi
if git ls-remote --exit-code --tags origin "refs/tags/$tag" >/dev/null 2>&1; then
  if [[ "$replace_release" == "1" ]]; then
    git push origin ":refs/tags/$tag"
    gh release delete "$tag" --yes --cleanup-tag || true
  else echo "Tag already exists on origin: $tag" >&2; exit 2; fi
fi
echo "Running release checks as $(git config user.name) <$(git config user.email)>"
pnpm test:release
pnpm exec tsx --test tests/release-manifest.test.ts tests/github-releases.test.ts
commit="$(git rev-parse HEAD)"
# Platform builds run in native-packages.yml. Users never compile stable package updates.

git tag -a "$tag" -m "Metis AI $tag"
git push origin HEAD:master "$tag"
work_dir="$(mktemp -d "${TMPDIR:-/tmp}/metis-release.XXXXXX")"
cleanup() { rm -rf "$work_dir"; }
trap cleanup EXIT
version="${tag#v}"
git archive --format=tar.gz --prefix="metis-ai-${version}/" "$tag" > "$work_dir/metis-ai-${tag}.tar.gz"
cp public/install/install.sh "$work_dir/metis-install.sh"
cp public/install/install.ps1 "$work_dir/metis-install.ps1"
cp public/install/linux.sh "$work_dir/metis-linux.sh"
cp public/install/macos.sh "$work_dir/metis-macos.sh"
cp public/install/windows.ps1 "$work_dir/metis-windows.ps1"
(cd "$work_dir" && sha256sum \
  "metis-ai-${tag}.tar.gz" \
  "metis-install.sh" \
  "metis-install.ps1" \
  "metis-linux.sh" \
  "metis-macos.sh" \
  "metis-windows.ps1" > SHA256SUMS && sha256sum --check --strict SHA256SUMS)
notes_file="$work_dir/release-notes.md"
{
  echo "## What's new"
  echo
  awk -v ver="$version" '
    $0 ~ "^## v" ver " " {p=1; next}
    p && /^## / {exit}
    p {print}
  ' CHANGELOG.md
  bash scripts/release-install-notes.sh "$tag" "$repo"
} > "$notes_file"
gh release create "$tag" --draft --title "Metis AI ${tag}" --notes-file "$notes_file" \
  "$work_dir/metis-ai-${tag}.tar.gz" \
  "$work_dir/metis-install.sh" \
  "$work_dir/metis-install.ps1" \
  "$work_dir/metis-linux.sh" \
  "$work_dir/metis-macos.sh" \
  "$work_dir/metis-windows.ps1" \
  "$work_dir/SHA256SUMS"
echo "Created draft ${tag} as ${owner}; native-packages.yml publishes only after every platform succeeds."
