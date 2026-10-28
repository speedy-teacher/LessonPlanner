// First-slide pictures of lesson decks in Google Drive. Google makes these
// for free: the planner asks Drive for the picture's short-lived address and
// shows it as an image. Nothing is saved — addresses are kept in memory for
// this visit only (Google lets them expire after a few hours). Other decks
// show "Preview not available".
//
// Pictures are only asked for when a card comes into view (`requestThumbnail`),
// a few at a time, and each arriving picture updates just its own cards
// (`onThumbnail`) — never the whole page, which froze long lesson lists.

import { driveFileId } from './locations.js';
import { fetchThumbnailLink, sizedThumbnail } from './drive.js';
import { google } from './google.js';

const SIZE = 640;
const LIFETIME_MS = 60 * 60 * 1000;
const MAX_AT_ONCE = 4;

/** fileId -> { status: 'loading' | 'ready' | 'none', url?, reason?, at?, retried? } */
const cache = new Map();
const queue = [];
const listeners = new Set();
let running = 0;

const WAITING = { status: 'waiting' };
const NOT_IN_DRIVE = { status: 'none', reason: 'Previews are only shown for decks in Google Drive.' };
const NOT_CONNECTED = { status: 'none', reason: 'Connect Google Drive to see the preview.' };
const NO_PICTURE = { status: 'none', reason: 'Google Drive has no picture of this deck yet.' };

function isFresh(entry) {
  return entry.status !== 'ready' || Date.now() - entry.at < LIFETIME_MS;
}

/**
 * The first-slide picture of a deck, as known now: { status: 'ready', url } | { status: 'loading' } |
 * { status: 'waiting' } (not asked for yet — see requestThumbnail) | { status: 'none', reason }.
 */
export function deckThumbnail(lesson) {
  const fileId = driveFileId(lesson);
  if (!fileId) return NOT_IN_DRIVE;
  if (google.status !== 'connected') return NOT_CONNECTED;
  const entry = cache.get(fileId);
  return entry && isFresh(entry) ? entry : WAITING;
}

/** Ask Drive for a deck's picture (when its card comes into view). `onThumbnail` hears when it's here. */
export function requestThumbnail(lesson) {
  if (deckThumbnail(lesson) !== WAITING) return;
  const fileId = driveFileId(lesson);
  cache.set(fileId, { status: 'loading', retried: cache.get(fileId)?.retried ?? false });
  queue.push(fileId);
  pump();
}

/** `fn(fileId)` is called whenever a deck's picture arrives or changes. */
export function onThumbnail(fn) {
  listeners.add(fn);
}

function changed(fileId) {
  listeners.forEach((fn) => fn(fileId));
}

/** A picture didn't load (its address probably expired): ask Drive again once, then give up. */
export function thumbnailFailed(lesson) {
  const fileId = driveFileId(lesson);
  const entry = cache.get(fileId);
  if (!entry || entry.status !== 'ready') return;
  if (entry.retried) cache.set(fileId, NO_PICTURE);
  else cache.set(fileId, { ...entry, at: 0, retried: true });
  changed(fileId);
}

function pump() {
  while (running < MAX_AT_ONCE && queue.length) {
    running++;
    load(queue.shift()).finally(() => { running--; pump(); });
  }
}

async function load(fileId) {
  const retried = cache.get(fileId)?.retried ?? false;
  try {
    const link = await fetchThumbnailLink(google.token, fileId);
    cache.set(fileId, link ? { status: 'ready', url: sizedThumbnail(link, SIZE), at: Date.now(), retried } : NO_PICTURE);
  } catch {
    cache.set(fileId, { status: 'none', reason: 'Couldn’t reach Google Drive for the preview.' });
  }
  changed(fileId);
}
