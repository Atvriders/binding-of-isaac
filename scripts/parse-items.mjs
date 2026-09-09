// Pure parser for the item list page. Kept free of I/O so it can be unit-tested
// against a synthetic fixture with no network and no third-party content in the repo.

const SOURCE = 'https://www.tboi.com/original';

function decode(s) {
  return s
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(+d))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

/** Extract items from the page HTML. Returns [] rather than throwing on junk input. */
export function parseItems(html) {
  if (typeof html !== 'string' || html.length === 0) return [];
  const blocks = html.matchAll(
    /<li class="textbox"[^>]*data-tid="([^"]*)"[^>]*data-sid="([^"]*)"[^>]*>([\s\S]*?)<\/li>/g);

  const out = [];
  const seen = new Set();
  for (const [, tid, sid, body] of blocks) {
    const titleRaw = /<p class="item-title">([\s\S]*?)<\/p>/.exec(body);
    if (!titleRaw) continue;

    const name = decode(titleRaw[1]).replace(/:\s*$/, '');
    if (!name || seen.has(name.toLowerCase())) continue;
    seen.add(name.toLowerCase());

    // Icons live in three horizontal strips, one per family: passive items (itmN),
    // trinkets (junxxN) and cards (cardN, plus a few named suits). Only handling
    // itmN left 61 entries -- every trinket and card -- with no icon at all.
    let sprite = null;
    for (const [family, re] of [
      ['item', /class=['"][^'"]*\bitm(\d+)\b[^'"]*['"]/],
      ['trinket', /class=['"][^'"]*\bjunxx(\d+)\b[^'"]*['"]/],
      ['card', /class=['"][^'"]*\bcard([a-z0-9]+)\b[^'"]*['"]/],
    ]) {
      const m = re.exec(body);
      if (m) { sprite = { family, key: m[1] }; break; }
    }

    const idRaw = /<p class="itemid">([\s\S]*?)<\/p>/.exec(body);
    const idNum = idRaw ? /(\d+)/.exec(decode(idRaw[1])) : null;

    // Everything that is not the title or the id line is the description.
    const description = decode(
      body.replace(/<p class="item-title">[\s\S]*?<\/p>/, '')
          .replace(/<p class="itemid">[\s\S]*?<\/p>/, ''));

    out.push({
      id: idNum ? Number(idNum[1]) : null,
      tid,
      sid,
      name,
      description,
      sprite,
      url: `${SOURCE}#${tid}`,
    });
  }
  return out;
}

export const SOURCE_URL = SOURCE;

/**
 * Sprite geometry from the stylesheet, for all three icon families.
 *
 * Each family is one row of cells addressed by a class, with the sheet URL and row
 * height on a family rule. Cards carry their width on the family rule rather than
 * per cell, so a per-cell width is optional.
 *
 * Returns { families: { item|trinket|card: { image, height, width, cells } } }.
 */
const FAMILIES = [
  { key: 'item', cellRe: /\.itm(\d+)\s*\{([^}]*)\}/g, baseRe: /\.vitem\s*\{([^}]*)\}/ },
  { key: 'trinket', cellRe: /\.junxx(\d+)\s*\{([^}]*)\}/g,
    baseRe: /\.vanillatrinket\s*\{([^}]*)\}/ },
  { key: 'card', cellRe: /\.card([a-z0-9]+)\s*\{([^}]*)\}/g,
    baseRe: /\.vanillacard\s*\{([^}]*)\}/ },
];

export function parseSpriteRules(css) {
  const out = { families: {} };
  if (typeof css !== 'string' || !css) return out;

  const px = (body, prop) => {
    const m = new RegExp(prop + '\\s*:\\s*(\\d+)px').exec(body);
    return m ? Number(m[1]) : null;
  };

  for (const fam of FAMILIES) {
    const base = fam.baseRe.exec(css);
    if (!base) continue;
    const baseBody = base[1];
    const img = /url\(\s*['"]?([^'")]+)['"]?\s*\)/.exec(baseBody);

    const cells = {};
    for (const m of css.matchAll(fam.cellRe)) {
      const body = m[2];
      const pos = /background-position\s*:\s*(-?\d+)(?:px)?\s+(-?\d+)(?:px)?/.exec(body);
      if (!pos) continue;
      cells[m[1]] = {
        x: Math.abs(Number(pos[1])),
        y: Math.abs(Number(pos[2])),
        w: px(body, 'width'),      // may be null; the family width then applies
      };
    }
    out.families[fam.key] = {
      image: img ? img[1] : null,
      height: px(baseBody, 'height') ?? 50,
      width: px(baseBody, 'width'),
      cells,
    };
  }
  return out;
}
