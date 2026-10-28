// Reading Google Drive straight from the browser: Google's file picker, and
// listing what's inside a folder (and its folders). Nothing goes through the
// planner's server — only the deck details end up in your planner data.

import { DRIVE_DECK_TYPES, DRIVE_FOLDER } from './library.js';

const FILES_URL = 'https://www.googleapis.com/drive/v3/files';
const PICKER_SRC = 'https://apis.google.com/js/api.js';
const FILE_FIELDS = 'id,name,mimeType,modifiedTime';
const MAX_DEPTH = 12;

/** Thrown with message 'needs_folder_access' when the sign-in can't look inside folders yet. */
export class DriveError extends Error {}

async function getJson(url, token, fetchFn) {
  const res = await fetchFn(url, { headers: { Authorization: `Bearer ${token}` } });
  if (res.status === 401) throw new DriveError('signed_out');
  if (res.status === 403 || res.status === 404) throw new DriveError('needs_folder_access');
  if (!res.ok) throw new DriveError('drive_failed');
  return res.json();
}

/** Everything directly inside a Drive folder (all pages). */
async function listChildren(token, folderId, fetchFn) {
  const files = [];
  let pageToken = '';
  do {
    const params = new URLSearchParams({
      q: `'${folderId.replace(/'/g, "\\'")}' in parents and trashed = false`,
      fields: `nextPageToken,files(${FILE_FIELDS})`,
      pageSize: '1000',
      supportsAllDrives: 'true',
      includeItemsFromAllDrives: 'true',
    });
    if (pageToken) params.set('pageToken', pageToken);
    const body = await getJson(`${FILES_URL}?${params}`, token, fetchFn);
    files.push(...(body.files ?? []));
    pageToken = body.nextPageToken ?? '';
  } while (pageToken);
  return files;
}

/**
 * A folder's contents as a tree: [{ id, name, mimeType, …, children? }].
 * Folders inside folders are read too. Only folders and slide decks are kept.
 */
export async function listFolderTree(token, folderId, { fetchFn = fetch, depth = 0, visited = new Set() } = {}) {
  visited.add(folderId);
  const items = (await listChildren(token, folderId, fetchFn))
    .filter((f) => f.mimeType === DRIVE_FOLDER || DRIVE_DECK_TYPES.includes(f.mimeType));
  for (const item of items) {
    if (item.mimeType !== DRIVE_FOLDER || visited.has(item.id) || depth >= MAX_DEPTH) continue;
    item.children = await listFolderTree(token, item.id, { fetchFn, depth: depth + 1, visited });
  }
  return items;
}

// ---------- Google's file picker ----------

let pickerPromise = null;
function loadPicker() {
  pickerPromise ??= new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = PICKER_SRC;
    script.onload = () => window.gapi.load('picker', { callback: resolve, onerror: reject });
    script.onerror = () => { pickerPromise = null; reject(new DriveError('offline')); };
    document.head.append(script);
  });
  return pickerPromise;
}

/** The Google project number is the start of the Client ID ("1234-abc.apps…" → "1234"). */
export function projectNumber(clientId) {
  return (clientId || '').trim().split('-')[0];
}

/**
 * Open Google's picker for slide decks and folders (several at once).
 * Resolves to the picked items [{ id, name, mimeType }], or [] if closed.
 */
export async function pickFromDrive({ token, apiKey, clientId }) {
  await loadPicker();
  const { picker } = window.google;
  const view = new picker.DocsView(picker.ViewId.DOCS)
    .setIncludeFolders(true)
    .setSelectFolderEnabled(true)
    .setMimeTypes([...DRIVE_DECK_TYPES, DRIVE_FOLDER].join(','));
  return new Promise((resolve) => {
    new picker.PickerBuilder()
      .addView(view)
      .enableFeature(picker.Feature.MULTISELECT_ENABLED)
      .setOAuthToken(token)
      .setDeveloperKey(apiKey)
      .setAppId(projectNumber(clientId))
      .setOrigin(window.location.origin)
      .setTitle('Pick slide decks or folders')
      .setCallback((data) => {
        if (data.action === picker.Action.PICKED) resolve(data.docs.map(pickedItem));
        if (data.action === picker.Action.CANCEL) resolve([]);
      })
      .build()
      .setVisible(true);
  });
}

function pickedItem(doc) {
  return { id: doc.id, name: doc.name, mimeType: doc.mimeType, modifiedTime: null };
}
