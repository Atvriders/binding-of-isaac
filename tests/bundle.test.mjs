import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { REPO } from './helpers/serve.mjs';

const read = p => fs.readFileSync(path.join(REPO, p), 'utf8');

test('every local asset referenced by index.html exists', () => {
  const html = read('web/index.html');
  const refs = [...html.matchAll(/(?:src|href)="(\/[^"]+)"/g)].map(m => m[1]);
  assert.ok(refs.length >= 3, 'expected local asset references');
  for (const r of refs) {
    if (r.startsWith('/ruffle/')) continue;   // vendored at build time
    assert.ok(fs.existsSync(path.join(REPO, 'web', r.slice(1))), `missing asset: ${r}`);
  }
});

test('every ES module import resolves to a real file', () => {
  const dir = path.join(REPO, 'web', 'js');
  for (const f of fs.readdirSync(dir)) {
    const src = fs.readFileSync(path.join(dir, f), 'utf8');
    for (const m of src.matchAll(/from\s+'(\.[^']+)'/g)) {
      assert.ok(fs.existsSync(path.join(dir, m[1])), `${f} imports missing ${m[1]}`);
    }
  }
});

test('the entrypoint is valid shell and refuses a bad checksum', () => {
  const p = path.join(REPO, 'scripts', 'docker-entrypoint.sh');
  execFileSync('sh', ['-n', p]);                       // syntax
  const src = fs.readFileSync(p, 'utf8');
  assert.ok(src.includes('sha256sum'), 'must verify a checksum');
  assert.ok(/exit 1/.test(src), 'must fail closed on mismatch');
  assert.ok(src.includes('exec "$@"'), 'must hand off to nginx');
});

test('the entrypoint rejects a corrupt game file instead of serving it', () => {
  const tmp = fs.mkdtempSync('/tmp/isaac-test-');
  fs.writeFileSync(path.join(tmp, 'isaac.swf'), 'not the game');
  let failed = false, out = '';
  try {
    execFileSync('sh', [path.join(REPO, 'scripts', 'docker-entrypoint.sh'), 'true'], {
      env: { ...process.env, GAME_DIR: tmp,
             GAME_SHA256: '3535d67fa608f28ea13697ba711a22922ab107daf5614978da3a07b623a6a761' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (e) { failed = true; out = String(e.stderr); }
  fs.rmSync(tmp, { recursive: true, force: true });
  assert.ok(failed, 'a corrupt game file must stop the container');
  assert.match(out, /checksum mismatch/);
});

test('the entrypoint accepts a good file and starts the server', () => {
  const tmp = fs.mkdtempSync('/tmp/isaac-test-');
  fs.writeFileSync(path.join(tmp, 'isaac.swf'), 'anything');
  const out = execFileSync('sh',
    [path.join(REPO, 'scripts', 'docker-entrypoint.sh'), 'echo', 'STARTED'],
    { env: { ...process.env, GAME_DIR: tmp, GAME_SHA256: 'skip' }, encoding: 'utf8' });
  fs.rmSync(tmp, { recursive: true, force: true });
  assert.match(out, /STARTED/, 'must exec the command it was given');
});

test('nginx serves wasm correctly and allows the CSP Ruffle needs', () => {
  const conf = read('nginx/default.conf');
  assert.ok(/application\/wasm\s+wasm;/.test(conf), 'wasm MIME type required');
  assert.ok(conf.includes("'wasm-unsafe-eval'"), 'Ruffle compiles WebAssembly');
  assert.ok(conf.includes('/srv/game/'), 'game volume must be served');
  assert.ok(conf.includes('/healthz'), 'health endpoint required');
});

test('the published image ships no game data', () => {
  const df = read('Dockerfile');
  assert.ok(!/COPY\s+.*\.swf/i.test(df), 'no SWF may be copied into the image');
  assert.ok(read('.dockerignore').includes('*.swf'), 'SWFs excluded from build context');
  assert.ok(read('.gitignore').includes('*.swf'), 'SWFs excluded from git');
});

test('the markup carries no inline event handlers the CSP would block', () => {
  const html = read('web/index.html');
  const inline = [...html.matchAll(/\son[a-z]+\s*=\s*"/gi)].map(m => m[0].trim());
  assert.deepEqual(inline, [],
    `nginx sets script-src without 'unsafe-inline', so these would silently die: ${inline}`);
});

test('every element the UI wires up actually exists in the markup', () => {
  const html = read('web/index.html');
  const ui = read('web/js/ui.js') + read('web/js/boot.js');
  const ids = [...ui.matchAll(/(?:getElementById\(|\$\()'([a-z0-9-]+)'\)/g)].map(m => m[1]);
  assert.ok(ids.length > 5, 'expected several wired elements');
  for (const id of new Set(ids)) {
    assert.ok(html.includes(`id="${id}"`), `ui references missing element #${id}`);
  }
});

test('the touch layer defines a control for every documented action', () => {
  const html = read('web/index.html');
  const actions = [...html.matchAll(/data-action="([a-zA-Z]+)"/g)].map(m => m[1]);
  const cfg = read('web/js/config.js');
  for (const a of actions) {
    assert.ok(new RegExp(`\\b${a}:`).test(cfg), `touch control "${a}" has no key mapping`);
  }
  for (const need of ['up', 'down', 'left', 'right', 'shootUp', 'shootDown', 'bomb', 'item'])
    assert.ok(actions.includes(need), `touch layer is missing a "${need}" control`);
});

test('no location block silently drops the security headers', () => {
  // nginx inherits add_header only into levels that declare none of their own, so a
  // block adding Cache-Control would otherwise discard the CSP for every page.
  const conf = read('nginx/default.conf');
  const blocks = [...conf.matchAll(/location\s+([^{]+)\{([\s\S]*?)\n    \}/g)];
  assert.ok(blocks.length >= 3, 'expected several location blocks');
  for (const [, name, body] of blocks) {
    if (!/add_header/.test(body)) continue;                  // inherits cleanly
    if (!/text\/html|try_files/.test(body)) continue;         // only page responses matter
    assert.ok(/Content-Security-Policy/.test(body),
      `location ${name.trim()} sets add_header but drops the CSP`);
    assert.ok(/X-Content-Type-Options/.test(body),
      `location ${name.trim()} sets add_header but drops nosniff`);
  }
});

test('the CSP is identical everywhere it is declared', () => {
  const conf = read('nginx/default.conf');
  const policies = [...conf.matchAll(/Content-Security-Policy\s*\n?\s*"([^"]+)"/g)]
    .map(m => m[1].replace(/\s+/g, ' ').trim());
  assert.ok(policies.length >= 2, 'expected the policy in more than one block');
  assert.equal(new Set(policies).size, 1, 'the policy must not drift between blocks');
});
