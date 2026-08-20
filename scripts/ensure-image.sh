#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
IMAGE="$ROOT_DIR/public/webtuios.ext2"

if [[ -s "$IMAGE" ]]; then
  echo "==> Using bundled WebTUIOS disk image"
  exit 0
fi

exec "$ROOT_DIR/scripts/build-image.sh"
