// Polls the Gamepad API each frame and translates pad state into the shared input
// layer. Ruffle has no gamepad support of its own.
import { PAD_BUTTONS, PAD_AXES, STICK_DEADZONE } from './config.js';
import { setFrom, clearSource } from './input.js';

const SOURCE = 'pad';
let running = false;
let connected = 0;
const listeners = new Set();

// Several controls legitimately map to one action: the d-pad and the left stick both
// mean "up", and two buttons both mean "bomb". Their contributions must be OR-ed for
// the frame before being applied, or an unpressed control cancels a pressed one.
function collect(gp, want) {
  for (const [idx, action] of Object.entries(PAD_BUTTONS)) {
    const b = gp.buttons[idx];
    want(action, !!b && (b.pressed || b.value > 0.5));
  }
  const axis = (xIdx, yIdx, a) => {
    const x = gp.axes[xIdx] ?? 0, y = gp.axes[yIdx] ?? 0;
    want(a.left,  x < -STICK_DEADZONE);
    want(a.right, x >  STICK_DEADZONE);
    want(a.up,    y < -STICK_DEADZONE);
    want(a.down,  y >  STICK_DEADZONE);
  };
  axis(PAD_AXES.moveX, PAD_AXES.moveY,
       { left: 'left', right: 'right', up: 'up', down: 'down' });
  axis(PAD_AXES.aimX, PAD_AXES.aimY,
       { left: 'shootLeft', right: 'shootRight', up: 'shootUp', down: 'shootDown' });
}

function poll() {
  if (!running) return;
  const pads = navigator.getGamepads ? navigator.getGamepads() : [];
  const desired = new Map();
  const want = (action, on) => desired.set(action, (desired.get(action) || false) || on);

  let live = 0;
  for (const gp of pads) {
    if (!gp) continue;
    live++;
    collect(gp, want);
  }
  // setFrom is idempotent, so repeating the same state every frame is free.
  for (const [action, on] of desired) setFrom(SOURCE, action, on);

  if (live !== connected) {
    connected = live;
    listeners.forEach(fn => fn(live));
    if (live === 0) clearSource(SOURCE);   // pad yanked mid-hold must not stick
  }
  requestAnimationFrame(poll);
}

export function startGamepad() {
  if (running) return;
  running = true;
  requestAnimationFrame(poll);
}

export function stopGamepad() { running = false; clearSource(SOURCE); }
export function onPadCountChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }
export function padCount() { return connected; }
