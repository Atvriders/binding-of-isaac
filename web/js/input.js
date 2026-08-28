// The single synthetic-key layer. Gamepad and touch both drive the game through
// here; a physical keyboard reaches Ruffle directly and never touches this file.
//
// Two facts about Ruffle 0.5.0 shape this design, both established by probing the
// bundle rather than assumed:
//   1. It registers keydown/keyup on `window` and performs no isTrusted check, so
//      dispatched events work — but it tracks focus on the <ruffle-player> element
//      and ignores keys while the player is not focused.
//   2. Nothing here may assume one source per key: a d-pad and a stick can both ask
//      for "up", and two fingers can hold the same button.
//
// State is therefore kept per source and OR-ed, never counted. A polling source can
// repeat its state every frame without the key ever sticking or double-firing.
import { KEYS } from './config.js';

let player = null;
let targets = [];
const sources = new Map();   // source id -> Set of actions that source wants held
const down = new Set();      // actions currently dispatched as keydown

export function bindTo(el) {
  player = el;
  targets = [el, el.shadowRoot?.querySelector('canvas')].filter(Boolean);
}

// Ruffle drops key events while the player is unfocused, which would otherwise make
// every button on screen and on the pad do nothing until the user clicks the game.
export function ensureFocus() {
  if (!player) return;
  const root = player.getRootNode?.();
  const active = root instanceof ShadowRoot ? root.activeElement : document.activeElement;
  if (active !== player) {
    try { player.focus({ preventScroll: true }); } catch { /* non-fatal */ }
  }
}

function dispatch(type, action) {
  const k = KEYS[action];
  if (!k || targets.length === 0) return;
  for (const t of targets) {
    t.dispatchEvent(new KeyboardEvent(type, {
      key: k.key, code: k.code, keyCode: k.keyCode, which: k.keyCode,
      bubbles: true, composed: true, cancelable: true,
    }));
  }
}

function reconcile(action) {
  let wanted = false;
  for (const set of sources.values()) if (set.has(action)) { wanted = true; break; }
  if (wanted && !down.has(action)) {
    ensureFocus();
    down.add(action);
    dispatch('keydown', action);
  } else if (!wanted && down.has(action)) {
    down.delete(action);
    dispatch('keyup', action);
  }
}

/** Declare, idempotently, whether `source` wants `action` held. */
export function setFrom(source, action, on) {
  let set = sources.get(source);
  if (!set) { set = new Set(); sources.set(source, set); }
  if (on) set.add(action); else set.delete(action);
  reconcile(action);
}

/** Drop everything a source was holding (pad unplugged, finger lifted, tab hidden). */
export function clearSource(source) {
  const set = sources.get(source);
  if (!set) return;
  const actions = [...set];
  sources.delete(source);
  for (const a of actions) reconcile(a);
}

export function releaseAll() {
  const actions = new Set();
  for (const set of sources.values()) for (const a of set) actions.add(a);
  sources.clear();
  for (const a of actions) reconcile(a);
}

// Convenience for one-off presses (menus, tests).
export const press   = action => setFrom('manual', action, true);
export const release = action => setFrom('manual', action, false);

export const heldActions = () => [...down];
export const isHeld = action => down.has(action);

if (typeof window !== 'undefined') {
  window.__isaacInput = { setFrom, clearSource, press, release, releaseAll,
                          heldActions, isHeld, ensureFocus };
}
