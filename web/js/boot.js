import { bindTo, releaseAll, ensureFocus } from './input.js';
import { startGamepad } from './gamepad.js';
import { initTouch, isTouchDevice } from './touch.js';
import { initUi } from './ui.js';
import { initItems, installKeyIsolation, itemList, hasKeyboard, revealItem } from './items.js';
import { startPickupWatch, stopPickupWatch, isWatching, onPickup } from './pickup.js';

const GAME_URL = '/game/isaac.swf';

// Ruffle reads this before its script runs.
window.RufflePlayer = window.RufflePlayer || {};
window.RufflePlayer.config = {
  autoplay: 'on',
  unmuteOverlay: 'visible',   // browsers block audio until a gesture; let Ruffle ask
  contextMenu: 'off',
  letterbox: 'on',            // keep the 4:3 stage intact in any window
  scale: 'showAll',
  quality: 'high',
  logLevel: 'error',
  warnOnUnsupportedContent: false,
  splashScreen: false,
  // preferredRenderer is deliberately NOT set by default.
  //
  // Pinning 'webgl' selects Ruffle's legacy backend, which has no offscreen
  // rendering and therefore cannot perform BitmapData.draw -- the call this game
  // uses to composite its floors, walls and rocks. The result is flat untextured
  // rooms and solid objects that never draw but still collide. Left unset, Ruffle
  // picks the best available (webgpu, then wgpu-webgl), both of which support it.
  //
  // ?renderer=<webgpu|wgpu-webgl|webgl|canvas> overrides it for diagnostics.
  allowScriptAccess: false,
};

const rendererOverride = new URLSearchParams(location.search).get('renderer');
if (rendererOverride) {
  window.RufflePlayer.config.preferredRenderer = rendererOverride;
}

/** Ruffle silently falls back to its canvas backend when WebGL is unavailable, and
 *  that backend does not implement BitmapData.draw -- which is how this game composites
 *  its floor, wall and rock textures. The result is flat colours and solid objects you
 *  cannot see, with no error shown. Detect it and say so. */
function webglAvailable() {
  try {
    const c = document.createElement('canvas');
    return !!(c.getContext('webgl2') || c.getContext('webgl'));
  } catch { return false; }
}

/** Auto-ID: watch the screen and name items as they are picked up. Off by default
 *  because it runs OCR while you play. */
function initPickup(player) {
  const btn = document.getElementById('btn-watch');
  const toast = document.getElementById('pickup-toast');
  const nameEl = document.getElementById('pickup-name');
  const descEl = document.getElementById('pickup-desc');
  if (!btn) return;

  let hideTimer = null;
  onPickup(ev => {
    if (ev.error) {
      btn.textContent = 'Auto-ID: unavailable';
      btn.setAttribute('aria-pressed', 'false');
      btn.disabled = true;
      btn.title = ev.error;
      return;
    }
    nameEl.textContent = ev.item.name;
    descEl.textContent = ev.item.description || '';
    toast.hidden = false;
    revealItem(ev.item);          // surface it in the grid too
    clearTimeout(hideTimer);
    hideTimer = setTimeout(() => { toast.hidden = true; }, 9000);
  });

  btn.addEventListener('click', async () => {
    if (isWatching()) {
      stopPickupWatch();
      btn.textContent = 'Auto-ID: off';
      btn.setAttribute('aria-pressed', 'false');
      return;
    }
    btn.textContent = 'Auto-ID: starting…';
    const r = await startPickupWatch(player, itemList);
    if (r.ok) {
      btn.textContent = 'Auto-ID: on';
      btn.setAttribute('aria-pressed', 'true');
    } else {
      btn.textContent = 'Auto-ID: unavailable';
      btn.title = r.error || '';
      btn.disabled = true;
    }
  });
}

function fail(msg, detail) {
  const el = document.getElementById('boot-error');
  el.hidden = false;
  el.querySelector('[data-msg]').textContent = msg;
  el.querySelector('[data-detail]').textContent = detail || '';
  document.getElementById('loading').hidden = true;
}

async function main() {
  const stage = document.getElementById('stage');

  if (!window.RufflePlayer?.newest) {
    fail('Ruffle failed to load.', 'The emulator bundle did not initialise.');
    return;
  }

  // Before the player exists: Ruffle adds its own window key handlers when created,
  // and ours must be registered first to be able to suppress them.
  installKeyIsolation();

  const player = window.RufflePlayer.newest().createPlayer();
  // <ruffle-player> defaults to Flash's legacy 550x400 and ignores its container,
  // so it must be sized explicitly or the game renders in a corner.
  player.style.width = '100%';
  player.style.height = '100%';
  player.style.display = 'block';
  stage.appendChild(player);
  window.__player = player;

  player.addEventListener('loadedmetadata', () => {
    document.getElementById('loading').hidden = true;
    const m = player.metadata || {};
    document.getElementById('meta').textContent =
      `${m.width}x${m.height} · ${m.frameRate}fps · SWF v${m.swfVersion}`;
  });

  if (!webglAvailable() && new URLSearchParams(location.search).get('renderer') !== 'canvas') {
    const warn = document.getElementById('renderer-warning');
    warn.hidden = false;
    document.getElementById('btn-warn-dismiss')
      .addEventListener('click', () => { warn.hidden = true; });
  }

  bindTo(player);
  startGamepad();
  initUi({ player, stage });
  initItems();
  initPickup(player);

  // Bind unconditionally so the controls work the instant they are shown; only
  // visibility is conditional. ?touch=1 forces them on, ?touch=0 forces them off.
  const touchLayer = document.getElementById('touch-controls');
  const touchParam = new URLSearchParams(location.search).get('touch');
  const wantTouch = touchParam === '1' ? true
                  : touchParam === '0' ? false
                  : isTouchDevice();
  initTouch(touchLayer);
  if (wantTouch) {
    touchLayer.hidden = false;
    document.body.classList.add('has-touch');
  }

  // Losing the window while holding a direction must not leave the key stuck.
  window.addEventListener('blur', releaseAll);

  // Ruffle ignores key events while the player is unfocused. Without this the game
  // silently swallows every keypress until the user happens to click on it.
  player.addEventListener('loadedmetadata', () => ensureFocus(), { once: true });
  stage.addEventListener('pointerdown', ensureFocus);

  // A browser withholds keyboard focus from the page until the user interacts with
  // it, so focusing the player programmatically on load is not enough: the first
  // real click is what hands the document focus. Take any click outside the sidebar
  // as that cue, rather than only a click on the game or the Items button.
  document.addEventListener('pointerdown', e => {
    if (e.target.closest('#items-panel, .bar')) return;   // those own their own focus
    setTimeout(() => { if (!hasKeyboard()) ensureFocus(); }, 0);
  }, true);

  // Returning to the tab should hand the game the keyboard back too.
  window.addEventListener('focus', () => {
    setTimeout(() => { if (!hasKeyboard()) ensureFocus(); }, 0);
  });
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) ensureFocus();
  });
  // Clicking ANY control moves focus off the game, and Ruffle then ignores the
  // keyboard. Hand focus back after every one of them -- unless the sidebar
  // currently holds focus, in which case it legitimately owns the keyboard.
  // The test is "does the sidebar have focus", not "is it visible": the sidebar is
  // always on screen, so keying off visibility would stop the game ever getting
  // the keyboard back.
  document.addEventListener('click', e => {
    if (!e.target.closest('button, input, a')) return;
    setTimeout(() => { if (!hasKeyboard()) ensureFocus(); }, 0);
  });

  try {
    await player.load({ url: GAME_URL, allowScriptAccess: false });
  } catch (e) {
    fail('The game file could not be loaded.',
      `${GAME_URL} — ${String(e)}. If this is a fresh install the container may still be downloading it; check "docker compose logs".`);
  }
}

// ruffle.js is a classic script and has run by the time this module evaluates,
// but its SourceAPI is only guaranteed after window load — wait for it.
if (document.readyState === 'complete') {
  main();
} else {
  window.addEventListener('load', main, { once: true });
}
