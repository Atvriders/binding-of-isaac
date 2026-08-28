# The Binding of Isaac — self-hosted browser cabinet

**Date:** 2026-08-28
**Status:** approved, implementing

## Goal

Play the full, final Flash release of *The Binding of Isaac* (Wrath of the Lamb) in a
browser on the LAN, started with a single `docker compose up -d`, with keyboard,
gamepad and touch input, fullscreen, and saves that survive restarts.

## What "newest / full version" means here

The original game is a Flash (ActionScript 2) title. Its final release is the Wrath of
the Lamb edition; the SWF used here is that build. Anything later is *Rebirth*, a
separate C++/SDL product that cannot run in a browser and is out of scope.

Verified properties of the target SWF:

| Property | Value |
| --- | --- |
| Signature / SWF version | `FWS` (uncompressed), version 8 |
| Bytecode | ActionScript 2 — 8x `DoAction`, zero `DoABC` |
| Stage | 800x600 @ 30 fps |
| Size | 36,209,977 bytes |
| SHA-256 | `3535d67fa608f28ea13697ba711a22922ab107daf5614978da3a07b623a6a761` |
| Edition markers | `Sheol`, `Cathedral`, `Krampus` present -> Wrath of the Lamb, not the demo |

AS2 matters: it is Ruffle's mature execution path, which is why emulation is viable at all.

## Architecture

One container. `nginx:alpine` serving a static bundle:

```
/usr/share/nginx/html/
  index.html          web shell
  css/app.css
  js/*.js             boot, input, gamepad, touch, saves, ui
  ruffle/             Ruffle 0.5.0 self-hosted (vendored at build time)
/srv/game/            <- named volume, holds isaac.swf (NOT in the image)
```

### Game file provisioning

The image ships **no game data**. On container start, `docker-entrypoint.sh`:

1. looks for `/srv/game/isaac.swf`
2. if absent, downloads it from the configured `GAME_URL`
3. verifies SHA-256 against `GAME_SHA256`; deletes and fails on mismatch
4. execs nginx

The volume persists it, so the download happens once. This keeps the published
image free of third-party game data while preserving one-command startup.
`GAME_SHA256=skip` allows a user-supplied SWF.

### Input

Ruffle has no gamepad binding, so gamepad and touch both feed **one** synthetic-key
layer (`js/input.js`) that dispatches `keydown`/`keyup` at the Ruffle player element.
Keyboard input needs no layer — it reaches Ruffle natively.

```
 gamepad.js --\
               >-- input.js -- synthetic KeyboardEvent --> <ruffle-player> --> AVM1
 touch.js   --/
```

`input.js` owns key state so a held direction repeats correctly and a released
button always emits its `keyup`, including when a touch is dragged off a button.

**Risk:** if Ruffle ignores untrusted events, gamepad and touch are both dead. This is
verified by probe before the feature is built, not after.

### Saves

Ruffle maps Flash `SharedObject` onto browser `localStorage`. Saves therefore live in
the **browser**, not the container: immune to container restart and image update,
destroyed by clearing site data. `js/saves.js` adds Export / Import buttons so a real
backup exists off-browser.

### Scaling and fullscreen

`<ruffle-player>` defaults to Flash's legacy 550x400 and ignores its container, so it
is sized explicitly. `letterbox: on` + `scale: showAll` preserve the 4:3 stage in any
window. Fullscreen uses Ruffle's own API with a Fullscreen API fallback.

## Testing

Playwright drives headless Chromium against the exact bundle nginx serves.

| Test | Assertion |
| --- | --- |
| Integrity | SWF size + SHA-256 + `FWS`/v8/800x600 header fields |
| Boot | `loadedmetadata` fires; `isActionScript3 === false`; no page errors |
| Render | canvas is non-blank and content changes over time |
| Keyboard | key press changes game state beyond the passive-animation baseline |
| Gamepad | synthetic pad state produces the same effect as the real key |
| Touch | pointer on d-pad produces the same effect as the real key |
| Saves | `localStorage` written during play; survives reload |
| Fullscreen | Ruffle fullscreen API invoked without error |

**Control required:** the game animates on its own, so "the screen changed" does not
prove input worked. Input tests compare against a measured no-input baseline over the
same interval, on a screen where input has a visible effect.

## Constraints honestly stated

- No Docker daemon in the development sandbox. The Dockerfile and compose file are
  validated statically and the bundle is tested exactly as served; the image build is
  proven by CI, not locally. The final report must separate the two.
- Headless software rendering is far slower than a real GPU browser. Performance
  numbers from CI are a floor, not a representative figure.

## Out of scope

Rebirth, netplay, achievements sync, mod support, save-state scrubbing.
