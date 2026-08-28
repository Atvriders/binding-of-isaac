// Ruffle stores Flash SharedObject data in browser localStorage, so progress lives
// in the browser rather than the container. Restarting or updating the container
// cannot touch it; clearing site data destroys it. These helpers make a real,
// off-browser backup possible.

// Ruffle derives its storage keys from the movie URL, so their exact shape is not
// something to guess at. This page is a dedicated origin that stores nothing else,
// so everything in localStorage is game data except keys this app owns itself.
const APP_PREFIX = 'cabinet:';

function saveKeys() {
  return Object.keys(localStorage).filter(k => !k.startsWith(APP_PREFIX));
}

export function readSaves() {
  const out = {};
  for (const k of saveKeys()) out[k] = localStorage.getItem(k);
  return out;
}

export function saveCount() { return saveKeys().length; }

export function exportSaves() {
  const payload = {
    format: 'isaac-cabinet-save',
    version: 1,
    exportedAt: new Date().toISOString(),
    entries: readSaves(),
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `isaac-save-${payload.exportedAt.slice(0, 10)}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return Object.keys(payload.entries).length;
}

export function importSaves(text) {
  let data;
  try { data = JSON.parse(text); }
  catch { throw new Error('That file is not valid JSON.'); }
  if (data?.format !== 'isaac-cabinet-save' || !data.entries)
    throw new Error('That file is not an Isaac save export.');
  let n = 0;
  for (const [k, v] of Object.entries(data.entries)) {
    if (typeof v === 'string') { localStorage.setItem(k, v); n++; }
  }
  return n;
}
