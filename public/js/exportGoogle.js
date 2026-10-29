// Talking to Google Slides, Docs and Sheets for the lesson copies: typing details in, reading a file
// back (to update it in place, see exportFill.js), and placing pictures. Pictures are shared with
// "anyone with the link" only for the few seconds Google needs to fetch them, then sharing is turned
// off again (unless the picture was already shared that way before).

import { DriveError } from './drive.js';
import {
  docsUpdates, NotInPlace, pictureAnchors, placedPictures, placePictureRequests, sheetsUpdates, slidesUpdates, swapPictureRequests,
} from './exportFill.js';

const DRIVE = 'https://www.googleapis.com/drive/v3/files';
export const SLIDES = 'application/vnd.google-apps.presentation';
const DOCS = 'application/vnd.google-apps.document';
const SHEETS = 'application/vnd.google-apps.spreadsheet';
const SHARE_SETTLE_MS = 500;

const replaceAll = (find, text) => ({ replaceAllText: { containsText: { text: find, matchCase: true }, replaceText: text } });

// How each kind of Google file is read, written and filled in.
const KINDS = {
  [SLIDES]: {
    api: 'Google Slides API',
    read: (id) => `https://slides.googleapis.com/v1/presentations/${id}`,
    write: (id) => `https://slides.googleapis.com/v1/presentations/${id}:batchUpdate`,
    fill: replaceAll, updates: slidesUpdates,
  },
  [DOCS]: {
    api: 'Google Docs API',
    read: (id) => `https://docs.googleapis.com/v1/documents/${id}`,
    write: (id) => `https://docs.googleapis.com/v1/documents/${id}:batchUpdate`,
    fill: replaceAll, updates: docsUpdates,
  },
  [SHEETS]: {
    api: 'Google Sheets API',
    read: (id) => `https://sheets.googleapis.com/v4/spreadsheets/${id}?includeGridData=true&fields=${encodeURIComponent('sheets(properties(sheetId),data(startRow,startColumn,rowData(values(userEnteredValue))))')}`,
    write: (id) => `https://sheets.googleapis.com/v4/spreadsheets/${id}:batchUpdate`,
    fill: (find, text) => ({ findReplace: { find, replacement: text, allSheets: true, matchCase: true } }),
    updates: sheetsUpdates,
  },
};

/** Addresses Google can fetch a Drive picture from (while it's shared with anyone with the link). */
const pictureUrls = (fileId) => [`https://drive.google.com/uc?export=view&id=${fileId}`, `https://lh3.googleusercontent.com/d/${fileId}`];
const wait = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });

/** `send(url, init)` makes one call to Google (exportDrive.js). Returns the Slides/Docs/Sheets helpers. */
export function googleFiles(send) {
  const json = (method, body) => ({ method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

  async function batch(file, requests) {
    if (!requests.length) return;
    const kind = KINDS[file.mimeType];
    try {
      await send(kind.write(encodeURIComponent(file.id)), json('POST', { requests }));
    } catch (err) {
      err.api = kind.api;
      throw err;
    }
  }

  const read = async (file) => (await send(KINDS[file.mimeType].read(encodeURIComponent(file.id)))).json();

  /** Type the details into a fresh copy (it still has its placeholders). */
  function fill(file, values) {
    const kind = KINDS[file.mimeType];
    return kind ? batch(file, Object.entries(values).map(([find, text]) => kind.fill(find, text))) : undefined;
  }

  /** Swap the old details in a copy for new ones, in place (throws NotInPlace when it can't). */
  async function refill(template, copy, oldValues, newValues) {
    const kind = KINDS[copy.mimeType];
    if (!kind || template.mimeType !== copy.mimeType) throw new NotInPlace('not a Google file');
    const requests = kind.updates(await read(template), await read(copy), oldValues, newValues);
    await batch(copy, requests);
  }

  /** Run `use()` while the picture is shared with anyone with the link; then put its sharing back. */
  async function whileShared(fileId, use) {
    const id = encodeURIComponent(fileId);
    const { permissionIds = [] } = await (await send(`${DRIVE}/${id}?fields=permissionIds&supportsAllDrives=true`)).json();
    if (permissionIds.includes('anyoneWithLink') || permissionIds.includes('anyone')) return use();
    let permission;
    try {
      permission = await (await send(`${DRIVE}/${id}/permissions?supportsAllDrives=true&fields=id`, json('POST', { type: 'anyone', role: 'reader', allowFileDiscovery: false }))).json();
    } catch (err) {
      throw err.message === 'offline' || err.message === 'signed_out' ? err : new DriveError('cant_share');
    }
    try {
      await wait(SHARE_SETTLE_MS);
      return await use();
    } finally {
      await send(`${DRIVE}/${id}/permissions/${encodeURIComponent(permission.id)}?supportsAllDrives=true`, { method: 'DELETE' }).catch(() => {});
    }
  }

  /** Try each address Google might fetch the picture from. */
  async function withPictureUrl(fileId, requestsFor, copy) {
    let last;
    for (const url of pictureUrls(encodeURIComponent(fileId))) {
      try {
        return await batch(copy, requestsFor(url));
      } catch (err) {
        if (err.message !== 'drive_failed') throw err;
        last = err;
      }
    }
    throw last;
  }

  /**
   * Put the picture into a Slides copy: on its IMAGE_ANCHOR spots, or in place of the pictures the planner
   * put there before (`swap`). Copies with no spot get none. Throws NotInPlace when a swap finds no picture.
   */
  async function placePicture(copy, pictureFileId, { swap = false } = {}) {
    if (copy.mimeType !== SLIDES || !pictureFileId) return;
    const presentation = await read(copy);
    const spots = swap ? placedPictures(presentation) : pictureAnchors(presentation);
    if (!spots.length) {
      if (swap) throw new NotInPlace('picture was removed');
      return;
    }
    const requestsFor = (url) => (swap ? swapPictureRequests(spots, url) : placePictureRequests(spots, url));
    await whileShared(pictureFileId, () => withPictureUrl(pictureFileId, requestsFor, copy));
  }

  return { fill, refill, placePicture, read };
}
