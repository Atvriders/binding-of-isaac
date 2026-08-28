// Driving the real game to a testable state.
//
// Two facts learned by probing, both of which invalidate simpler approaches:
//   * The main menu and character select are MOUSE driven. Testing keyboard against
//     them reads as "no response" no matter how well the keyboard works.
//   * The animated intro runs for ~3 minutes, but clicking through it cuts that to
//     about 90 seconds.
// Keyboard only means anything once a run has actually started.
import { saturate } from './game.mjs';

/** Map 800x600 stage coordinates to viewport coordinates and click there. */
export async function clickStage(page, gx, gy) {
  const box = await page.evaluate(() => {
    const r = document.getElementById('stage').getBoundingClientRect();
    return { x: r.left, y: r.top, w: r.width, h: r.height };
  });
  await page.mouse.click(box.x + (gx / 800) * box.w, box.y + (gy / 600) * box.h);
}

/** Click through the intro, then wait for the menu to settle. */
export async function reachMenu(page, { clicks = 10, gap = 2000 } = {}) {
  for (let i = 0; i < clicks; i++) {
    await clickStage(page, 400, 300);
    await page.waitForTimeout(gap);
  }
  return saturate(page, { stableMs: 15000, maxMs: 420000 });
}

/** From the settled menu: Start -> character select -> SELECT -> a live run. */
export async function enterRun(page) {
  await clickStage(page, 400, 470);          // "Start"
  await page.waitForTimeout(4000);
  await clickStage(page, 624, 478);          // "SELECT" on character select
  await page.waitForTimeout(9000);
  return saturate(page, { stableMs: 8000, maxMs: 90000 });
}
