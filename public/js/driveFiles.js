// Plan files in Google Drive: find, create, read and save them, straight from
// the browser. Plan files live in a "Lesson Planner" folder in your Drive and
// carry a small label so the planner can find them (and ones shared with you).

import { WORKSPACE_MIME, WORKSPACE_PROPERTY } from './workspaceFile.js';
import { DriveError } from './drive.js';

const API = 'https://www.googleapis.com/drive/v3/files';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3/files';
const FOLDER_MIME = 'application/vnd.google-apps.folder';
const FOLDER_PROPERTY = { key: 'lessonPlanner', value: 'folder' };
export const FOLDER_NAME = 'Lesson Planner';
const FILE_FIELDS = 'id,name,parents,headRevisionId,modifiedTime,ownedByMe,capabilities(canEdit),owners(displayName)';

async function call(fetchFn, token, url, init = {}) {
  let res;
  try {
    res = await fetchFn(url, { ...init, headers: { Authorization: `Bearer ${token}`, ...init.headers } });
  } catch {
    throw new DriveError('offline');
  }
  if (res.status === 401) throw new DriveError('signed_out');
  if (res.status === 403) throw new DriveError('no_access');
  if (res.status === 404) throw new DriveError('not_found');
  if (!res.ok) throw new DriveError('drive_failed');
  return res;
}

const has = ({ key, value }) => `properties has { key='${key}' and value='${value}' }`;

/** Plan files you can open (yours and ones shared with you), newest first. */
export async function listPlanFiles(token, { fetchFn = fetch } = {}) {
  const params = new URLSearchParams({
    q: `${has(WORKSPACE_PROPERTY)} and trashed = false`,
    fields: `files(${FILE_FIELDS})`, orderBy: 'modifiedTime desc', pageSize: '100',
    supportsAllDrives: 'true', includeItemsFromAllDrives: 'true',
  });
  const body = await (await call(fetchFn, token, `${API}?${params}`)).json();
  return (body.files ?? []).map(fileInfo);
}

function fileInfo(f) {
  return {
    fileId: f.id, name: f.name, folderId: f.parents?.[0] ?? null, rev: f.headRevisionId ?? null, modifiedTime: f.modifiedTime ?? null,
    ownedByMe: f.ownedByMe !== false, canEdit: f.capabilities?.canEdit !== false, owner: f.owners?.[0]?.displayName ?? '',
  };
}

/** The "Lesson Planner" folder in your Drive (made the first time). */
async function planFolder(token, fetchFn) {
  const params = new URLSearchParams({
    q: `${has(FOLDER_PROPERTY)} and mimeType = '${FOLDER_MIME}' and trashed = false and 'me' in owners`,
    fields: 'files(id)', pageSize: '1',
  });
  const found = (await (await call(fetchFn, token, `${API}?${params}`)).json()).files?.[0];
  if (found) return found.id;
  const made = await call(fetchFn, token, `${API}?fields=id`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: FOLDER_NAME, mimeType: FOLDER_MIME, properties: { [FOLDER_PROPERTY.key]: FOLDER_PROPERTY.value } }),
  });
  return (await made.json()).id;
}

/**
 * Save a new plan file into `folderId` (a folder you picked), or else the "Lesson Planner" folder.
 * Returns { fileId, name, folderId, rev, canEdit }.
 */
export async function createPlanFile(token, { name, text, folderId = null }, { fetchFn = fetch } = {}) {
  const parent = folderId || await planFolder(token, fetchFn);
  const meta = { name, mimeType: WORKSPACE_MIME, parents: [parent], properties: { [WORKSPACE_PROPERTY.key]: WORKSPACE_PROPERTY.value } };
  const boundary = `planner${Date.now()}`;
  const body = [
    `--${boundary}`, 'Content-Type: application/json; charset=UTF-8', '', JSON.stringify(meta),
    `--${boundary}`, `Content-Type: ${WORKSPACE_MIME}`, '', text, `--${boundary}--`, '',
  ].join('\r\n');
  const res = await call(fetchFn, token, `${UPLOAD}?uploadType=multipart&fields=${FILE_FIELDS}`, {
    method: 'POST', headers: { 'Content-Type': `multipart/related; boundary=${boundary}` }, body,
  });
  return fileInfo(await res.json());
}

/** Details of a plan file (its current revision, whether you can change it). */
export async function planFileInfo(token, fileId, { fetchFn = fetch } = {}) {
  const url = `${API}/${encodeURIComponent(fileId)}?fields=${FILE_FIELDS}&supportsAllDrives=true`;
  return fileInfo(await (await call(fetchFn, token, url)).json());
}

/** A plan file's details and text. */
export async function readPlanFile(token, fileId, { fetchFn = fetch } = {}) {
  const info = await planFileInfo(token, fileId, { fetchFn });
  const res = await call(fetchFn, token, `${API}/${encodeURIComponent(fileId)}?alt=media&supportsAllDrives=true`);
  return { ...info, text: await res.text() };
}

/** Replace a plan file's contents. Returns the new revision id. */
export async function savePlanFile(token, fileId, text, { fetchFn = fetch } = {}) {
  const url = `${UPLOAD}/${encodeURIComponent(fileId)}?uploadType=media&fields=headRevisionId&supportsAllDrives=true`;
  const res = await call(fetchFn, token, url, { method: 'PATCH', headers: { 'Content-Type': WORKSPACE_MIME }, body: text });
  return (await res.json()).headRevisionId ?? null;
}

/** Ask Drive to keep this version of the file forever (one per day, as a backup). */
export async function keepRevision(token, fileId, rev, { fetchFn = fetch } = {}) {
  const url = `${API}/${encodeURIComponent(fileId)}/revisions/${encodeURIComponent(rev)}`;
  await call(fetchFn, token, url, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ keepForever: true }) });
}

/** Move a plan file into another folder. Returns the new folder's id. */
export async function movePlanFile(token, fileId, toFolderId, { fetchFn = fetch } = {}) {
  const { folderId: from } = await planFileInfo(token, fileId, { fetchFn });
  const params = new URLSearchParams({ addParents: toFolderId, fields: 'parents', supportsAllDrives: 'true' });
  if (from && from !== toFolderId) params.set('removeParents', from);
  const res = await call(fetchFn, token, `${API}/${encodeURIComponent(fileId)}?${params}`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: '{}',
  });
  return (await res.json()).parents?.[0] ?? toFolderId;
}

/** A folder's name ("My Drive" for the top of your Drive). */
export async function folderName(token, folderId, { fetchFn = fetch } = {}) {
  const url = `${API}/${encodeURIComponent(folderId)}?fields=name,parents&supportsAllDrives=true`;
  const body = await (await call(fetchFn, token, url)).json();
  return body.parents?.length ? body.name : 'My Drive';
}
