import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

// Resolve a Chromium without downloading one: explicit env, then Playwright's
// cache, then a system browser. Keeps CI and this sandbox on the same code path.
export function chromePath() {
  if (process.env.ISAAC_CHROME && fs.existsSync(process.env.ISAAC_CHROME))
    return process.env.ISAAC_CHROME;

  const cache = path.join(os.homedir(), '.cache', 'ms-playwright');
  if (fs.existsSync(cache)) {
    const dirs = fs.readdirSync(cache)
      .filter(d => d.startsWith('chromium-'))
      .sort((a, b) => Number(b.split('-')[1]) - Number(a.split('-')[1]));
    for (const d of dirs) {
      for (const rel of ['chrome-linux64/chrome', 'chrome-linux/chrome']) {
        const p = path.join(cache, d, rel);
        if (fs.existsSync(p)) return p;
      }
    }
  }
  for (const p of ['/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'])
    if (fs.existsSync(p)) return p;

  throw new Error('No Chromium found. Set ISAAC_CHROME to a browser binary.');
}

export const LAUNCH_ARGS = [
  '--no-sandbox',
  '--use-gl=swiftshader',
  '--enable-unsafe-swiftshader',
  '--autoplay-policy=no-user-gesture-required',
  '--mute-audio',
];
