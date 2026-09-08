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

const TESS_BASE = '/vendor/tesseract';
// Where the pickup banner is drawn, as fractions of the stage.
const DEFAULT_BANNER = { x: 0.015, y: 0.76, w: 0.52, h: 0.19 };
const POLL_MS = 400;
const REPEAT_SUPPRESS_MS = 8000;

let running = false;
let video = null, stream = null, work = null, worker = null;
let lastSig = null, lastHit = { name: null, at: 0 };
let listeners = new Set();

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
    tessedit_pageseg_mode: '7',        // treat the crop as a single text line
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

async function tick(items) {
  if (!running || !video || video.readyState < 2) return;
  const r = bannerRegion();
  const vw = video.videoWidth, vh = video.videoHeight;
  if (!vw || !vh) return;

  const sx = Math.floor(vw * r.x), sy = Math.floor(vh * r.y);
  const sw = Math.floor(vw * r.w), sh = Math.floor(vh * r.h);
  work.width = sw; work.height = sh;
  const ctx = work.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(video, sx, sy, sw, sh, 0, 0, sw, sh);
  const img = ctx.getImageData(0, 0, sw, sh);

  const sig = signature(img.data);
  const changed = !lastSig || sig.hash !== lastSig.hash;
  lastSig = sig;
  // A banner is high-contrast text on a dark plate; an empty floor is flat.
  if (!changed || sig.variance < 180) return;

  // Threshold to black-on-white, which is what the OCR engine expects.
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const lum = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
    const v = lum > 110 ? 0 : 255;      // banner text is light on dark, so invert
    d[i] = d[i + 1] = d[i + 2] = v; d[i + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);

  let text = '';
  try {
    const w = await getWorker();
    ({ data: { text } } = await w.recognize(work));
  } catch (e) {
    stopPickupWatch();
    listeners.forEach(fn => fn({ error: String(e.message || e) }));
    return;
  }

  const line = String(text || '').split('\n').map(s => s.trim()).filter(Boolean)[0] || '';
  const hit = bestMatch(line, items);
  if (!hit) return;

  const now = Date.now();
  if (hit.item.name === lastHit.name && now - lastHit.at < REPEAT_SUPPRESS_MS) return;
  lastHit = { name: hit.item.name, at: now };
  listeners.forEach(fn => fn({ item: hit.item, score: hit.score, read: line }));
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
    running = true;
    lastSig = null;
    (async function loop() {
      while (running) {
        try { await tick(items()); } catch { /* a bad frame must not kill the loop */ }
        await new Promise(r => setTimeout(r, POLL_MS));
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
