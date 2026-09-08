import { exportSaves, importSaves, saveCount } from './saves.js';
import { onPadCountChange } from './gamepad.js';

export function initUi({ player, stage }) {
  const $ = id => document.getElementById(id);
  const status = $('status');
  const say = (msg, kind = 'info') => {
    status.textContent = msg;
    status.dataset.kind = kind;
    clearTimeout(say._t);
    say._t = setTimeout(() => { status.textContent = ''; delete status.dataset.kind; }, 4000);
  };

  $('btn-fullscreen').addEventListener('click', () => {
    // Fullscreen the whole page, not just the player. The browser confines focus to
    // the fullscreen element's subtree, so fullscreening the stage alone would leave
    // the toolbar and the item panel unfocusable -- you could open the item browser
    // and not be able to type in it.
    if (document.fullscreenElement) { document.exitFullscreen?.(); return; }
    const root = document.documentElement;
    (root.requestFullscreen?.call(root) ?? Promise.reject())
      .catch(() => say('Fullscreen was refused by the browser.', 'warn'));
  });

  $('btn-export').addEventListener('click', () => {
    const n = saveCount();
    if (n === 0) { say('No save data yet — play a run first.', 'warn'); return; }
    say(`Exported ${exportSaves()} save entr${n === 1 ? 'y' : 'ies'}.`, 'ok');
  });

  const file = $('file-import');
  $('btn-import').addEventListener('click', () => file.click());
  file.addEventListener('change', async () => {
    const f = file.files?.[0];
    if (!f) return;
    try {
      const n = importSaves(await f.text());
      say(`Imported ${n} entries. Reloading…`, 'ok');
      setTimeout(() => location.reload(), 1200);
    } catch (e) {
      say(e.message, 'warn');
    } finally { file.value = ''; }
  });

  // No inline handlers anywhere: the container's CSP omits 'unsafe-inline' for
  // scripts, so an onclick attribute would silently do nothing behind nginx.
  const help = $('help');
  $('btn-help').addEventListener('click', () => help.toggleAttribute('hidden'));
  $('btn-help-close').addEventListener('click', () => help.setAttribute('hidden', ''));
  help.addEventListener('click', e => { if (e.target === help) help.setAttribute('hidden', ''); });

  const pad = $('pad-indicator');
  onPadCountChange(n => {
    pad.hidden = n === 0;
    pad.textContent = n === 1 ? '1 controller' : `${n} controllers`;
  });

  return { say };
}
