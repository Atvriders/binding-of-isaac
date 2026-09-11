// Identifying the item you just picked up.
//
// Reading the game's pixels is only possible through captureStream(): drawImage on
// Ruffle's WebGL canvas returns blank without preserveDrawingBuffer (measured: 1
// distinct colour versus 749 from the same frame via captureStream).
//
// OCR is expensive, so a cheap change check on the banner region gates it. Matching
// is against the closed set of known item names, which is what makes reading a pixel
// font viable -- a garbled read still resolves to exactly one candidate, and
// anything that does not clear the threshold reports nothing.
import { bestMatch } from './match.js';
import { nextAnnounceState, BANNER_CLEAR_MS } from './announce.js';

// Versioned path. A CDN that cached a 404 for the unversioned path would otherwise
// keep serving it for the life of the cache entry, long after the file existed.
const TESS_BASE = '/vendor/tesseract-5';
// Where the pickup banner is drawn, as fractions of the stage.
//
// Measured from real pickups: the banner sits under the HUD at the TOP left -- the
// item icon in a circle, then the name in caps. The earlier value pointed at the
// bottom left, which is the floor label, so this was reading wall texture. The x
// offset skips the circular icon so OCR sees only the name.
// Measured against real pickups: the HUD's black bar ends at ~16.7% of stage
// height and the banner name sits just under it. Starting higher pulled the HUD's
// counters into the crop, and OCR read those instead of the item name.
// Full stage width. The banner is drawn two ways: left-aligned with a circular
// icon (Goat Hoof, Safety Cap) and centred across the room (Bobby - Bomb,
// Chocolate Milk). A left-anchored crop clips the right end of a centred name --
// "CHOCOLATE MIL" lost its K and only matched because the fuzzy pass tolerated it.
// Sizing off the longest name was the wrong model: alignment, not length, decides
// where the text ends.
const DEFAULT_BANNER = { x: 0, y: 0.16, w: 1, h: 0.075 };
// The banner slides in from the left, so the first frame that trips the change gate
// often holds a half-arrived name. Read a few frames and keep the best match rather
// than trusting whichever frame happened to fire.
const SETTLE_FRAMES = 4;
const SETTLE_GAP_MS = 260;
const POLL_MS = 400;
// A screen dense with text -- the death summary lists everything collected -- can
// keep the change gate open indefinitely. Back off after repeated misses so OCR
// cannot run flat out, and snap back the moment something matches.
const IDLE_POLL_MS = 1600;
const MISSES_BEFORE_BACKOFF = 6;
const VARIANCE_MIN = Number(
  new URLSearchParams(location.search).get('aidvar') ?? 180);


let running = false;
let video = null, stream = null, work = null, worker = null;
let lastSig = null, lastHit = { name: null, at: 0 };
let consecutiveMisses = 0;
let listeners = new Set();
let dbg = null;

/** ?aid=debug shows exactly what the detector samples: the crop, its variance, the
 *  OCR text and the match. Without this the only symptom is "nothing happened",
 *  which says nothing about which stage failed. */
function initDebug() {
  if (new URLSearchParams(location.search).get('aid') !== 'debug') return null;
  const box = document.createElement('div');
  box.id = 'aid-debug';
  box.style.cssText = 'position:fixed;left:8px;bottom:8px;z-index:40;background:#0d0b0a;' +
    'border:1px solid #b8412f;border-radius:6px;padding:6px;font:11px/1.4 monospace;' +
    'color:#e8e2dc;max-width:min(460px,46vw)';
  const cv = document.createElement('canvas');
  cv.style.cssText = 'display:block;width:100%;image-rendering:pixelated;' +
    'border:1px solid #2a2521;margin-bottom:4px';
  const txt = document.createElement('div');
  txt.textContent = 'Auto-ID debug: waiting for frames…';
  box.append(cv, txt);
  document.body.append(box);
  return { canvas: cv, text: txt };
}

function debugUpdate(cropCanvas, info) {
  if (!dbg) return;
  dbg.canvas.width = cropCanvas.width;
  dbg.canvas.height = cropCanvas.height;
  dbg.canvas.getContext('2d').drawImage(cropCanvas, 0, 0);
  dbg.text.textContent = info;
}

export function onPickup(fn) { listeners.add(fn); return () => listeners.delete(fn); }
export function isWatching() { return running; }

function bannerRegion() {
  const p = new URLSearchParams(location.search).get('banner');
  if (!p) return DEFAULT_BANNER;
  const [x, y, w, h] = p.split(',').map(Number);
  return [x, y, w, h].every(n => Number.isFinite(n)) ? { x, y, w, h } : DEFAULT_BANNER;
}

async function loadTesseract() {
  if (window.Tesseract) return window.Tesseract;
  await new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = `${TESS_BASE}/tesseract.min.js`;
    s.onload = res;
    s.onerror = () => rej(new Error('OCR engine is not installed in this image'));
    document.head.append(s);
  });
  if (!window.Tesseract) throw new Error('OCR engine failed to initialise');
  return window.Tesseract;
}

async function getWorker() {
  if (worker) return worker;
  const T = await loadTesseract();
  worker = await T.createWorker('eng', 1, {
    workerPath: `${TESS_BASE}/worker.min.js`,
    corePath: `${TESS_BASE}/core`,
    langPath: TESS_BASE,
gzip: true,
    logger: () => {},
  });
  // The banner is upper-case words; constraining the charset sharpens the read.
  await worker.setParameters({
    tessedit_char_whitelist: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz' -",
    // A block, not a single line: if anything else strays into the crop, we get it
    // as a separate line and can match each one instead of one merged mess.
    tessedit_pageseg_mode: '6',
  });
  return worker;
}

/** Coarse signature of the crop, used to skip OCR when nothing changed. */
function signature(data) {
  let sum = 0, sq = 0, hash = 0;
  for (let i = 0; i < data.length; i += 16) {
    const v = data[i];
    sum += v; sq += v * v;
    hash = (hash * 31 + (v >> 4)) | 0;
  }
  const n = data.length / 16;
  const mean = sum / n;
  return { hash, variance: sq / n - mean * mean };
}

/** Draw the banner crop into `work`. Returns its raw signature, or null. */
function prepareCrop(region) {
  if (!video || video.readyState < 2 || !work) return null;
  const vw = video.videoWidth, vh = video.videoHeight;
  if (!vw || !vh) return null;
  const sx = Math.floor(vw * region.x), sy = Math.floor(vh * region.y);
  const sw = Math.floor(vw * region.w), sh = Math.floor(vh * region.h);
  work.width = sw; work.height = sh;
  const ctx = work.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(video, sx, sy, sw, sh, 0, 0, sw, sh);
  const img = ctx.getImageData(0, 0, sw, sh);
  return { img, ctx, sig: signature(img.data), sw, sh };
}

/** Banner text is light on a dark plate; invert to the black-on-white OCR expects. */
function threshold(ctx, img) {
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const lum = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
    const v = lum > 110 ? 0 : 255;
    d[i] = d[i + 1] = d[i + 2] = v; d[i + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
}

async function tick(items) {
  if (!running) return;
  const region = bannerRegion();
  const first = prepareCrop(region);
  if (!first) return;

  const changed = !lastSig || first.sig.hash !== lastSig.hash;
  lastSig = first.sig;
  // A banner is high-contrast text on a dark plate; an empty floor is flat.
  const gated = !changed || first.sig.variance < VARIANCE_MIN;
  if (dbg) {
    debugUpdate(work, `region ${(region.x * 100).toFixed(1)},${(region.y * 100).toFixed(1)} ` +
      `${(region.w * 100).toFixed(1)}x${(region.h * 100).toFixed(1)}%  ${first.sw}x${first.sh}px\n` +
      `variance ${first.sig.variance.toFixed(0)} (min ${VARIANCE_MIN})  changed ${changed}` +
      `  -> ${gated ? 'SKIPPED' : 'running OCR'}`);
  }
  if (gated) return;
  threshold(first.ctx, first.img);

  // The banner slides in, so the frame that trips the gate often holds a
  // half-arrived name. Read a few frames and keep the best match.
  let hit = null, bestLine = '';
  for (let attempt = 0; attempt < SETTLE_FRAMES; attempt++) {
    if (attempt > 0) {
      await new Promise(res => setTimeout(res, SETTLE_GAP_MS));
      const next = prepareCrop(region);
      if (!next) break;
      threshold(next.ctx, next.img);
    }
    let text = '';
    try {
      const worker = await getWorker();
      ({ data: { text } } = await worker.recognize(work));
    } catch (e) {
      stopPickupWatch();
      listeners.forEach(fn => fn({ error: String(e.message || e) }));
      return;
    }
    for (const l of String(text || '').split('\n').map(t => t.trim()).filter(Boolean)) {
      const h = bestMatch(l, items);
      if (h && (!hit || h.score > hit.score)) { hit = h; bestLine = l; }
    }
    if (hit && hit.score > 0.95) break;   // an exact read needs no further frames
  }

  if (dbg) {
    dbg.text.textContent += `\nOCR read: ${JSON.stringify(bestLine)}\n` +
      (hit ? `match: ${hit.item.name} (${hit.score.toFixed(2)})`
           : `no match above threshold (${items.length} candidates)`);
  }
  consecutiveMisses = hit ? 0 : consecutiveMisses + 1;

  const decision = nextAnnounceState(lastHit, hit?.item?.name ?? null, Date.now());
  lastHit = decision.state;
  if (!decision.announce || !hit) return;
  listeners.forEach(fn => fn({ item: hit.item, score: hit.score, read: bestLine }));
}

export async function startPickupWatch(player, items) {
  if (running) return { ok: true };
  const canvas = player?.shadowRoot?.querySelector('canvas');
  if (!canvas?.captureStream) return { ok: false, error: 'This browser cannot capture the game canvas.' };
  try {
    stream = canvas.captureStream(5);
    video = document.createElement('video');
    video.muted = true; video.playsInline = true; video.srcObject = stream;
    await video.play();
    work = document.createElement('canvas');
    dbg = dbg || initDebug();
    running = true;
    lastSig = null;
    consecutiveMisses = 0;
    (async function loop() {
      while (running) {
        try { await tick(items()); } catch { /* a bad frame must not kill the loop */ }
        const wait = consecutiveMisses >= MISSES_BEFORE_BACKOFF ? IDLE_POLL_MS : POLL_MS;
        await new Promise(r => setTimeout(r, wait));
      }
    })();
    return { ok: true };
  } catch (e) {
    stopPickupWatch();
    return { ok: false, error: String(e.message || e) };
  }
}

export function stopPickupWatch() {
  running = false;
  try { stream?.getTracks().forEach(t => t.stop()); } catch { /* already gone */ }
  stream = null; video = null; work = null; lastSig = null;
}

// Exposed so the suite can drive the pipeline without a real pickup.
if (typeof window !== 'undefined') {
  window.__isaacPickup = { isWatching, bannerRegion, signature };
}
