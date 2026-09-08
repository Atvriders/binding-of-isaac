#!/usr/bin/env node
// Fetches the item list into the volume. The image ships no item data: the
// descriptions belong to the source site, so they are pulled at runtime and every
// entry links back. Never fatal -- the game must stay playable without this.
import fs from 'node:fs';
import path from 'node:path';
import { parseItems, parseSpriteRules, SOURCE_URL } from './parse-items.mjs';

const OUT = process.env.ITEMS_FILE || '/srv/data/items.json';
const SPRITE_OUT = OUT.replace(/items\.json$/, 'item-sprite.png');
const CSS_URL = process.env.ITEMS_CSS_URL || 'https://www.tboi.com/assets/main.css';
const URL_ = process.env.ITEMS_URL || SOURCE_URL;
const MAX_AGE_DAYS = Number(process.env.ITEMS_MAX_AGE_DAYS || 7);
// Bump when the shape of items.json changes. Cached data from an older image is
// otherwise kept until it ages out, so an upgrade would not deliver new fields --
// which is exactly how icons went missing after the sprite support landed.
const SCHEMA = 2;

const log = (...a) => console.error('[items]', ...a);

function fresh(file) {
  try {
    const st = fs.statSync(file);
    if (st.size < 100) return false;
    const ageDays = (Date.now() - st.mtimeMs) / 86400000;
    if (ageDays > MAX_AGE_DAYS) return false;
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (data.schema !== SCHEMA) {
      log(`cached list is schema ${data.schema ?? 1}, need ${SCHEMA}; refetching`);
      return false;
    }
    return Array.isArray(data.items) && data.items.length > 0;
  } catch { return false; }
}

async function main() {
  const force = process.argv.includes('--force');
  if (!force && fresh(OUT)) { log('cached list is current'); return 0; }

  log(`fetching ${URL_}`);
  let html;
  try {
    const res = await fetch(URL_, {
      headers: { 'user-agent': 'isaac-cabinet/1.0 (self-hosted item browser)' },
      signal: AbortSignal.timeout(45000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    html = await res.text();
  } catch (e) {
    log('fetch failed:', String(e));
    return fs.existsSync(OUT) ? 0 : 1;   // keep whatever we already had
  }

  // Icon geometry and the sprite itself. Best-effort: without them the browser
  // falls back to text tiles, which is a degraded list rather than a broken one.
  let sprite = { cells: {}, height: 50, image: null };
  try {
    const cssRes = await fetch(CSS_URL, { signal: AbortSignal.timeout(30000) });
    if (cssRes.ok) sprite = parseSpriteRules(await cssRes.text());
  } catch (e) { log('icon stylesheet unavailable:', String(e)); }

  if (sprite.image) {
    try {
      const imgUrl = new URL(sprite.image.replace(/^\.\./, ''), new URL(CSS_URL).origin).href;
      const imgRes = await fetch(imgUrl, { signal: AbortSignal.timeout(60000) });
      if (imgRes.ok) {
        fs.mkdirSync(path.dirname(SPRITE_OUT), { recursive: true });
        fs.writeFileSync(SPRITE_OUT, Buffer.from(await imgRes.arrayBuffer()));
        log(`wrote sprite sheet to ${SPRITE_OUT}`);
      }
    } catch (e) { log('sprite sheet unavailable:', String(e)); }
  }

  const items = parseItems(html);
  if (items.length === 0) {
    log('parsed nothing; the page layout has probably changed. keeping any existing list.');
    return fs.existsSync(OUT) ? 0 : 1;
  }

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  const tmp = `${OUT}.part`;
  // Attach each item's cell so the page can position the sprite without the CSS.
  let withIcons = 0;
  for (const it of items) {
    const cell = it.sprite != null ? sprite.cells[it.sprite] : null;
    if (cell) { it.icon = { x: cell.x, y: cell.y, w: cell.w, h: sprite.height }; withIcons++; }
    else it.icon = null;
  }

  fs.writeFileSync(tmp, JSON.stringify(
    { schema: SCHEMA, source: URL_, fetchedAt: new Date().toISOString(), count: items.length,
      spriteUrl: fs.existsSync(SPRITE_OUT) ? '/data/item-sprite.png' : null,
      withIcons, items }));
  fs.renameSync(tmp, OUT);
  log(`wrote ${items.length} items (${withIcons} with icons) to ${OUT}`);
  return 0;
}

main().then(c => process.exit(c)).catch(e => { log('unexpected:', e); process.exit(1); });
