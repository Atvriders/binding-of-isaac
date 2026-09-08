import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseItems } from '../scripts/parse-items.mjs';
import { bestMatch, search, similarity, normalise, normalisePlain } from '../web/js/match.js';

// A synthetic page in the same shape as the real one. Invented names and text: the
// real descriptions belong to the source site and are fetched at runtime, never
// committed here.
const FIXTURE = `
<div class="items-container">
  <li class="textbox" data-tid="10" data-sid="1" >
    <div class='item vitem itm10'></div>
    <p class="item-title">Rusty Spoon:</p>
    <p class="itemid">(ItemID: 1)</p>
    Bends when you look at it. Tears gain a mild wobble.
  </li>
  <li class="textbox" data-tid="11" data-sid="2" >
    <p class="item-title">Paper Crown:</p>
    <p class="itemid">(ItemID: 2)</p>
    Grants an extra heart &amp; a sense of unearned authority.
  </li>
  <li class="textbox" data-tid="12.3" data-sid="3" >
    <p class="item-title">Mother&#39;s Thimble:</p>
    <p class="itemid">(ItemID: 42)</p>
    Small, sharp, faintly disapproving.
  </li>
</div>`;

test('the parser extracts id, name, description and a source link', () => {
  const items = parseItems(FIXTURE);
  assert.equal(items.length, 3);
  assert.deepEqual(items.map(i => i.name), ['Rusty Spoon', 'Paper Crown', "Mother's Thimble"]);
  assert.deepEqual(items.map(i => i.id), [1, 2, 42]);
  assert.equal(items[0].tid, '10');
  assert.match(items[2].url, /tboi\.com\/original#12\.3$/);
});

test('the parser strips markup and decodes entities', () => {
  const items = parseItems(FIXTURE);
  assert.match(items[1].description, /extra heart & a sense/);
  assert.equal(items[2].name, "Mother's Thimble", 'numeric entity should decode');
  assert.ok(!items[0].description.includes('<'), 'no markup should survive');
});

test('the parser survives junk instead of throwing', () => {
  for (const junk of ['', null, undefined, '<html>nothing here</html>', '{"json":true}']) {
    assert.deepEqual(parseItems(junk), [], `should return [] for ${JSON.stringify(junk)}`);
  }
});

test('the parser drops duplicate names rather than listing them twice', () => {
  const doubled = FIXTURE + FIXTURE;
  assert.equal(parseItems(doubled).length, 3);
});

const ITEMS = parseItems(FIXTURE);

test('OCR-garbled text still resolves to the right item', () => {
  // A closed vocabulary is what makes reading a pixel font viable: the read only has
  // to come close, because a garbled string still resolves to exactly one candidate.
  for (const [read, expected] of [
    ['Rusty Spoon', 'Rusty Spoon'],
    ['RU5TY 5P00N', 'Rusty Spoon'],
    ['usty Spoo', 'Rusty Spoon'],
    ['Paper Crovvn', 'Paper Crown'],
    ["M0ther's Thimb1e", "Mother's Thimble"],
  ]) {
    const hit = bestMatch(read, ITEMS);
    assert.ok(hit, `"${read}" matched nothing`);
    assert.equal(hit.item.name, expected, `"${read}" resolved wrongly`);
  }
});

test('nonsense matches nothing rather than the nearest item', () => {
  // Reporting a wrong item confidently is worse than reporting none.
  for (const junk of ['zzzz qqqq', 'xkcd', '....', 'a', '']) {
    assert.equal(bestMatch(junk, ITEMS), null, `"${junk}" should not match`);
  }
});

test('an empty item list never produces a match', () => {
  assert.equal(bestMatch('Rusty Spoon', []), null);
  assert.equal(bestMatch('Rusty Spoon', null), null);
});

test('search ranks exact and prefix hits above fuzzy ones', () => {
  assert.equal(search('rusty', ITEMS)[0].name, 'Rusty Spoon');
  assert.equal(search('crown', ITEMS)[0].name, 'Paper Crown');
  assert.deepEqual(search('zzz', ITEMS), []);
});

test('a numeric query is an id lookup, not a fuzzy name search', () => {
  // Regression: OCR folding mapped "3" to "e", so a numeric search matched half
  // the list. Search must not apply that folding.
  const r = search('42', ITEMS);
  assert.equal(r.length, 1);
  assert.equal(r[0].name, "Mother's Thimble");
  assert.deepEqual(search('999', ITEMS), [], 'an unknown id matches nothing');
});

test('normalisation folds OCR confusions only where it should', () => {
  assert.equal(normalise('0NE 1S 5AD'), 'one ls sad');
  assert.equal(normalisePlain('0NE 1S 5AD'), '0ne 1s 5ad', 'plain form keeps digits');
  assert.ok(similarity('The Sad Onion', 'THE SAD ONION') === 1);
  assert.ok(similarity('abc', 'xyz') < 0.4);
});

test('an empty search returns the whole list', () => {
  assert.equal(search('', ITEMS).length, 3);
});
