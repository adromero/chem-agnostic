#!/usr/bin/env bash
# Cross-compile chemag-go-helper for the platforms shipped in the npm
# tarball. RUN ON RELEASE (CI) — do NOT add as a `pnpm install` postinstall
# hook. Users install the npm package with the prebuilt binary already
# bundled and never need a Go toolchain themselves.
#
# Maintainers can also run this ad-hoc when iterating on the helper.
#
# Usage:
#   ./scripts/build-helper.sh            # build every supported target
#   ./scripts/build-helper.sh linux/amd64  # build a single GOOS/GOARCH

set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PKG_ROOT="$(cd "${HERE}/.." && pwd)"
HELPER_SRC="${PKG_ROOT}/go-helper"
BIN_ROOT="${PKG_ROOT}/bin"

# darwin/linux/windows × amd64/arm64 — the matrix promised in the package
# README and exercised by CI's release workflow.
TARGETS=(
  "darwin/amd64"
  "darwin/arm64"
  "linux/amd64"
  "linux/arm64"
  "windows/amd64"
  "windows/arm64"
)

if [ "$#" -gt 0 ]; then
  TARGETS=("$@")
fi

if ! command -v go >/dev/null 2>&1; then
  echo "error: go toolchain not found on PATH" >&2
  exit 1
fi

mkdir -p "${BIN_ROOT}"

for target in "${TARGETS[@]}"; do
  goos="${target%/*}"
  goarch="${target##*/}"
  out_dir="${BIN_ROOT}/${goos}-${goarch}"
  mkdir -p "${out_dir}"

  out_name="chemag-go-helper"
  if [ "${goos}" = "windows" ]; then
    out_name="${out_name}.exe"
  fi

  out_path="${out_dir}/${out_name}"
  echo "building ${goos}/${goarch} -> ${out_path}"
  (
    cd "${HELPER_SRC}"
    GOOS="${goos}" GOARCH="${goarch}" CGO_ENABLED=0 \
      go build -trimpath -ldflags "-s -w" -o "${out_path}" .
  )
done

echo "done."
