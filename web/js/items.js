// The item browser panel.
//
// Ruffle registers its key handlers on `window`, so anything typed while this panel
// is open would also drive the character. A capture-phase listener on `window` runs
// before anything Ruffle registers there, so stopping propagation means the game
// genuinely never sees the keystroke.
import { search } from './match.js';
import { ensureFocus, releaseAll, setFocusSuppressed } from './input.js';

const DATA_URL = '/data/items.json';

let items = [];
let loadError = null;
let open = false;
let els = null;

export function itemList() { return items; }
export function isOpen() { return open; }

export async function loadItems() {
  try {
    const res = await fetch(DATA_URL, { cache: 'no-cache' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    items = Array.isArray(data.items) ? data.items : [];
    if (items.length === 0) throw new Error('list was empty');
    loadError = null;
  } catch (e) {
    items = [];
    loadError = String(e.message || e);
  }
  return { count: items.length, error: loadError };
}

function render(query) {
  const results = search(query, items);
  els.count.textContent = items.length === 0
    ? (loadError ? 'Item list unavailable' : 'Loading…')
    : `${results.length} of ${items.length}`;

  if (items.length === 0) {
    els.results.innerHTML = '';
    els.empty.hidden = false;
    els.empty.textContent = loadError
      ? `The item list could not be loaded (${loadError}). The game is unaffected; ` +
        'the container fetches this list in the background.'
      : 'Loading the item list…';
    return;
  }
  els.empty.hidden = results.length > 0;
  if (results.length === 0) els.empty.textContent = 'No items match that search.';

  els.results.innerHTML = '';
  const frag = document.createDocumentFragment();
  for (const it of results) {
    const li = document.createElement('li');
    li.className = 'item-row';
    const h = document.createElement('div');
    h.className = 'item-row-head';
    const name = document.createElement('span');
    name.className = 'item-name';
    name.textContent = it.name;
    const id = document.createElement('span');
    id.className = 'item-id';
    id.textContent = it.id == null ? '' : `#${it.id}`;
    h.append(name, id);
    const desc = document.createElement('p');
    desc.className = 'item-desc';
    desc.textContent = it.description || '';
    li.append(h, desc);
    if (it.url) {
      const a = document.createElement('a');
      a.className = 'item-link';
      a.href = it.url;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      a.textContent = 'source';
      li.append(a);
    }
    frag.append(li);
  }
  els.results.append(frag);
}

export function openPanel(prefill = '') {
  if (!els) return;
  open = true;
  setFocusSuppressed(true);     // stop the game reclaiming focus from the search box
  releaseAll();                 // never leave a direction held while typing
  els.panel.hidden = false;
  els.search.value = prefill;
  render(prefill);
  els.search.focus();
  els.search.select();
}

export function closePanel() {
  if (!els) return;
  open = false;
  els.panel.hidden = true;
  setFocusSuppressed(false);
  ensureFocus();                // hand the keyboard back to the game
}

export function togglePanel() { open ? closePanel() : openPanel(); }

/**
 * Keep the keyboard away from the game while the panel is open.
 *
 * Must be installed BEFORE the Ruffle player is created. Ruffle registers its key
 * handlers on `window` too, and stopImmediatePropagation only suppresses listeners
 * added after ours on the same target -- stopPropagation alone would not stop it at
 * all, since that only halts travel to *other* nodes.
 */
export function installKeyIsolation() {
  const guard = e => {
    if (!open) {
      if (e.type === 'keydown' && e.key === 'k' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        e.stopImmediatePropagation();
        openPanel();
      }
      return;
    }
    if (e.type === 'keydown' && e.key === 'Escape') closePanel();
    e.stopImmediatePropagation();
  };
  window.addEventListener('keydown', guard, true);
  window.addEventListener('keyup', guard, true);
}

export function initItems() {
  els = {
    panel: document.getElementById('items-panel'),
    search: document.getElementById('items-search'),
    results: document.getElementById('items-results'),
    empty: document.getElementById('items-empty'),
    count: document.getElementById('items-count'),
  };
  if (!els.panel) return;

  els.search.addEventListener('input', () => render(els.search.value));
  document.getElementById('btn-items').addEventListener('click', () => togglePanel());
  document.getElementById('btn-items-close').addEventListener('click', () => closePanel());
  els.panel.addEventListener('click', e => { if (e.target === els.panel) closePanel(); });

  // Ruffle can pull focus back to the player on its own while a run is in progress.
  // If that happens while the panel is open, take it back so typing lands here.
  document.addEventListener('focusin', () => {
    if (!open || !els) return;
    if (els.panel.contains(document.activeElement)) return;
    els.search.focus();
  });

  loadItems().then(() => { if (open) render(els.search.value); });
}
