// The game animates continuously, so "the screen changed" proves nothing about
// input. These helpers build a *saturated* set of frame signatures for the current
// screen; once saturated, any new signature means the game changed state.

export const sig = page => page.evaluate(() => {
  const c = window.__player?.shadowRoot?.querySelector('canvas');
  if (!c) return null;
  const t = document.createElement('canvas');
  t.width = 32; t.height = 24;
  const x = t.getContext('2d');
  x.drawImage(c, 0, 0, 32, 24);
  const d = x.getImageData(0, 0, 32, 24).data;
  let h = 0;
  for (let i = 0; i < d.length; i += 4)
    h = (h * 31 + ((d[i] >> 4 << 8) | (d[i + 1] >> 4 << 4) | (d[i + 2] >> 4))) | 0;
  return h;
});

export const isBlank = page => page.evaluate(() => {
  const c = window.__player?.shadowRoot?.querySelector('canvas');
  if (!c) return true;
  const t = document.createElement('canvas');
  t.width = 64; t.height = 48;
  const x = t.getContext('2d');
  x.drawImage(c, 0, 0, 64, 48);
  const d = x.getImageData(0, 0, 64, 48).data;
  const seen = new Set();
  for (let i = 0; i < d.length; i += 4) seen.add(`${d[i]},${d[i+1]},${d[i+2]}`);
  return seen.size < 4;
});

/** Sample signatures until none new appears for `stableMs`. Returns the saturated set. */
export async function saturate(page, { stableMs = 20000, maxMs = 300000, every = 700 } = {}) {
  const set = new Set();
  const t0 = Date.now();
  let lastNew = Date.now();
  while (Date.now() - t0 < maxMs) {
    const s = await sig(page);
    if (s !== null && !set.has(s)) { set.add(s); lastNew = Date.now(); }
    if (set.size > 0 && Date.now() - lastNew > stableMs) return { set, saturated: true,
      ms: Date.now() - t0 };
    await page.waitForTimeout(every);
  }
  return { set, saturated: false, ms: Date.now() - t0 };
}

/** Collect signatures for a fixed window and report which are new vs a baseline. */
export async function collectNew(page, baseline, ms = 9000, every = 500) {
  const fresh = new Set();
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    const s = await sig(page);
    if (s !== null && !baseline.has(s)) fresh.add(s);
    await page.waitForTimeout(every);
  }
  return fresh;
}

/** loadedmetadata fires when the SWF header parses, long before the first frame is
 *  painted. Wait for actual pixels rather than asserting on an empty canvas. */
export async function waitForPaint(page, timeout = 45000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    if (!(await isBlank(page))) return Date.now() - t0;
    await page.waitForTimeout(500);
  }
  throw new Error(`canvas never painted within ${timeout}ms`);
}

/** Did the screen change at any point while `act` ran?
 *
 *  A single before/after comparison aliases: the character can move and land on a
 *  pose that hashes the same. Sampling throughout the action is far more sensitive. */
export async function changedDuring(page, act, { samples = 14, every = 150 } = {}) {
  const before = await sig(page);
  const running = act();
  const seen = new Set();
  for (let i = 0; i < samples; i++) {
    seen.add(await sig(page));
    await page.waitForTimeout(every);
  }
  await running;
  seen.add(await sig(page));
  return { changed: [...seen].some(s => s !== before), before, seen: seen.size };
}

/** Sample pixels from a composited screenshot, decoded back inside the page.
 *  drawImage() on a live WebGL canvas returns blank (no preserveDrawingBuffer), so
 *  reading the canvas directly only works under the canvas backend. This works
 *  under every renderer, which is the whole point. */
export async function sampleRegion(page, selector, [x0, y0, x1, y1]) {
  const buf = await page.locator(selector).screenshot();
  return page.evaluate(async ({ b64, r }) => {
    const img = new Image();
    await new Promise(res => { img.onload = res; img.src = 'data:image/png;base64,' + b64; });
    const c = document.createElement('canvas');
    c.width = img.width; c.height = img.height;
    const ctx = c.getContext('2d');
    ctx.drawImage(img, 0, 0);
    const d = ctx.getImageData(Math.floor(c.width * r[0]), Math.floor(c.height * r[1]),
                               Math.floor(c.width * (r[2] - r[0])),
                               Math.floor(c.height * (r[3] - r[1]))).data;
    const counts = new Map();
    let red = 0;
    for (let i = 0; i < d.length; i += 4) {
      const k = `${d[i]},${d[i + 1]},${d[i + 2]}`;
      counts.set(k, (counts.get(k) || 0) + 1);
      if (d[i] > 110 && d[i + 1] < 70 && d[i + 2] < 70) red++;
    }
    const n = d.length / 4;
    const top = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
    return { distinct: counts.size, dominantPct: +(top[1] / n * 100).toFixed(1),
             redPct: +(red / n * 100).toFixed(2) };
  }, { b64: buf.toString('base64'), r: [x0, y0, x1, y1] });
}
