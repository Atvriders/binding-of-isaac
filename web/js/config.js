// Key identities Ruffle forwards into AVM1. `key`, `code` and `keyCode` are all
// supplied because Ruffle's DOM->Flash key mapping consults more than one of them.
export const KEYS = {
  up:     { key: 'w',        code: 'KeyW',       keyCode: 87 },
  left:   { key: 'a',        code: 'KeyA',       keyCode: 65 },
  down:   { key: 's',        code: 'KeyS',       keyCode: 83 },
  right:  { key: 'd',        code: 'KeyD',       keyCode: 68 },
  shootUp:    { key: 'ArrowUp',    code: 'ArrowUp',    keyCode: 38 },
  shootLeft:  { key: 'ArrowLeft',  code: 'ArrowLeft',  keyCode: 37 },
  shootDown:  { key: 'ArrowDown',  code: 'ArrowDown',  keyCode: 40 },
  shootRight: { key: 'ArrowRight', code: 'ArrowRight', keyCode: 39 },
  bomb:   { key: 'e',        code: 'KeyE',       keyCode: 69 },
  item:   { key: ' ',        code: 'Space',      keyCode: 32 },
  pill:   { key: 'q',        code: 'KeyQ',       keyCode: 81 },
  pause:  { key: 'Escape',   code: 'Escape',     keyCode: 27 },
  confirm:{ key: 'Enter',    code: 'Enter',      keyCode: 13 },
  map:    { key: 'Tab',      code: 'Tab',        keyCode: 9  },
};

// Standard Gamepad layout -> logical action.
export const PAD_BUTTONS = {
  0: 'shootDown', 1: 'shootRight', 2: 'shootLeft', 3: 'shootUp', // face diamond = twin-stick fire
  4: 'pill', 5: 'bomb',      // shoulders
  6: 'item', 7: 'bomb',      // triggers
  8: 'map',  9: 'pause',     // back / start
  12: 'up', 13: 'down', 14: 'left', 15: 'right', // d-pad
};

export const PAD_AXES = {
  moveX: 0, moveY: 1,   // left stick -> WASD
  aimX:  2, aimY:  3,   // right stick -> arrows
};

export const STICK_DEADZONE = 0.45;
