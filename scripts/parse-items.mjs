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
      url: `${SOURCE}#${tid}`,
    });
  }
  return out;
}

export const SOURCE_URL = SOURCE;
