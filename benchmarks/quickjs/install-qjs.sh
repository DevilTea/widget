#!/usr/bin/env bash
# Usage: benchmarks/quickjs/install-qjs.sh <dest dir>
#
# Downloads the pinned quickjs-ng `qjs` binary for Linux x86_64 into <dest dir>, verifies its SHA-256, makes it
# executable and prints its absolute path on stdout (and nothing else on stdout; progress goes to stderr).
#
# Pinned release: quickjs-ng v0.18.0 (2026-11-01), asset `qjs-linux-x86_64`.
# The checksum is the SHA-256 that GitHub records for the release asset (the `digest` field of
# `gh api repos/quickjs-ng/quickjs/releases/tags/v0.18.0`); the release publishes no checksum file of its own.
# Engine facts for this release (quickjs.h): JS_DEFAULT_STACK_SIZE is 1 MiB (qjs: `--stack-size <KB>` overrides it);
# a stack overflow throws a catchable `RangeError: Maximum call stack size exceeded`; InternalError (out of memory,
# interrupts) is not catchable by script code.
#
# To move to another release: change QJS_TAG and QJS_SHA256 together (take the digest from the release's asset
# metadata, compare it with a second source, and re-run the benchmarks: engine versions are not comparable).

set -euo pipefail

QJS_TAG="v0.18.0"
QJS_ASSET="qjs-linux-x86_64"
QJS_SHA256="85ded23b9fabe8c1644fc40a8d2bbdd71157affcbd807359c618cc717ee24d7d"
QJS_URL="https://github.com/quickjs-ng/quickjs/releases/download/${QJS_TAG}/${QJS_ASSET}"

if [ "$#" -ne 1 ] || [ -z "$1" ]; then
	echo "usage: $0 <dest dir>" >&2
	exit 2
fi

if [ "$(uname -s)" != "Linux" ] || [ "$(uname -m)" != "x86_64" ]; then
	echo "install-qjs.sh: the pinned binary is Linux x86_64 only (this machine is $(uname -s) $(uname -m))" >&2
	exit 1
fi

sha256_of() {
	if command -v sha256sum >/dev/null 2>&1; then
		sha256sum "$1" | cut -d' ' -f1
	else
		shasum -a 256 "$1" | cut -d' ' -f1
	fi
}

mkdir -p "$1"
dest="$(cd "$1" && pwd)"
target="${dest}/qjs"
partial="$(mktemp "${dest}/qjs.download.XXXXXX")"
trap 'rm -f "$partial"' EXIT

echo "install-qjs.sh: downloading ${QJS_URL}" >&2
curl --fail --location --silent --show-error --retry 3 --retry-delay 2 --output "$partial" "$QJS_URL" >&2

actual="$(sha256_of "$partial")"
if [ "$actual" != "$QJS_SHA256" ]; then
	{
		echo "install-qjs.sh: CHECKSUM MISMATCH for ${QJS_ASSET} ${QJS_TAG}"
		echo "install-qjs.sh:   expected ${QJS_SHA256}"
		echo "install-qjs.sh:   computed ${actual}"
		echo "install-qjs.sh: refusing to install it."
	} >&2
	exit 1
fi

chmod +x "$partial"
mv "$partial" "$target"
trap - EXIT
echo "install-qjs.sh: installed ${target} (sha256 ${actual})" >&2
printf '%s\n' "$target"
