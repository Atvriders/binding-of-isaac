// Frame sampling for the browser suite.
//
// Everything here goes through a composited screenshot, decoded back inside the
// page. drawImage() on a live WebGL canvas returns blank, so reading the canvas
// directly only works under Ruffle's canvas backend -- and that backend cannot do
// BitmapData.draw, which this game uses to composite rooms. Forcing it so pixels
// could be read meant the suite tested a renderer that freezes in real gameplay.

const DECODE = async ({ b64, region, w, h }) => {
  const img = new Image();
  await new Promise(res => { img.onload = res; img.src = 'data:image/png;base64,' + b64; });
  const c = document.createElement('canvas');
  c.width = img.width; c.height = img.height;
  const ctx = c.getContext('2d');
  ctx.drawImage(img, 0, 0);
  const x0 = Math.floor(c.width * region[0]), y0 = Math.floor(c.height * region[1]);
  const sw = Math.max(1, Math.floor(c.width * (region[2] - region[0])));
  const sh = Math.max(1, Math.floor(c.height * (region[3] - region[1])));
  const d = ctx.getImageData(x0, y0, sw, sh).data;

  // Coarse hash over a downsample, so a settled screen yields a small stable set.
  const small = document.createElement('canvas');
  small.width = w; small.height = h;
  const sx = small.getContext('2d');
  sx.drawImage(c, x0, y0, sw, sh, 0, 0, w, h);
  const sd = sx.getImageData(0, 0, w, h).data;
  let hash = 0;
  for (let i = 0; i < sd.length; i += 4) {
    hash = (hash * 31 + ((sd[i] >> 4 << 8) | (sd[i + 1] >> 4 << 4) | (sd[i + 2] >> 4))) | 0;
  }
  const counts = new Map();
  let red = 0;
  for (let i = 0; i < d.length; i += 4) {
    const k = `${d[i]},${d[i + 1]},${d[i + 2]}`;
    counts.set(k, (counts.get(k) || 0) + 1);
    if (d[i] > 110 && d[i + 1] < 70 && d[i + 2] < 70) red++;
  }
  const n = d.length / 4;
  const top = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
  return { hash, distinct: counts.size, dominantPct: +(top[1] / n * 100).toFixed(1),
           redPct: +(red / n * 100).toFixed(2) };
};

async function frame(page, region = [0, 0, 1, 1], w = 32, h = 24) {
  const buf = await page.locator('#stage').screenshot();
  return page.evaluate(DECODE, { b64: buf.toString('base64'), region, w, h });
}

/** Coarse signature of the whole stage. */
export async function sig(page) {
  return (await frame(page)).hash;
}

/** Pixel statistics for a sub-region, given as fractions of the stage. */
export async function sampleRegion(page, _selector, region) {
  const { distinct, dominantPct, redPct } = await frame(page, region);
  return { distinct, dominantPct, redPct };
}

export async function isBlank(page) {
  return (await frame(page)).distinct < 4;
}

/** Wait for the first painted frame rather than assuming a fixed delay. */
export async function waitForPaint(page, timeout = 45000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    if (!(await isBlank(page))) return Date.now() - t0;
    await page.waitForTimeout(500);
  }
  throw new Error(`canvas never painted within ${timeout}ms`);
}

/** Sample until no new signature appears for `stableMs`. */
export async function saturate(page, { stableMs = 20000, maxMs = 300000, every = 700 } = {}) {
  const set = new Set();
  const t0 = Date.now();
  let lastNew = Date.now();
  while (Date.now() - t0 < maxMs) {
    set.add(await sig(page));
    if (set.size && Date.now() - lastNew > stableMs) {
      return { set, saturated: true, ms: Date.now() - t0 };
    }
    const before = set.size;
    await page.waitForTimeout(every);
    if (set.size !== before) lastNew = Date.now();
  }
  return { set, saturated: false, ms: Date.now() - t0 };
}

/** Signatures seen in a window that are not already in `baseline`. */
export async function collectNew(page, baseline, ms = 9000, every = 500) {
  const fresh = new Set();
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    const s = await sig(page);
    if (!baseline.has(s)) fresh.add(s);
    await page.waitForTimeout(every);
  }
  return fresh;
}

/** Did the screen change at any point while `act` ran?
 *  Sampling throughout is far more sensitive than comparing two endpoints, which
 *  aliases when a sprite returns to a similar pose. */
export async function changedDuring(page, act, { samples = 10, every = 200 } = {}) {
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
