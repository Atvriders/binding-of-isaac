# Item browser and pickup detection

**Date:** 2026-09-08
**Status:** approved, implementing

## Goal

A fast searchable browser for every item in the game, and — while playing —
automatic identification of the item just picked up.

## Data source

`https://www.tboi.com/original` renders 256 item nodes server-side. Each carries a
`data-tid`, a title, an `(ItemID: n)` and a description. Verified against a saved
copy: 256 blocks, 256 titles, 256 unique names, descriptions 65–989 characters.

### The image ships no item data

The descriptions are that site's own writing. Baking a scrape into a public
repository and a public image would republish someone else's work under this
project's name. Instead the data is fetched into the volume at runtime, exactly as
the game file already is, and every entry links back to its source page.

| Concern | Decision |
| --- | --- |
| Where the data lives | `/srv/data/items.json` in the `isaac-game` volume |
| When it is fetched | On container start when missing or older than `ITEMS_MAX_AGE_DAYS` (7) |
| Staying fresh | A background loop re-checks daily |
| Fetch failure | Never blocks the game; the panel reports the list is unavailable |

## Components

### `scripts/fetch-items.js`

Parses the page into `{id, tid, name, description, url}[]` and writes `items.json`
with a `fetchedAt` stamp. Pure function over HTML text, so it is unit-testable
against a saved fixture with no network.

### Item panel (`web/js/items.js`)

Toolbar button and `Ctrl+K`. Substring match on name and id first, then a fuzzy pass
so approximate spellings still land. Results link to the source page.

**Keyboard isolation.** Ruffle registers its key handlers on `window`, so typing in
the search box would otherwise also drive the character. While the panel is open a
capture-phase listener on `window` stops propagation, and any held keys are released
on open. A capture listener on `window` runs before anything Ruffle registers there,
so the game genuinely receives nothing. Focus returns to the player on close.

### Pickup detection (`web/js/pickup.js`)

Off by default; it costs CPU while playing. When enabled:

1. `canvas.captureStream(5)` into a hidden `<video>`. This is the only way to read
   the game's pixels: `drawImage` on Ruffle's WebGL canvas returns blank without
   `preserveDrawingBuffer`. Measured: `drawImage` yields 1 distinct colour,
   `captureStream` yields 749 from the same frame.
2. Crop the pickup banner region and compute cheap variance. Only a frame that
   changed enough proceeds — this gates the expensive step.
3. OCR the name with tesseract.js, vendored at build time like Ruffle.
4. Fuzzy-match against the 256 known names. A closed vocabulary is what makes this
   viable: OCR need only come close, since a garbled read still resolves to exactly
   one item. Below a confidence threshold, report nothing rather than guess.

## Testing

| Test | Assertion |
| --- | --- |
| Parser | 256 items, unique names, ids parse, from a fixture, offline |
| Matching | Exact, substring, and deliberately corrupted names resolve correctly |
| Confidence | Nonsense input matches nothing rather than the nearest item |
| Panel | Opens, filters, links out, and closes |
| Key isolation | Typing in the search box does not reach the game |
| Coverage | The panel never covers the stage while closed; focus returns on close |
| Capture | `captureStream` yields a readable frame from the live canvas |
| Degradation | Missing `items.json` shows a message and leaves the game playable |

**Owner-verified, not machine-verified:** the true hit-rate of pickup detection needs
a real collectible taken in a real run, which cannot be automated reliably here. The
pipeline is tested end to end against rendered names; live accuracy is a judgement
call for the operator.

## Out of scope

Trinkets, pills and cards as separate browsable categories; item synergies; run
tracking.
