// Reading Google Drive straight from the browser: Google's file picker, and
// listing what's inside a folder (and its folders). Nothing goes through the
// planner's server — only the deck details end up in your planner data.

import { DRIVE_FOLDER, isDriveLessonFile } from './library.js';

const FILES_URL = 'https://www.googleapis.com/drive/v3/files';
const PICKER_SRC = 'https://apis.google.com/js/api.js';
const FILE_FIELDS = 'id,name,mimeType,modifiedTime,properties';
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
 * Folders inside folders are read too. Folders and lesson files are kept (not shortcuts or plan files).
 */
export async function listFolderTree(token, folderId, { fetchFn = fetch, depth = 0, visited = new Set() } = {}) {
  visited.add(folderId);
  const items = (await listChildren(token, folderId, fetchFn))
    .filter((f) => f.mimeType === DRIVE_FOLDER || isDriveLessonFile(f));
  for (const item of items) {
    if (item.mimeType !== DRIVE_FOLDER || visited.has(item.id) || depth >= MAX_DEPTH) continue;
    item.children = await listFolderTree(token, item.id, { fetchFn, depth: depth + 1, visited });
  }
  return items;
}

/**
 * The short-lived address of the picture Google Drive keeps of a file's first slide/page,
 * or null if it has none. (It works in an <img>; Google doesn't allow downloading it directly.)
 */
export async function fetchThumbnailLink(token, fileId, { fetchFn = fetch } = {}) {
  const params = new URLSearchParams({ fields: 'hasThumbnail,thumbnailLink', supportsAllDrives: 'true' });
  const body = await getJson(`${FILES_URL}/${encodeURIComponent(fileId)}?${params}`, token, fetchFn);
  return body.hasThumbnail === false ? null : body.thumbnailLink ?? null;
}

/**
 * Whether a Drive file is shared with "anyone with the link" (or public) — only those can be put into a
 * slide, doc or sheet by Google. true / false, or null when Drive doesn't say.
 */
export async function fetchLinkSharing(token, fileId, { fetchFn = fetch } = {}) {
  const params = new URLSearchParams({ fields: 'permissionIds', supportsAllDrives: 'true' });
  const body = await getJson(`${FILES_URL}/${encodeURIComponent(fileId)}?${params}`, token, fetchFn);
  if (!Array.isArray(body.permissionIds)) return null;
  return body.permissionIds.some((id) => id === 'anyoneWithLink' || id === 'anyone');
}

/** Google's thumbnail address at another size ("…=s220" → "…=s640"). */
export function sizedThumbnail(link, size) {
  return /=s\d+$/.test(link) ? link.replace(/=s\d+$/, `=s${size}`) : link;
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
 * Open Google's picker for lesson files (any kind) and folders (several at once).
 * Resolves to the picked items [{ id, name, mimeType }], or [] if closed.
 */
export function pickFromDrive({ token, apiKey, clientId }, { title = 'Pick lesson files or folders' } = {}) {
  return openPicker({ token, apiKey, clientId }, {
    mimeTypes: null, folders: true, multiple: true, title,
  });
}

/** Open Google's picker for one plan file (also gives the planner permission to save it). */
export function pickPlanFromDrive({ token, apiKey, clientId }) {
  return openPicker({ token, apiKey, clientId }, { mimeTypes: ['application/json'], title: 'Pick a plan file' });
}

/** Open Google's picker for one folder (also gives the planner permission to save plans in it). */
export function pickFolderFromDrive({ token, apiKey, clientId }) {
  return openPicker({ token, apiKey, clientId }, { mimeTypes: [DRIVE_FOLDER], folders: true, title: 'Pick a folder for the plan' });
}

const PICTURE_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/bmp', 'image/svg+xml'];

/**
 * Open Google's picker on a folder of pictures, to choose several. Picking files here is what gives
 * the planner permission to change them (e.g. share a picture for a moment to place it in a slide).
 */
export function pickPicturesFromDrive({ token, apiKey, clientId }, { parentId = null } = {}) {
  return openPicker({ token, apiKey, clientId }, { mimeTypes: PICTURE_TYPES, multiple: true, parentId, title: 'Select the pictures (Ctrl+A selects all)' });
}

/** `mimeTypes` = the kinds of file to show (null = every kind); `parentId` = the folder to open in. */
async function openPicker({ token, apiKey, clientId }, { mimeTypes, folders = false, multiple = false, title, parentId = null }) {
  await loadPicker();
  const { picker } = window.google;
  const view = new picker.DocsView(picker.ViewId.DOCS).setIncludeFolders(true).setSelectFolderEnabled(folders);
  if (parentId) view.setParent(parentId);
  if (mimeTypes) view.setMimeTypes((folders ? mimeTypes : [...mimeTypes, DRIVE_FOLDER]).join(','));
  const builder = new picker.PickerBuilder().addView(view);
  if (multiple) builder.enableFeature(picker.Feature.MULTISELECT_ENABLED);
  if (!multiple && mimeTypes) builder.addView(new picker.DocsView(picker.ViewId.DOCS).setMimeTypes(mimeTypes.join(',')).setOwnedByMe(false));
  return new Promise((resolve) => {
    builder
      .setOAuthToken(token)
      .setDeveloperKey(apiKey)
      .setAppId(projectNumber(clientId))
      .setOrigin(window.location.origin)
      .setTitle(title)
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
