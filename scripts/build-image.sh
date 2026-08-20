#!/usr/bin/env bash
set -euo pipefail

ALPINE_VERSION="${ALPINE_VERSION:-3.24.1}"
TUIOS_VERSION="${TUIOS_VERSION:-0.7.0}"
IMAGE_SIZE="${IMAGE_SIZE:-48M}"

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT="${OUT:-$ROOT_DIR/public/webtuios.ext2}"
WORK="$(mktemp -d)"
ROOTFS="$WORK/rootfs"

cleanup() {
  rm -rf "$WORK"
}
trap cleanup EXIT

for command in curl tar sha256sum mke2fs; do
  command -v "$command" >/dev/null 2>&1 || {
    echo "error: missing required command: $command" >&2
    exit 1
  }
done

mkdir -p "$ROOTFS" "$(dirname "$OUT")"

ALPINE_FILE="alpine-minirootfs-${ALPINE_VERSION}-x86.tar.gz"
ALPINE_BRANCH="v${ALPINE_VERSION%.*}"
ALPINE_URL="https://dl-cdn.alpinelinux.org/alpine/${ALPINE_BRANCH}/releases/x86/${ALPINE_FILE}"
TUIOS_FILE="tuios_${TUIOS_VERSION}_Linux_i386.tar.gz"
TUIOS_URL="https://github.com/Gaurav-Gosain/tuios/releases/download/v${TUIOS_VERSION}/${TUIOS_FILE}"

printf '==> Downloading Alpine %s (x86)\n' "$ALPINE_VERSION"
curl --fail --location --retry 3 --output "$WORK/$ALPINE_FILE" "$ALPINE_URL"
curl --fail --location --retry 3 --output "$WORK/$ALPINE_FILE.sha256" "$ALPINE_URL.sha256"
(
  cd "$WORK"
  sha256sum -c "$ALPINE_FILE.sha256"
)

echo '==> Extracting Alpine rootfs'
tar --extract --gzip --numeric-owner --file "$WORK/$ALPINE_FILE" --directory "$ROOTFS"

printf '==> Downloading TUIOS v%s (Linux i386)\n' "$TUIOS_VERSION"
curl --fail --location --retry 3 --output "$WORK/$TUIOS_FILE" "$TUIOS_URL"
curl --fail --location --retry 3 --output "$WORK/tuios-checksums.txt" \
  "https://github.com/Gaurav-Gosain/tuios/releases/download/v${TUIOS_VERSION}/checksums.txt"
EXPECTED="$(awk -v file="$TUIOS_FILE" '$2 == file { print $1 }' "$WORK/tuios-checksums.txt")"
if [[ -z "$EXPECTED" ]]; then
  echo "error: checksum for $TUIOS_FILE not found" >&2
  exit 1
fi
ACTUAL="$(sha256sum "$WORK/$TUIOS_FILE" | awk '{print $1}')"
if [[ "$EXPECTED" != "$ACTUAL" ]]; then
  echo "error: TUIOS checksum mismatch" >&2
  exit 1
fi

mkdir -p "$WORK/tuios"
tar --extract --gzip --file "$WORK/$TUIOS_FILE" --directory "$WORK/tuios"
TUIOS_BIN="$(find "$WORK/tuios" -type f -name tuios -print -quit)"
if [[ -z "$TUIOS_BIN" ]]; then
  echo 'error: tuios binary was not found in release archive' >&2
  exit 1
fi

install -D -m 0755 "$TUIOS_BIN" "$ROOTFS/usr/local/bin/tuios"
mkdir -p "$ROOTFS/root/.config/tuios" "$ROOTFS/root/.cache" "$ROOTFS/usr/local/bin"
install -m 0644 "$ROOT_DIR/public/webtuios-config.toml" "$ROOTFS/root/.config/tuios/config.toml"

cat > "$ROOTFS/usr/local/bin/webtuios" <<'WRAPPER'
#!/bin/sh
export HOME=/root
export USER=root
export LOGNAME=root
export SHELL=/bin/sh
export TERM="${TERM:-xterm-256color}"
export COLORTERM="${COLORTERM:-truecolor}"
export PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
export XDG_CONFIG_HOME=/root/.config
export XDG_CACHE_HOME=/root/.cache

/usr/local/bin/tuios "$@"
status=$?

printf '\nTUIOS exited with status %s. Dropping to Alpine shell.\n' "$status"
exec /bin/sh -l
WRAPPER
chmod 0755 "$ROOTFS/usr/local/bin/webtuios"

cat > "$ROOTFS/etc/motd" <<EOF_MOTD
WebTUIOS
Alpine Linux ${ALPINE_VERSION} x86 + TUIOS v${TUIOS_VERSION}
EOF_MOTD

cat > "$ROOTFS/etc/webtuios-release" <<EOF_RELEASE
ALPINE_VERSION=${ALPINE_VERSION}
TUIOS_VERSION=${TUIOS_VERSION}
ARCH=x86
EOF_RELEASE

# A small but real ext2 root filesystem. Browser-side writes go to the CheerpX
# IndexedDB overlay, so the distributed base image remains immutable.
rm -f "$OUT"
echo "==> Creating $IMAGE_SIZE ext2 image"
mke2fs -q -t ext2 -b 4096 -d "$ROOTFS" -L webtuios "$OUT" "$IMAGE_SIZE"

IMAGE_SHA256="$(sha256sum "$OUT" | awk '{print $1}')"
printf '==> Built %s (%s, sha256 %s)\n' "$OUT" "$(du -h "$OUT" | awk '{print $1}')" "$IMAGE_SHA256"
