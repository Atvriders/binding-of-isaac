import { bindTo, releaseAll, ensureFocus } from './input.js';
import { startGamepad } from './gamepad.js';
import { initTouch, isTouchDevice } from './touch.js';
import { initUi } from './ui.js';

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
  // ?renderer=canvas forces the software path: useful on machines with broken
  // WebGL drivers, and required for pixel readback in the test suite.
  preferredRenderer: new URLSearchParams(location.search).get('renderer') || 'webgl',
  allowScriptAccess: false,
};

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

  bindTo(player);
  startGamepad();
  initUi({ player, stage });

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
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) ensureFocus();
  });
  // Clicking a toolbar button moves focus off the game; hand it straight back.
  for (const b of document.querySelectorAll('.bar button')) {
    b.addEventListener('click', () => setTimeout(ensureFocus, 0));
  }

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
