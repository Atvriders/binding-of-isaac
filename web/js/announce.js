// Deciding when a detected item is worth announcing.
//
// Kept pure and separate so it can be tested without a browser: the detector it
// serves needs a video stream, a canvas and an OCR worker.
//
// Announcing is edge-triggered rather than rate-limited. A trinket's banner stays
// on screen for as long as you hold it, so the same name is read on every pass; a
// timeout only delays the repeat rather than preventing it.

export const BANNER_CLEAR_MS = 4000;

/**
 * @param {{name: string|null, at: number}} current  what was last announced
 * @param {string|null} detected  item name read this pass, or null for nothing
 * @returns {{announce: boolean, state: {name: string|null, at: number}}}
 */
export function nextAnnounceState(current, detected, now, clearMs = BANNER_CLEAR_MS) {
  if (!detected) {
    // Banner clear for a while: forget it, so the same item announces again if
    // picked up later in the run.
    if (current.name && now - current.at > clearMs) {
      return { announce: false, state: { name: null, at: 0 } };
    }
    return { announce: false, state: current };
  }
  // Same item still on screen: keep it current, stay quiet.
  if (detected === current.name) {
    return { announce: false, state: { name: current.name, at: now } };
  }
  return { announce: true, state: { name: detected, at: now } };
}
