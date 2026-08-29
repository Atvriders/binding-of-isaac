# Isaac Cabinet

A self-hosted browser cabinet for the Flash-era *Binding of Isaac*, running on
[Ruffle](https://ruffle.rs). One container, one `docker compose up`, playable on a
desktop, a phone or a TV browser with a controller plugged in.

**This image contains no game data.** It ships the emulator and the web shell. The
game file is fetched into a Docker volume on first start, or supplied by you.

---

## Quick start

```bash
git clone https://github.com/Atvriders/binding-of-isaac.git
cd binding-of-isaac
docker compose up -d
```

Then open <http://localhost:3038>.

First start downloads the game file (about 36 MB) into the `isaac-game` volume and
verifies its checksum before serving it. Later starts reuse it. Watch it happen with
`docker compose logs -f`.

Change the port with `ISAAC_PORT`:

```bash
ISAAC_PORT=8080 docker compose up -d
```

## Controls

| Action | Keyboard | Controller |
| --- | --- | --- |
| Move | `W` `A` `S` `D` | Left stick or d-pad |
| Shoot | Arrow keys | Right stick or face buttons |
| Bomb | `E` | Right shoulder / right trigger |
| Active item | `Space` | Left trigger |
| Card or pill | `Q` | Left shoulder |
| Pause | `Esc` | Start |

On phones and tablets the on-screen controls appear automatically. Force them on
anywhere with `?touch=1`, or off with `?touch=0`. They deliberately do not appear on
a touchscreen laptop, where you almost certainly want the keyboard.

Controllers need no setup — plug one in and press a button. The browser only reveals
a gamepad after its first input, so the indicator in the top bar appears then.

## Saves

Ruffle stores Flash save data in your **browser**, not in the container. That means:

- restarting, updating or rebuilding the container never touches your progress
- clearing site data for the page **does** delete it
- a different browser or device has its own separate progress

Use **Export save** in the top bar for a real backup, and **Import save** to restore
it or move it to another device.

The game writes progress at its own checkpoints rather than continuously, so a brand
new browser shows nothing stored until you have actually got somewhere in a run.

## Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `ISAAC_PORT` | `3038` | Host port |
| `GAME_URL` | archive.org copy | Where to fetch the game file on first start |
| `GAME_SHA256` | pinned checksum | Integrity check; `skip` disables it |
| `GAME_DIR` | `/srv/game` | Where the game file lives inside the container |

### Using your own copy of the game

Mount it and turn the checksum off:

```yaml
volumes:
  - ./my-isaac.swf:/srv/game/isaac.swf:ro
environment:
  GAME_SHA256: "skip"
```

## Troubleshooting

**"game file not ready" or the loader never finishes.** The download is still running
or it failed. Check `docker compose logs isaac`. The container refuses to serve a file
that fails its checksum rather than handing you a broken game.

**Flat untextured floors and walls, or an "invisible wall" you collide with.** The
renderer cannot perform `BitmapData.draw`, which is how this game composites its
floor, wall and rock graphics. Those objects are never drawn but still collide, so
you walk into things that are not there.

Only Ruffle's wgpu backends (`webgpu` and `wgpu-webgl`) support that call. The legacy
`webgl` backend and the software `canvas` backend do not. This page leaves the choice
to Ruffle, which picks the best available, so you should never hit this -- but if you
have pinned `?renderer=webgl` or `?renderer=canvas`, that is the cause. Drop the
parameter.

If it happens without an override, your browser is giving Ruffle nothing better than
the software backend. Turn on hardware acceleration and restart it: in Edge that is
Settings -> System -> "Use graphics acceleration when available", and `edge://gpu`
should report WebGL as *Hardware accelerated*.

**Black screen.** If WebGL is working and the page is still black, try
`?renderer=canvas` to rule out a driver problem.

**No sound until you click.** Browsers block audio until you interact with the page.
Click once in the window.

**The intro takes a while.** It is a long animated intro, and Ruffle is slower than
Flash was. Press a key to move through it.

## Development

```bash
./scripts/fetch-assets.sh    # pulls Ruffle into web/ruffle and the game into game/
cd tests && npm install
npm run test:fast            # integrity + bundle checks, a few seconds
npm test                     # full browser suite, several minutes
```

The suite drives headless Chromium against exactly what nginx serves. Because the game
animates constantly, "the screen changed" proves nothing about input, so input tests
first saturate a set of frame signatures for the current screen and then assert that
input produces frames never seen in that baseline.

Build the image yourself with `docker compose build`.

## About the game file

The emulator, the web shell and the container here are original work under the MIT
licence. *The Binding of Isaac* is a commercial game by Edmund McMillen and Florian
Himsl and is not part of this repository or its published image. The default
`GAME_URL` points at a copy hosted in the Internet Archive's software library; point
it at your own copy if you prefer.
