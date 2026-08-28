#!/usr/bin/env bash
# Fetches Ruffle and the game file for local development and testing.
# The container does this itself; this is only for running the suite outside Docker.
set -euo pipefail
cd "$(dirname "$0")/.."

RUFFLE_VERSION="${RUFFLE_VERSION:-0.5.0}"
GAME_URL="${GAME_URL:-https://archive.org/download/binding-of-isaac/Binding%20of%20Isaac.swf}"
GAME_SHA256="${GAME_SHA256:-3535d67fa608f28ea13697ba711a22922ab107daf5614978da3a07b623a6a761}"

if [ ! -f web/ruffle/ruffle.js ]; then
  echo "==> fetching Ruffle ${RUFFLE_VERSION}"
  mkdir -p web/ruffle
  curl -fsSL --retry 3 -o /tmp/ruffle.zip \
    "https://github.com/ruffle-rs/ruffle/releases/download/v${RUFFLE_VERSION}/ruffle-${RUFFLE_VERSION}-web-selfhosted.zip"
  unzip -qo /tmp/ruffle.zip -d web/ruffle
  rm -f /tmp/ruffle.zip
else
  echo "==> Ruffle already present"
fi

mkdir -p game
if [ ! -s game/isaac.swf ]; then
  echo "==> fetching game file (~36 MB)"
  curl -fL --retry 5 --retry-delay 3 -o game/isaac.swf.part "$GAME_URL"
  actual=$(sha256sum game/isaac.swf.part | cut -d' ' -f1)
  if [ "$GAME_SHA256" != "skip" ] && [ "$actual" != "$GAME_SHA256" ]; then
    rm -f game/isaac.swf.part
    echo "checksum mismatch: got $actual" >&2
    exit 1
  fi
  mv game/isaac.swf.part game/isaac.swf
else
  echo "==> game file already present"
fi
echo "==> ready"
