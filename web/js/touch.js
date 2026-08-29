// On-screen controls for phones and tablets. Same shared input layer as the pad.
// Each pointer is its own source, so two fingers on one button behave correctly and
// a lost pointer only releases what that finger was holding.
import { setFrom, clearSource, releaseAll, ensureFocus } from './input.js';

const src = id => `touch:${id}`;
const owned = new Map();   // pointerId -> action, for cleanup on lost pointers

export function initTouch(root) {
  for (const el of root.querySelectorAll('[data-action]')) {
    const action = el.dataset.action;

    el.addEventListener('pointerdown', e => {
      e.preventDefault();
      ensureFocus();
      try { el.setPointerCapture?.(e.pointerId); } catch { /* not fatal */ }
      el.classList.add('is-down');
      owned.set(e.pointerId, action);
      setFrom(src(e.pointerId), action, true);
    });

    const up = e => {
      el.classList.remove('is-down');
      owned.delete(e.pointerId);
      clearSource(src(e.pointerId));
    };
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
    // Dragging off a button must release it, or the key sticks down for good.
    el.addEventListener('pointerleave', up);

    el.addEventListener('contextmenu', e => e.preventDefault());
  }

  // Safety nets: a pointer or the window disappearing must never jam a key on.
  window.addEventListener('pointercancel', e => {
    owned.delete(e.pointerId);
    clearSource(src(e.pointerId));
  });
  window.addEventListener('blur', releaseAll);
  document.addEventListener('visibilitychange', () => { if (document.hidden) releaseAll(); });
}

export function isTouchDevice() {
  // navigator.maxTouchPoints > 0 is true on every Windows touchscreen laptop, which
  // put phone controls on top of the game for mouse-and-keyboard users. Require a
  // device with no hover-capable pointer instead, and let ?touch=1 force them on.
  return window.matchMedia('(hover: none) and (pointer: coarse)').matches;
}
