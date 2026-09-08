#!/usr/bin/env node
// Fetches the item list into the volume. The image ships no item data: the
// descriptions belong to the source site, so they are pulled at runtime and every
// entry links back. Never fatal -- the game must stay playable without this.
import fs from 'node:fs';
import path from 'node:path';
import { parseItems, SOURCE_URL } from './parse-items.mjs';

const OUT = process.env.ITEMS_FILE || '/srv/data/items.json';
const URL_ = process.env.ITEMS_URL || SOURCE_URL;
const MAX_AGE_DAYS = Number(process.env.ITEMS_MAX_AGE_DAYS || 7);

const log = (...a) => console.error('[items]', ...a);

function fresh(file) {
  try {
    const st = fs.statSync(file);
    if (st.size < 100) return false;
    const ageDays = (Date.now() - st.mtimeMs) / 86400000;
    if (ageDays > MAX_AGE_DAYS) return false;
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
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

  const items = parseItems(html);
  if (items.length === 0) {
    log('parsed nothing; the page layout has probably changed. keeping any existing list.');
    return fs.existsSync(OUT) ? 0 : 1;
  }

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  const tmp = `${OUT}.part`;
  fs.writeFileSync(tmp, JSON.stringify(
    { source: URL_, fetchedAt: new Date().toISOString(), count: items.length, items }));
  fs.renameSync(tmp, OUT);
  log(`wrote ${items.length} items to ${OUT}`);
  return 0;
}

main().then(c => process.exit(c)).catch(e => { log('unexpected:', e); process.exit(1); });
