#!/bin/sh
# Ensures the game file is present in the volume before nginx starts.
# The image ships no game data; this fetches it once, then verifies it.
set -eu

GAME_DIR="${GAME_DIR:-/srv/game}"
GAME_FILE="${GAME_DIR}/isaac.swf"
GAME_URL="${GAME_URL:-}"
GAME_SHA256="${GAME_SHA256:-skip}"

log() { echo "[isaac] $*" >&2; }

verify() {
  [ "$GAME_SHA256" = "skip" ] && return 0
  actual="$(sha256sum "$1" | cut -d' ' -f1)"
  [ "$actual" = "$GAME_SHA256" ] && return 0
  log "checksum mismatch"
  log "  expected $GAME_SHA256"
  log "  actual   $actual"
  return 1
}

mkdir -p "$GAME_DIR"

if [ -s "$GAME_FILE" ]; then
  if verify "$GAME_FILE"; then
    log "game file present and verified ($(wc -c < "$GAME_FILE") bytes)"
  else
    log "existing game file failed verification; refusing to serve it."
    log "delete the volume, or set GAME_SHA256=skip to use your own copy."
    exit 1
  fi
else
  if [ -z "$GAME_URL" ]; then
    log "no game file at $GAME_FILE and GAME_URL is empty."
    log "mount your own copy there, or set GAME_URL."
    exit 1
  fi
  log "no game file yet; downloading (about 36 MB, once only)"
  tmp="${GAME_FILE}.part"
  rm -f "$tmp"
  if ! curl -fL --retry 5 --retry-delay 3 --retry-connrefused \
            --connect-timeout 20 -o "$tmp" "$GAME_URL"; then
    rm -f "$tmp"
    log "download failed. check network access to the game URL."
    exit 1
  fi
  if ! verify "$tmp"; then
    rm -f "$tmp"
    log "downloaded file failed verification; discarded."
    exit 1
  fi
  mv "$tmp" "$GAME_FILE"
  log "download complete and verified"
fi

# A stray .part from a killed container should never accumulate.
rm -f "${GAME_FILE}.part" 2>/dev/null || true

exec "$@"
