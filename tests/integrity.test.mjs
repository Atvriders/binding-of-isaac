import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { REPO } from './helpers/serve.mjs';

const SWF = path.join(REPO, 'game', 'isaac.swf');
const EXPECTED_SHA = '3535d67fa608f28ea13697ba711a22922ab107daf5614978da3a07b623a6a761';
const EXPECTED_SIZE = 36209977;
const skip = fs.existsSync(SWF) ? false : 'run scripts/fetch-assets.sh first';

test('the game file matches the pinned size and checksum', { skip }, () => {
  const buf = fs.readFileSync(SWF);
  assert.equal(buf.length, EXPECTED_SIZE);
  assert.equal(crypto.createHash('sha256').update(buf).digest('hex'), EXPECTED_SHA);
});

test('the SWF header describes the full 800x600 AS2 build', { skip }, () => {
  const buf = fs.readFileSync(SWF);
  assert.equal(buf.subarray(0, 3).toString('latin1'), 'FWS', 'uncompressed SWF');
  assert.equal(buf[3], 8, 'SWF version 8 implies ActionScript 2');

  // Stage RECT is a bit-packed signed rectangle in twips (1/20 px).
  const nbits = buf[8] >> 3;
  const nbytes = Math.ceil((5 + 4 * nbits) / 8);
  let bits = '';
  for (let i = 8; i < 8 + nbytes; i++) bits += buf[i].toString(2).padStart(8, '0');
  const readSigned = (start) => {
    const s = bits.slice(start, start + nbits);
    const v = parseInt(s, 2);
    return s[0] === '1' ? v - (1 << s.length) : v;
  };
  const xMax = readSigned(5 + nbits);
  const yMax = readSigned(5 + 3 * nbits);
  assert.equal(xMax / 20, 800, 'stage width');
  assert.equal(yMax / 20, 600, 'stage height');
  assert.equal(buf.readUInt16LE(8 + nbytes) / 256, 30, 'frame rate');
});

test('the checksum pinned in the container matches the one under test', () => {
  const dockerfile = fs.readFileSync(path.join(REPO, 'Dockerfile'), 'utf8');
  const compose = fs.readFileSync(path.join(REPO, 'docker-compose.yml'), 'utf8');
  assert.ok(dockerfile.includes(EXPECTED_SHA), 'Dockerfile must pin the same checksum');
  assert.ok(compose.includes(EXPECTED_SHA), 'compose must pin the same checksum');
});
