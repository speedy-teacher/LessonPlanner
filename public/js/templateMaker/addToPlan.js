// Adding the new templates and pictures to the open plan, the way the planner itself brings in a file from
// a watched Drive folder: a lesson per template (marked ❗ new, so the teacher sees it), a picture per
// picture, and the Drive file noted as "seen" by its watched folder (so it's never brought in twice).
//
// Safe to repeat: a file already in the library (this year) is updated, never doubled.
//
// Pure logic, shared by the browser and the Node tests.

import { addDeck, addImage } from '../library.js';
import { driveLocation } from '../locations.js';
import { inYear } from '../model.js';

const FOLDERS = { lessons: 'deckFolders', images: 'imageFolders' };

const driveIdOf = (record) => record.locations?.find((l) => l.kind === 'drive')?.fileId ?? null;

/**
 * `made` = { lessons: [{ fileId, mimeType, modifiedTime, name, folderId, fields }],
 *            images: [{ fileId, mimeType, modifiedTime, name, folderId }] }
 * (folderId = the planner's folder record). Changes `state`; returns { lessons, images } = the records.
 */
export function addTemplates(state, made, { yearId, now = new Date().toISOString() }) {
  return {
    lessons: (made.lessons ?? []).map((item) => put(state, 'lessons', item, { yearId, now })),
    images: (made.images ?? []).map((item) => put(state, 'images', item, { yearId, now })),
  };
}

function put(state, collection, item, { yearId, now }) {
  const [existing, ...twins] = inYear(state, collection, yearId).filter((r) => driveIdOf(r) === item.fileId);
  // The planner may have brought the file in from its watched folder meanwhile: keep one record per file.
  state[collection] = state[collection].filter((r) => !twins.includes(r) || !r.isNew);
  const location = driveLocation(item, now);
  const record = existing ?? fresh(state, collection, item, { yearId, location });
  if (existing) {
    existing.name = item.name;
    existing.locations = [location, ...existing.locations.filter((l) => l.uri !== location.uri)];
  }
  if (collection === 'lessons') record.autoFields = [...new Set([...(record.autoFields ?? []), ...(item.fields ?? [])])];
  noteSeen(state, FOLDERS[collection], item.folderId, item.fileId);
  return record;
}

function fresh(state, collection, item, { yearId, location }) {
  const fields = { yearId, name: item.name, folderId: item.folderId ?? null, locations: [location], isNew: true };
  return collection === 'lessons' ? addDeck(state, fields) : addImage(state, fields);
}

/** The top watched folder above `folderId` remembers the Drive file (the planner's `seenDriveIds`). */
function noteSeen(state, folders, folderId, fileId) {
  let top = null;
  const visited = new Set();
  for (let f = state[folders].find((x) => x.id === folderId); f && !visited.has(f.id); f = state[folders].find((x) => x.id === f.parentId)) {
    visited.add(f.id);
    top = f;
  }
  if (top && !(top.seenDriveIds ?? []).includes(fileId)) top.seenDriveIds = [...(top.seenDriveIds ?? []), fileId];
}
