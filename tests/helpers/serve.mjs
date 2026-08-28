import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const REPO = path.resolve(HERE, '..', '..');

/** Pull the real policy out of nginx.conf so tests run under what the container
 *  actually sends. Without this, a CSP violation would only ever show up in Docker. */
export function nginxCsp() {
  const conf = fs.readFileSync(path.join(REPO, 'nginx', 'default.conf'), 'utf8');
  const m = conf.match(/add_header\s+Content-Security-Policy\s*\n?\s*"([^"]+)"/);
  return m ? m[1].trim() : null;
}

const TYPES = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.wasm': 'application/wasm', '.json': 'application/json',
  '.swf': 'application/x-shockwave-flash', '.map': 'application/json',
};

// Serves exactly what nginx serves: web/ at the root, ruffle/ and game/ mapped
// the same way the container maps them.
export function startServer({ webRoot, ruffleDir, gameDir, port = 0, csp = null }) {
  const server = http.createServer((req, res) => {
    const url = decodeURIComponent(req.url.split('?')[0]);
    let file;
    if (url === '/healthz') { res.writeHead(200); return res.end('ok\n'); }
    if (url.startsWith('/ruffle/')) file = path.join(ruffleDir, url.slice('/ruffle/'.length));
    else if (url.startsWith('/game/')) file = path.join(gameDir, url.slice('/game/'.length));
    else file = path.join(webRoot, url === '/' ? 'index.html' : url.replace(/^\//, ''));

    if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.writeHead(404); return res.end('not found');
    }
    const type = TYPES[path.extname(file)] || 'application/octet-stream';
    const stat = fs.statSync(file);
    const headers = { 'content-type': type, 'content-length': stat.size,
                      'accept-ranges': 'bytes' };
    if (csp) headers['content-security-policy'] = csp;
    res.writeHead(200, headers);
    fs.createReadStream(file).pipe(res);
  });
  return new Promise(resolve => {
    server.listen(port, '127.0.0.1', () =>
      resolve({ server, url: `http://127.0.0.1:${server.address().port}`,
                close: () => new Promise(r => server.close(r)) }));
  });
}
