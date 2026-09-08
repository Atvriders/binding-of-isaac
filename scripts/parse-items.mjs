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

    // The icon is a cell in a horizontal sprite strip, addressed by an itmN class.
    const spriteRaw = /class=['"][^'"]*\bitm(\d+)\b[^'"]*['"]/.exec(body);

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
      sprite: spriteRaw ? Number(spriteRaw[1]) : null,
      url: `${SOURCE}#${tid}`,
    });
  }
  return out;
}

export const SOURCE_URL = SOURCE;

/**
 * Sprite geometry from the stylesheet.
 *
 * The strip is one row of variable-width cells: `.itmN{background-position:-X 0;
 * width:Wpx}`, with the row height on `.item`. Returns { cells: {N: {x, w}}, height }.
 */
export function parseSpriteRules(css) {
  if (typeof css !== 'string' || !css) return { cells: {}, height: 50, image: null };

  const cells = {};
  for (const m of css.matchAll(/\.itm(\d+)\s*\{([^}]*)\}/g)) {
    const body = m[2];
    const pos = /background-position\s*:\s*(-?\d+)px\s+(-?\d+)px?/.exec(body)
             || /background-position\s*:\s*(-?\d+)(?:px)?\s+(-?\d+)(?:px)?/.exec(body);
    const w = /width\s*:\s*(\d+)px/.exec(body);
    if (!pos || !w) continue;
    cells[m[1]] = { x: Math.abs(Number(pos[1])), y: Math.abs(Number(pos[2])), w: Number(w[1]) };
  }

  const h = /\.item\s*\{[^}]*height\s*:\s*(\d+)px/.exec(css);
  const img = /\.vitem\s*\{[^}]*url\(\s*['"]?([^'")]+)['"]?\s*\)/.exec(css);
  return { cells, height: h ? Number(h[1]) : 50, image: img ? img[1] : null };
}
