import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import { chromium } from 'playwright-core';
import { chromePath, LAUNCH_ARGS } from './helpers/chrome.mjs';
import { startServer, REPO, nginxCsp } from './helpers/serve.mjs';
import { sig, isBlank, saturate, collectNew, waitForPaint, changedDuring } from './helpers/game.mjs';
import { reachMenu, enterRun, clickStage } from './helpers/flow.mjs';

const WEB = path.join(REPO, 'web');
const RUFFLE = path.join(WEB, 'ruffle');
const GAME = path.join(REPO, 'game');

const ready = fs.existsSync(path.join(RUFFLE, 'ruffle.js'))
           && fs.existsSync(path.join(GAME, 'isaac.swf'));

let srv, browser, page;
const pageErrors = [];
const cspViolations = [];

before(async () => {
  if (!ready) return;
  // Serve under the container's real Content-Security-Policy so the suite catches
  // policy violations that would otherwise only appear behind nginx.
  srv = await startServer({ webRoot: WEB, ruffleDir: RUFFLE, gameDir: GAME,
                            csp: nginxCsp() });
  browser = await chromium.launch({ executablePath: chromePath(), headless: true,
                                    args: LAUNCH_ARGS });
  page = await browser.newPage({ viewport: { width: 1000, height: 800 } });
  page.on('pageerror', e => pageErrors.push(String(e)));
  await page.addInitScript(() => {
    window.__csp = [];
    document.addEventListener('securitypolicyviolation',
      e => window.__csp.push(`${e.violatedDirective} blocked ${e.blockedURI}`));
  });
  await page.goto(`${srv.url}/?renderer=canvas&touch=1`, { waitUntil: 'load' });
});

after(async () => {
  await browser?.close();
  await srv?.close();
});

const skip = ready ? false : 'run scripts/fetch-assets.sh first';

test('the emulator boots the game and reports Flash metadata', { skip }, async () => {
  await page.waitForFunction(() => window.__player?.metadata != null, { timeout: 120000 });
  const m = await page.evaluate(() => window.__player.metadata);
  assert.equal(m.width, 800, 'stage width');
  assert.equal(m.height, 600, 'stage height');
  assert.equal(m.frameRate, 30, 'frame rate');
  assert.equal(m.swfVersion, 8, 'SWF version');
  assert.equal(m.isActionScript3, false, 'must be the AS2 build Ruffle handles well');
  assert.equal(m.uncompressedLength, 36209977, 'full game size');
});

test('the loading overlay clears and the canvas renders real content', { skip }, async () => {
  await page.waitForFunction(() => document.getElementById('loading')?.hidden === true,
                             { timeout: 60000 });
  const paintMs = await waitForPaint(page);
  console.log(`      first painted frame after ${paintMs}ms`);
  assert.equal(await isBlank(page), false, 'canvas must not be blank');
  const a = await sig(page);
  await page.waitForTimeout(4000);
  const b = await sig(page);
  assert.notEqual(a, b, 'the game must animate, not sit on a frozen frame');
});

test('overlays actually disappear instead of merely having the hidden property',
  { skip }, async () => {
  // Asserting el.hidden === true proves nothing: a class that sets display beats the
  // UA's [hidden] rule, leaving the overlay on screen over the game.
  const state = await page.evaluate(() => {
    const out = {};
    for (const id of ['loading', 'boot-error', 'help']) {
      const el = document.getElementById(id);
      out[id] = { hiddenAttr: el.hasAttribute('hidden') || el.hidden,
                  display: getComputedStyle(el).display,
                  paints: el.getClientRects().length > 0 };
    }
    return out;
  });
  for (const [id, s] of Object.entries(state)) {
    if (!s.hiddenAttr) continue;
    assert.equal(s.display, 'none', `#${id} is marked hidden but computes ${s.display}`);
    assert.equal(s.paints, false, `#${id} is marked hidden but still paints`);
  }
});

test('nothing covers the game surface, because overlays block the clicks Ruffle needs',
  { skip }, async () => {
  const hit = await page.evaluate(() => {
    const r = document.getElementById('stage').getBoundingClientRect();
    const el = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return el?.tagName?.toLowerCase() ?? null;
  });
  assert.equal(hit, 'ruffle-player',
    `the centre of the stage hits <${hit}>; an overlay there eats input`);
});

test('the player element fills its container instead of Flash\'s legacy 550x400',
  { skip }, async () => {
  const box = await page.evaluate(() => {
    const r = window.__player.getBoundingClientRect();
    const s = document.getElementById('stage').getBoundingClientRect();
    return { pw: Math.round(r.width), ph: Math.round(r.height),
             sw: Math.round(s.width), sh: Math.round(s.height) };
  });
  assert.equal(box.pw, box.sw, 'player width must match the stage');
  assert.equal(box.ph, box.sh, 'player height must match the stage');
  assert.ok(box.pw > 550, `player must not fall back to 550px (got ${box.pw})`);
});

// Everything below shares one long-lived session: reaching the menu is slow, so
// it is paid once and then reused.
let menuBaseline, runBaseline;

test('the game reaches its main menu', { skip }, async () => {
  const { set, saturated, ms } = await reachMenu(page);
  assert.ok(saturated, `the menu never settled within ${Math.round(ms / 1000)}s`);
  assert.ok(set.size > 1, 'a live screen should cycle through more than one frame');
  menuBaseline = set;
  console.log(`      menu reached in ${Math.round(ms / 1000)}s, ${set.size} frames`);
});

test('clicking through the menus starts a real run', { skip }, async () => {
  // The menu and character select are mouse driven, so this is also the proof that
  // pointer input reaches the emulator at all.
  const { set, ms } = await enterRun(page);
  const novel = [...set].filter(x => !menuBaseline.has(x));
  assert.ok(novel.length > 0,
    'the screen never changed, so the menu clicks never reached the game');
  runBaseline = set;
  console.log(`      run started after ${Math.round(ms / 1000)}s, ${set.size} frames`);
});

test('real keyboard moves the character in a live run', { skip }, async () => {
  // A player clicks the game before typing; the synthetic path self-focuses, so only
  // this one needs the click made explicit.
  await clickStage(page, 400, 300);
  await page.waitForTimeout(600);
  const r = await changedDuring(page, async () => {
    await page.keyboard.down('KeyD');
    await page.waitForTimeout(1600);
    await page.keyboard.up('KeyD');
  });
  assert.ok(r.changed, `holding D never changed the screen (${r.seen} distinct frames)`);
  for (const x of await collectNew(page, runBaseline, 2500)) runBaseline.add(x);
});

test('SYNTHETIC keyboard moves the character (gamepad and touch depend on this)',
  { skip }, async () => {
  // The load-bearing assertion of the whole input design: if Ruffle ignored events it
  // did not receive from a real keyboard, the gamepad and on-screen controls would
  // both be dead buttons.
  const r = await changedDuring(page, () => page.evaluate(async () => {
    const i = window.__isaacInput;
    i.press('left');
    await new Promise(res => setTimeout(res, 1600));
    i.release('left');
  }));
  assert.ok(r.changed,
    'a synthetic keypress never moved the character; gamepad and touch cannot work');
  for (const x of await collectNew(page, runBaseline, 2500)) runBaseline.add(x);
});

test('a synthetic shoot key also registers in game', { skip }, async () => {
  const r = await changedDuring(page, () => page.evaluate(async () => {
    const i = window.__isaacInput;
    i.press('shootRight');
    await new Promise(res => setTimeout(res, 1400));
    i.release('shootRight');
  }));
  assert.ok(r.changed, 'firing should change the screen');
});

test('the input layer OR-s sources and never leaves a key stuck', { skip }, async () => {
  const r = await page.evaluate(() => {
    const i = window.__isaacInput;
    i.releaseAll();
    i.setFrom('a', 'left', true);
    i.setFrom('b', 'left', true);            // two sources want the same key
    const bothHeld = i.isHeld('left');
    i.setFrom('a', 'left', false);
    const stillHeld = i.isHeld('left');      // one let go, the other has not
    i.setFrom('b', 'left', false);
    const released = i.isHeld('left');
    i.setFrom('c', 'up', true);
    i.clearSource('c');
    const afterClear = i.isHeld('up');
    i.releaseAll();
    return { bothHeld, stillHeld, released, afterClear, held: i.heldActions() };
  });
  assert.equal(r.bothHeld, true, 'key should be held');
  assert.equal(r.stillHeld, true, 'one source releasing must not drop a key another holds');
  assert.equal(r.released, false, 'the last source releasing must drop the key');
  assert.equal(r.afterClear, false, 'clearSource must drop that source\'s keys');
  assert.deepEqual(r.held, [], 'releaseAll must clear everything');
});

test('a polling source repeating its state never jams a key on', { skip }, async () => {
  // Regression: a per-call refcount made a 60fps poller unreleasable.
  const r = await page.evaluate(() => {
    const i = window.__isaacInput;
    i.releaseAll();
    for (let n = 0; n < 300; n++) i.setFrom('pad', 'right', true);
    const held = i.isHeld('right');
    i.setFrom('pad', 'right', false);        // one release must be enough
    const after = i.isHeld('right');
    i.releaseAll();
    return { held, after };
  });
  assert.equal(r.held, true, 'repeated presses should hold the key');
  assert.equal(r.after, false, 'a single release must clear a repeatedly-set key');
});

test('the player is focused, because Ruffle drops keys when it is not', { skip }, async () => {
  const focused = await page.evaluate(() => {
    window.__isaacInput.ensureFocus();
    return document.activeElement === window.__player;
  });
  assert.equal(focused, true, 'the game must hold focus or all input is swallowed');
});

test('gamepad state translates into the correct game actions', { skip }, async () => {
  // gamepad.js imports the input layer directly, so assert on the layer's real
  // held-key state rather than trying to spy on the module binding.
  const held = await page.evaluate(async () => {
    window.__isaacInput.releaseAll();
    // Button 5 is bomb, and so is button 7 (unpressed). The d-pad "up" (button 12,
    // unpressed) shares an action with the left stick. Both pairs must not cancel.
    const pad = {
      connected: true, index: 0, mapping: 'standard',
      buttons: Array.from({ length: 16 },
        (_, i) => ({ pressed: i === 5, value: i === 5 ? 1 : 0, touched: i === 5 })),
      axes: [-1, -1, 0, 1],   // left stick left+up, right stick down
    };
    const realGet = navigator.getGamepads.bind(navigator);
    navigator.getGamepads = () => [pad];
    await new Promise(r => setTimeout(r, 400));   // let several rAF polls run
    const snapshot = window.__isaacInput.heldActions();
    navigator.getGamepads = realGet;
    await new Promise(r => setTimeout(r, 200));
    window.__isaacInput.releaseAll();
    return snapshot;
  });
  assert.ok(held.includes('left'), `left stick should move left (held: ${held})`);
  assert.ok(held.includes('up'),
    `left stick up must survive the unpressed d-pad mapping to the same action (held: ${held})`);
  assert.ok(held.includes('shootDown'), `right stick down should shoot down (held: ${held})`);
  assert.ok(held.includes('bomb'),
    `button 5 should be bomb even though button 7 also maps to it (held: ${held})`);
});

test('on-screen touch buttons drive the same input layer', { skip }, async () => {
  const result = await page.evaluate(async () => {
    const layer = document.getElementById('touch-controls');
    layer.hidden = false;
    const btn = layer.querySelector('[data-action="right"]');
    const opts = { bubbles: true, cancelable: true, pointerId: 1, pointerType: 'touch' };
    btn.dispatchEvent(new PointerEvent('pointerdown', opts));
    const down = window.__isaacInput.heldActions().includes('right');
    const styled = btn.classList.contains('is-down');
    btn.dispatchEvent(new PointerEvent('pointerup', opts));
    const up = window.__isaacInput.heldActions().includes('right');

    // Dragging off a button must release it, not leave the key jammed on.
    btn.dispatchEvent(new PointerEvent('pointerdown', opts));
    btn.dispatchEvent(new PointerEvent('pointerleave', opts));
    const afterDragOff = window.__isaacInput.heldActions().includes('right');

    layer.hidden = true;
    window.__isaacInput.releaseAll();
    return { down, styled, up, afterDragOff };
  });
  assert.equal(result.down, true, 'pointerdown should hold the key');
  assert.equal(result.styled, true, 'pressed button should show its pressed state');
  assert.equal(result.up, false, 'pointerup should release the key');
  assert.equal(result.afterDragOff, false, 'dragging off a button must release it');
});

test('fullscreen can be invoked without error', { skip }, async () => {
  const err = await page.evaluate(() => {
    try { document.getElementById('btn-fullscreen').click(); return null; }
    catch (e) { return String(e); }
  });
  assert.equal(err, null);
});

test('browser storage persists across a reload, which is where saves live',
  { skip }, async () => {
  // Ruffle keeps Flash SharedObject data in localStorage, so persistence is a
  // property of the browser origin, not the container.
  //
  // This deliberately does NOT assert that the game has written a save by now: the
  // game persists at its own checkpoints, and standing in the first room for a few
  // seconds is not one of them. Asserting otherwise would be testing a guess.
  const gameKeys = await page.evaluate(() => Object.keys(localStorage));
  console.log(`      game-written keys so far: ${JSON.stringify(gameKeys)}`);

  const dump = () => page.evaluate(() =>
    Object.entries(localStorage).map(([k, v]) => `${k}=${v}`).sort());

  await page.evaluate(() => localStorage.setItem('persist-probe', 'v1'));
  const snapshot = await dump();            // sorted: enumeration order is not stable

  await page.reload({ waitUntil: 'load' });
  const after = await dump();
  assert.ok(after.includes('persist-probe=v1'), 'stored data must survive a reload');
  for (const entry of snapshot) {
    assert.ok(after.includes(entry), `reload lost stored entry: ${entry}`);
  }

  await page.evaluate(() => localStorage.removeItem('persist-probe'));
});

test('the save backup captures Ruffle-style keys whatever their shape', { skip }, async () => {
  // Ruffle derives storage keys from the movie URL, so the backup must not filter on
  // a guessed prefix. It takes everything except keys this app owns.
  const r = await page.evaluate(async () => {
    const m = await import('/js/saves.js');
    const key = '//127.0.0.1/game/isaac.swf/isaacSave';
    localStorage.setItem(key, 'abc');
    localStorage.setItem('cabinet:ui-pref', 'should-not-be-exported');
    const entries = m.readSaves();
    localStorage.removeItem(key);
    localStorage.removeItem('cabinet:ui-pref');
    return { captured: key in entries, skippedAppKey: !('cabinet:ui-pref' in entries) };
  });
  assert.equal(r.captured, true, 'a Ruffle-shaped save key must be backed up');
  assert.equal(r.skippedAppKey, true, 'app-owned keys must not be exported as saves');
});

test('save export and import round-trips through the backup format', { skip }, async () => {
  const ok = await page.evaluate(async () => {
    const m = await import('/js/saves.js');
    const probeKey = 'ruffle-test-roundtrip';
    localStorage.setItem(probeKey, 'payload-42');
    const entries = m.readSaves();
    if (!(probeKey in entries)) return 'readSaves missed the entry';
    const doc = JSON.stringify({ format: 'isaac-cabinet-save', version: 1, entries });
    localStorage.removeItem(probeKey);
    const n = m.importSaves(doc);
    if (localStorage.getItem(probeKey) !== 'payload-42') return 'import did not restore';
    localStorage.removeItem(probeKey);
    try { m.importSaves('{"format":"nope"}'); return 'bad file was not rejected'; }
    catch { /* expected */ }
    return n > 0 ? 'ok' : 'import reported nothing';
  });
  assert.equal(ok, 'ok');
});

test('no uncaught page errors during the whole session', { skip }, async () => {
  assert.deepEqual(pageErrors, [], `page errors: ${pageErrors.join(' | ')}`);
});

test('the default WebGL renderer paints and animates', { skip }, async () => {
  // A separate page on the real default config, since the session above forces canvas.
  const p2 = await browser.newPage({ viewport: { width: 1000, height: 800 } });
  try {
    await p2.goto(srv.url, { waitUntil: 'load' });
    await p2.waitForFunction(() => window.__player?.metadata != null, { timeout: 120000 });
    await p2.waitForFunction(() => document.getElementById('loading')?.hidden === true,
                             { timeout: 60000 });
    await p2.waitForTimeout(6000);
    const stage = p2.locator('#stage');
    const a = await stage.screenshot();
    await p2.waitForTimeout(5000);
    const b = await stage.screenshot();
    // A blank or solid frame compresses to a few KB; real artwork is far larger.
    assert.ok(a.length > 10000, `WebGL frame looks blank (${a.length} bytes)`);
    assert.ok(!a.equals(b), 'WebGL output must change over time');
  } finally { await p2.close(); }
});

test('the container\'s CSP does not break the emulator', { skip }, async () => {
  const v = await page.evaluate(() => window.__csp || []);
  assert.deepEqual([...new Set(v)], [],
    'nginx would send this policy in production, and these were blocked under it');
});

test('touch controls stay off on a hover-capable device', { skip }, async () => {
  // navigator.maxTouchPoints > 0 is true on Windows touchscreen laptops, which put
  // phone controls on top of the game for keyboard-and-mouse users.
  const p2 = await browser.newPage({ viewport: { width: 1000, height: 800 } });
  try {
    await p2.goto(srv.url, { waitUntil: 'load' });      // no ?touch override
    await p2.waitForFunction(() => window.__player != null, { timeout: 60000 });
    const state = await p2.evaluate(() => {
      const el = document.getElementById('touch-controls');
      return { hidden: el.hidden, display: getComputedStyle(el).display,
               coarse: matchMedia('(hover: none) and (pointer: coarse)').matches };
    });
    assert.equal(state.coarse, false, 'this test only means anything on a hover device');
    assert.equal(state.hidden, true, 'touch controls must be hidden on a hover device');
    assert.equal(state.display, 'none', 'and must not paint over the game');

    // ...but must still be available when explicitly asked for.
    await p2.goto(`${srv.url}/?touch=1`, { waitUntil: 'load' });
    await p2.waitForFunction(() => window.__player != null, { timeout: 60000 });
    const forced = await p2.evaluate(() =>
      document.getElementById('touch-controls').hidden);
    assert.equal(forced, false, '?touch=1 must force the controls on');
  } finally { await p2.close(); }
});
