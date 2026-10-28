// First-slide pictures of lesson decks in Google Drive. Google makes these
// for free: the planner asks Drive for the picture's short-lived address and
// shows it as an image. Nothing is saved — addresses are kept in memory for
// this visit only (Google lets them expire after a few hours). Other decks
// show "Preview not available".

import { driveFileId } from './locations.js';
import { fetchThumbnailLink, sizedThumbnail } from './drive.js';
import { google } from './google.js';
import { refresh } from './store.js';

const SIZE = 640;
const LIFETIME_MS = 60 * 60 * 1000;
const MAX_AT_ONCE = 4;

/** fileId -> { status: 'loading' | 'ready' | 'none', url?, reason?, at?, retried? } */
const cache = new Map();
const queue = [];
let running = 0;

const NOT_IN_DRIVE = { status: 'none', reason: 'Previews are only shown for decks in Google Drive.' };
const NOT_CONNECTED = { status: 'none', reason: 'Connect Google Drive to see the preview.' };
const NO_PICTURE = { status: 'none', reason: 'Google Drive has no picture of this deck yet.' };

function isFresh(entry) {
  return entry.status !== 'ready' || Date.now() - entry.at < LIFETIME_MS;
}

/**
 * The first-slide picture of a deck: { status: 'ready', url } | { status: 'loading' } |
 * { status: 'none', reason }. Starts loading it if needed; the page redraws when it arrives.
 */
export function deckThumbnail(lesson) {
  const fileId = driveFileId(lesson);
  if (!fileId) return NOT_IN_DRIVE;
  if (google.status !== 'connected') return NOT_CONNECTED;
  const entry = cache.get(fileId);
  if (entry && isFresh(entry)) return entry;
  const loading = { status: 'loading', retried: entry?.retried ?? false };
  cache.set(fileId, loading);
  queue.push(fileId);
  pump();
  return loading;
}

/** A picture didn't load (its address probably expired): ask Drive again once, then give up. */
export function thumbnailFailed(lesson) {
  const fileId = driveFileId(lesson);
  const entry = cache.get(fileId);
  if (!entry || entry.status !== 'ready') return;
  if (entry.retried) cache.set(fileId, NO_PICTURE);
  else cache.set(fileId, { ...entry, at: 0, retried: true });
  refresh();
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
  refresh();
}
