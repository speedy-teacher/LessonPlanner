// The lesson deck library: folders, and bringing decks in from the computer
// or Google Drive. Only a deck's details (name, folder, where its file lives)
// are kept — never the file itself. Shared by the browser app and the tests.
// Where each deck and folder lives is a list of locations (see locations.js).

import { add, find, inYear, remove, update } from './model.js';
import { addLocation, driveFileId, driveLocation, hasLocation, localLocation, localUri, markSeen } from './locations.js';

/** File endings that count as slide decks (anything else in a folder is skipped). */
export const DECK_EXTENSIONS = ['pptx', 'ppt', 'pptm', 'potx', 'odp', 'key', 'pdf'];
export const DRIVE_FOLDER = 'application/vnd.google-apps.folder';
export const DRIVE_DECK_TYPES = [
  'application/vnd.google-apps.presentation',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/vnd.ms-powerpoint',
  'application/vnd.oasis.opendocument.presentation',
  'application/pdf',
];
export const DEFAULT_AUTO_FIELDS = ['school', 'grade', 'date'];

const byName = (a, b) => a.name.localeCompare(b.name, undefined, { numeric: true });

function extension(fileName) {
  const dot = fileName.lastIndexOf('.');
  return dot > 0 ? fileName.slice(dot + 1).toLowerCase() : '';
}

export function isDeckFile(fileName) {
  return DECK_EXTENSIONS.includes(extension(fileName));
}

/** "Week 1 - Beat.pptx" → "Week 1 - Beat". */
export function deckName(fileName) {
  return isDeckFile(fileName) ? fileName.slice(0, fileName.lastIndexOf('.')) : fileName;
}

// ---------- folders ----------

export function foldersIn(state, yearId, parentId) {
  return inYear(state, 'deckFolders', yearId).filter((f) => f.parentId === parentId).sort(byName);
}

export function decksIn(state, yearId, folderId) {
  return inYear(state, 'lessons', yearId).filter((l) => l.folderId === folderId).sort(byName);
}

export function addFolder(state, { yearId, name, parentId = null, locations = [], watch = false }) {
  return add(state, 'deckFolders', { yearId, name, parentId, locations, watch, seenDriveIds: [] });
}

/** A new lesson deck with the usual details filled in. */
export function addDeck(state, { yearId, name, folderId = null, category = '', locations = [], isNew = false }) {
  return add(state, 'lessons', {
    yearId, name, category, autoFields: [...DEFAULT_AUTO_FIELDS], instrumentIds: [], folderId, locations, isNew,
  });
}

/** The folders from the top down to this one: [top, …, folder]. */
export function folderPath(state, folderId) {
  const path = [];
  for (let f = find(state, 'deckFolders', folderId); f && !path.includes(f); f = find(state, 'deckFolders', f.parentId)) {
    path.unshift(f);
  }
  return path;
}

/** Ids of this folder and every folder inside it, however deep. */
export function folderAndInside(state, folderId) {
  const ids = [folderId];
  for (let i = 0; i < ids.length; i++) {
    state.deckFolders.filter((f) => f.parentId === ids[i]).forEach((f) => ids.push(f.id));
  }
  return ids;
}

/** Every deck in a folder and its folders. */
export function decksInside(state, folderId) {
  const ids = new Set(folderAndInside(state, folderId));
  return state.lessons.filter((l) => ids.has(l.folderId));
}

/**
 * Every deck of a year grouped by folder, for dropdowns: [{ label: 'Rhythm › Week 1', lessons }].
 * Top-level decks come first (label ''), then folders in tree order; empty folders are left out.
 */
export function decksByFolder(state, yearId) {
  const groups = [];
  const walk = (folderId, names) => {
    const lessons = decksIn(state, yearId, folderId);
    if (lessons.length) groups.push({ label: names.join(' › '), lessons });
    foldersIn(state, yearId, folderId).forEach((f) => walk(f.id, [...names, f.name]));
  };
  walk(null, []);
  return groups;
}

/** True when a newly added deck is somewhere inside — the ❗ that leads you to it. */
export function hasNewInside(state, folderId) {
  return decksInside(state, folderId).some((l) => l.isNew);
}

export function moveDeck(state, lessonId, folderId) {
  return update(state, 'lessons', lessonId, { folderId });
}

/** Move a folder into another (or to the top with null). A folder can't go inside itself. */
export function moveFolder(state, folderId, parentId) {
  if (parentId && folderAndInside(state, folderId).includes(parentId)) return null;
  return update(state, 'deckFolders', folderId, { parentId });
}

/** Delete a folder but keep what's in it: its decks and folders move up one level. */
export function removeFolder(state, folderId) {
  const folder = find(state, 'deckFolders', folderId);
  if (!folder) return;
  state.lessons.filter((l) => l.folderId === folderId).forEach((l) => { l.folderId = folder.parentId; });
  state.deckFolders.filter((f) => f.parentId === folderId).forEach((f) => { f.parentId = folder.parentId; });
  remove(state, 'deckFolders', folderId);
}

// ---------- from the computer ----------

function now() {
  return new Date().toISOString();
}

/** The computer folder with this name, remembered if it's new. */
function localRoot(state, name) {
  return state.localRoots.find((r) => r.name === name) ?? add(state, 'localRoots', { name });
}

/** The library folder called `name` inside `parentId` (made if needed), linked to its computer folder. */
function ensureLocalFolder(state, { yearId, parentId, name, location }) {
  const folder = foldersIn(state, yearId, parentId).find((f) => f.name === name)
    ?? addFolder(state, { yearId, name, parentId });
  return addLocation(folder, location);
}

/**
 * Add decks picked on the computer. `files` are [{ path, size, modifiedTime }] where path is
 * "Deck.pptx" for single files or "Folder/Inner/Deck.pptx" for a picked folder; the folders are
 * made in the library to match, and the picked folder is remembered as a computer folder
 * (`localRoots`). Picking the same file again doesn't add it twice.
 * Returns { added: [lessons], folders: [new folders], skipped: [paths that aren't decks] }.
 */
export function importLocalFiles(state, { yearId, parentId = null, files, seenAt = now() }) {
  const result = { added: [], folders: [], skipped: [] };
  const before = new Set(state.deckFolders.map((f) => f.id));
  for (const file of files) {
    const parts = file.path.split('/').filter(Boolean);
    const fileName = parts.pop();
    if (!isDeckFile(fileName)) { result.skipped.push(file.path); continue; }
    const rootId = parts.length ? localRoot(state, parts[0]).id : null;
    const folderId = parts.reduce((parent, name, i) => ensureLocalFolder(state, {
      yearId, parentId: parent, name, location: localLocation({ rootId, path: parts.slice(1, i + 1).join('/') }, seenAt),
    }).id, parentId);
    const path = [...parts.slice(1), fileName].join('/');
    const location = localLocation({ rootId, path, size: file.size, modifiedTime: file.modifiedTime }, seenAt);
    const existing = inYear(state, 'lessons', yearId).find((l) => hasLocation(l, localUri(rootId, path)));
    if (existing) { addLocation(existing, location); continue; }
    result.added.push(addDeck(state, { yearId, name: deckName(fileName), folderId, locations: [location] }));
  }
  result.folders = state.deckFolders.filter((f) => !before.has(f.id));
  return result;
}

// ---------- from Google Drive ----------

/**
 * Bring in Drive items. `nodes` are Drive files/folders { id, name, mimeType, modifiedTime,
 * children? } (children = what's inside a folder, already read from Drive).
 * Folders become library folders (top ones are watched); decks become lessons.
 * `markNew` flags decks as newly added (used when checking watched folders).
 * Returns { added, folders, skipped }.
 */
export function importDriveItems(state, { yearId, parentId = null, nodes, markNew = false, seenAt = now() }) {
  const ctx = { state, yearId, markNew, seenAt, seen: null, result: { added: [], folders: [], skipped: [] } };
  for (const node of nodes) {
    if (node.mimeType === DRIVE_FOLDER) addDriveFolder(ctx, node, parentId, true);
    else addDriveDeck(ctx, node, parentId);
  }
  return ctx.result;
}

function driveRecord(ctx, collection, fileId) {
  return inYear(ctx.state, collection, ctx.yearId).find((r) => r.locations.some((l) => l.kind === 'drive' && l.fileId === fileId));
}

function seeDrive(ctx, record, fileId) {
  markSeen(record.locations.find((l) => l.fileId === fileId), ctx.seenAt);
}

function addDriveFolder(ctx, node, parentId, top) {
  let folder = driveRecord(ctx, 'deckFolders', node.id);
  if (folder) seeDrive(ctx, folder, node.id);
  else {
    const location = driveLocation({ fileId: node.id, mimeType: DRIVE_FOLDER }, ctx.seenAt);
    folder = addFolder(ctx.state, { yearId: ctx.yearId, name: node.name, parentId, watch: top, locations: [location] });
    ctx.result.folders.push(folder);
  }
  const outer = ctx.seen;
  if (top) ctx.seen = new Set(folder.seenDriveIds);
  for (const child of node.children ?? []) {
    if (child.mimeType === DRIVE_FOLDER) addDriveFolder(ctx, child, folder.id, false);
    else addDriveDeck(ctx, child, folder.id);
  }
  if (top) {
    folder.seenDriveIds = [...ctx.seen];
    ctx.seen = outer;
  }
}

function addDriveDeck(ctx, node, folderId) {
  if (!DRIVE_DECK_TYPES.includes(node.mimeType)) { ctx.result.skipped.push(node.name); return; }
  const seenBefore = ctx.seen?.has(node.id);
  ctx.seen?.add(node.id);
  const existing = driveRecord(ctx, 'lessons', node.id);
  if (existing) seeDrive(ctx, existing, node.id);
  if (seenBefore || existing) return;
  const location = driveLocation({ fileId: node.id, mimeType: node.mimeType, modifiedTime: node.modifiedTime }, ctx.seenAt);
  ctx.result.added.push(addDeck(ctx.state, {
    yearId: ctx.yearId, name: deckName(node.name), folderId, locations: [location], isNew: ctx.markNew,
  }));
}

/**
 * The cloud shown on a folder: 'watching' (new decks in its Drive folder are pulled in),
 * 'not-watching' (came from Drive, but watching was turned off), or null — not from Drive,
 * or inside another Drive folder (that folder's cloud covers everything in it).
 */
export function driveLink(state, folder) {
  if (!driveFileId(folder)) return null;
  if (folderPath(state, folder.parentId).some((f) => driveFileId(f))) return null;
  return folder.watch ? 'watching' : 'not-watching';
}

/** Folders whose Google Drive folder is checked for new decks. */
export function watchedFolders(state, yearId) {
  return inYear(state, 'deckFolders', yearId).filter((f) => f.watch && driveFileId(f));
}

/**
 * Add the decks that appeared in watched Drive folders since last time.
 * `trees` maps a watched folder's id to its Drive contents read just now.
 * New decks are marked ❗ new. Nothing is ever removed. Returns the decks added.
 */
export function syncWatchedFolders(state, yearId, trees, seenAt = now()) {
  const added = [];
  for (const folder of watchedFolders(state, yearId)) {
    const tree = trees[folder.id];
    if (!tree) continue;
    const node = { id: driveFileId(folder), name: folder.name, mimeType: DRIVE_FOLDER, children: tree };
    added.push(...importDriveItems(state, { yearId, parentId: folder.parentId, nodes: [node], markNew: true, seenAt }).added);
  }
  return added;
}
