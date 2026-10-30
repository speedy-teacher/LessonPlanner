// Which pictures are shared with "anyone with the link" in Google Drive. Google can only put a picture
// into a slide, doc or sheet when it's shared that way, so unshared pictures get a warning (and the
// picture picker prefers shared ones). Checked while the planner runs and kept in memory only — sharing
// is changed in Drive, so a saved answer would go stale.

import { fetchLinkSharing } from './drive.js';
import { google } from './google.js';
import { driveFileId } from './locations.js';
import { refreshSoon, store } from './store.js';

const FRESH_MS = 10 * 60 * 1000;
const MAX_AT_ONCE = 4;

const known = new Map(); // fileId → { shared: true | false | null, at }
const refused = new Set(); // pictures Google wouldn't let the planner share for a moment (this visit)
const queue = [];
let running = 0;
let redraw = null;

/** true (anyone with the link can view), false (not shared that way), or null (not known yet / not in Drive). */
export function isShared(image) {
  const fileId = driveFileId(image);
  return fileId ? known.get(fileId)?.shared ?? null : null;
}

/** Google refused to let the planner share this picture for a moment (so it couldn't be placed). */
export function markShareRefused(fileId) {
  if (refused.has(fileId)) return;
  refused.add(fileId);
  redrawSoon();
}

/** The planner was given permission for these pictures (picked in Google's picker): try placing them again. */
export function clearRefused(fileIds) {
  fileIds.forEach((id) => refused.delete(id));
  redrawSoon();
  tellPlaceable(fileIds);
}

const placeableListeners = [];

/** `fn(fileIds)` hears about pictures that can be placed now (found shared, or picked again). */
export function onSharingNews(fn) {
  placeableListeners.push(fn);
}

function tellPlaceable(fileIds) {
  placeableListeners.forEach((fn) => fn(fileIds));
}

/** Whether placing this picture failed because it couldn't be shared for a moment. */
export function shareRefused(image) {
  return refused.has(driveFileId(image));
}

/** Look up the sharing of these pictures (those not checked in the last few minutes, unless `again`). */
export function checkSharing(images, { again = false } = {}) {
  if (google.status !== 'connected') return;
  for (const image of images) {
    const fileId = driveFileId(image);
    const entry = known.get(fileId);
    if (!fileId || queue.includes(fileId) || (!again && entry && Date.now() - entry.at < FRESH_MS)) continue;
    queue.push(fileId);
  }
  pump();
}

function pump() {
  while (running < MAX_AT_ONCE && queue.length) {
    running += 1;
    load(queue.shift()).finally(() => { running -= 1; pump(); });
  }
}

async function load(fileId) {
  const before = known.get(fileId)?.shared;
  try {
    known.set(fileId, { shared: await fetchLinkSharing(google.token, fileId), at: Date.now() });
    if (known.get(fileId).shared) refused.delete(fileId); // shared by hand since: placing will work
    if (known.get(fileId).shared && before !== true) tellPlaceable([fileId]);
  } catch {
    known.set(fileId, { shared: null, at: Date.now() });
  }
  if (known.get(fileId).shared !== before) redrawSoon();
}

/** Show new answers on the pages that use them, a moment later (many arrive together). */
function redrawSoon() {
  clearTimeout(redraw);
  redraw = setTimeout(() => { if (['images', 'lessons'].includes(store.ui.tab)) refreshSoon(); }, 300);
}
