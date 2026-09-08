// The item sidebar: a grid of icons beside the game, searchable.
//
// The sidebar is always on screen, so keyboard isolation is scoped to "focus is
// inside the sidebar" rather than "the panel is open". Isolating whenever it is
// visible would mean the game never receives a key again.
import { search } from './match.js';
import { ensureFocus, releaseAll } from './input.js';

const DATA_URL = '/data/items.json';
const WIDTH_KEY = 'cabinet:sidebar-width';
const COLLAPSED_KEY = 'cabinet:sidebar-collapsed';

let items = [];
let sprite = null;
let loadError = null;
let selected = null;
let els = null;

export function itemList() { return items; }
export function isOpen() { return !!els && !els.panel.hidden; }
/** True when the sidebar currently owns the keyboard. */
export function hasKeyboard() {
  return !!els && !els.panel.hidden && els.panel.contains(document.activeElement);
}

export async function loadItems() {
  try {
    const res = await fetch(DATA_URL, { cache: 'no-cache' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    items = Array.isArray(data.items) ? data.items : [];
    sprite = data.spriteUrl || null;
    if (items.length === 0) throw new Error('list was empty');
    loadError = null;
  } catch (e) {
    items = []; sprite = null;
    loadError = String(e.message || e);
  }
  return { count: items.length, error: loadError, sprite };
}

function showDetail(item) {
  selected = item;
  const d = els.detail;
  d.hidden = false;
  d.innerHTML = '';
  const h = document.createElement('h3');
  h.textContent = item.id == null ? item.name : `${item.name}  #${item.id}`;
  const p = document.createElement('p');
  p.textContent = item.description || '';
  d.append(h, p);
  if (item.url) {
    const a = document.createElement('a');
    a.href = item.url; a.target = '_blank'; a.rel = 'noopener noreferrer';
    a.textContent = 'View source';
    d.append(a);
  }
  for (const t of els.results.querySelectorAll('.tile')) {
    t.setAttribute('aria-selected', String(t.dataset.name === item.name));
  }
}

function tileFor(item) {
  const li = document.createElement('li');
  const btn = document.createElement('div');
  btn.className = 'tile';
  btn.tabIndex = 0;
  btn.dataset.name = item.name;
  btn.setAttribute('role', 'option');
  btn.setAttribute('aria-selected', 'false');
  btn.title = item.name;

  const icon = document.createElement('div');
  if (item.icon && sprite) {
    // One horizontal strip of variable-width cells; scale each cell to fit the tile.
    const scale = Math.min(32 / item.icon.w, 32 / item.icon.h);
    icon.className = 'tile-icon';
    icon.style.width = `${item.icon.w}px`;
    icon.style.height = `${item.icon.h}px`;
    icon.style.backgroundImage = `url("${sprite}")`;
    icon.style.backgroundPosition = `-${item.icon.x}px -${item.icon.y}px`;
    icon.style.transform = `scale(${scale.toFixed(3)})`;
  } else {
    icon.className = 'tile-icon is-text';
    icon.textContent = item.id == null ? '?' : `#${item.id}`;
  }

  const name = document.createElement('span');
  name.className = 'tile-name';
  name.textContent = item.name;

  btn.append(icon, name);
  btn.addEventListener('click', () => showDetail(item));
  btn.addEventListener('keydown', e => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); showDetail(item); }
  });
  li.append(btn);
  return li;
}

function render(query) {
  // No cap: the grid is meant to show every item at once so they can be found by eye.
  const results = search(query, items, { limit: Number.MAX_SAFE_INTEGER });
  els.count.textContent = items.length === 0
    ? (loadError ? 'Item list unavailable' : 'Loading…')
    : `${results.length} of ${items.length}`;

  els.results.innerHTML = '';
  if (items.length === 0) {
    els.empty.hidden = false;
    els.empty.textContent = loadError
      ? `The item list could not be loaded (${loadError}). The game is unaffected; ` +
        'the container fetches this list in the background.'
      : 'Loading the item list…';
    return;
  }
  els.empty.hidden = results.length > 0;
  if (results.length === 0) els.empty.textContent = 'No items match that search.';

  const frag = document.createDocumentFragment();
  for (const it of results) frag.append(tileFor(it));
  els.results.append(frag);
  if (selected) {
    for (const t of els.results.querySelectorAll('.tile')) {
      t.setAttribute('aria-selected', String(t.dataset.name === selected.name));
    }
  }
}

/** Reveal an item found by Auto-ID. */
export function revealItem(item) {
  if (!els || !item) return;
  setCollapsed(false);
  els.search.value = '';
  render('');
  showDetail(item);
  const tile = [...els.results.querySelectorAll('.tile')]
    .find(t => t.dataset.name === item.name);
  tile?.scrollIntoView({ block: 'center' });
}

export function setCollapsed(collapsed) {
  if (!els) return;
  els.panel.hidden = collapsed;
  document.body.classList.toggle('side-collapsed', collapsed);
  try { localStorage.setItem(COLLAPSED_KEY, collapsed ? '1' : '0'); } catch { /* fine */ }
  if (collapsed) ensureFocus();
}

export function openPanel(prefill = '') {
  if (!els) return;
  setCollapsed(false);
  releaseAll();
  els.search.value = prefill;
  render(prefill);
  els.search.focus();
  els.search.select();
}

export function closePanel() { setCollapsed(true); }
export function togglePanel() { setCollapsed(!els.panel.hidden ? true : false); }

function initResize() {
  const handle = els.resize;
  if (!handle) return;
  const apply = w => {
    const clamped = Math.max(180, Math.min(w, Math.round(window.innerWidth * 0.7)));
    document.documentElement.style.setProperty('--side-w', `${clamped}px`);
    return clamped;
  };
  try {
    const saved = Number(localStorage.getItem(WIDTH_KEY));
    if (Number.isFinite(saved) && saved > 0) apply(saved);
  } catch { /* no stored width */ }

  let dragging = false;
  handle.addEventListener('pointerdown', e => {
    dragging = true;
    handle.classList.add('dragging');
    handle.setPointerCapture?.(e.pointerId);
    e.preventDefault();
  });
  handle.addEventListener('pointermove', e => {
    if (!dragging) return;
    // The sidebar is on the right, so its width grows as the pointer moves left.
    const w = apply(window.innerWidth - e.clientX);
    try { localStorage.setItem(WIDTH_KEY, String(w)); } catch { /* fine */ }
  });
  const stop = () => {
    if (!dragging) return;
    dragging = false;
    handle.classList.remove('dragging');
    ensureFocus();          // give the keyboard back after resizing
  };
  handle.addEventListener('pointerup', stop);
  handle.addEventListener('pointercancel', stop);
}

/**
 * Keep the keyboard away from the game only while the sidebar actually has focus.
 *
 * Installed BEFORE the Ruffle player is created: Ruffle registers key handlers on
 * `window` too, and stopImmediatePropagation only suppresses listeners added after
 * ours on the same target.
 */
export function installKeyIsolation() {
  const guard = e => {
    if (e.type === 'keydown' && e.key === 'k' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      e.stopImmediatePropagation();
      openPanel();
      return;
    }
    if (!hasKeyboard()) return;      // the game owns the keyboard by default
    if (e.type === 'keydown' && e.key === 'Escape') { ensureFocus(); return; }
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
    detail: document.getElementById('item-detail'),
    resize: document.getElementById('side-resize'),
  };
  if (!els.panel) return;

  els.search.addEventListener('input', () => render(els.search.value));
  document.getElementById('btn-items').addEventListener('click', () => togglePanel());
  document.getElementById('btn-items-close').addEventListener('click', () => closePanel());

  // No focus suppression here. Isolation is already scoped to hasKeyboard(), and
  // suppressing ensureFocus() meant that once the search box had focus, nothing
  // could give the keyboard back -- not Escape, not even clicking on the game.
  initResize();
  try { setCollapsed(localStorage.getItem(COLLAPSED_KEY) === '1'); } catch { /* fine */ }

  loadItems().then(() => render(els.search.value));
}
