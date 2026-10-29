// Lesson copies in Google Drive (see exportPlan.js for what goes where).
// Each copy carries a small hidden label (Drive "appProperties", only the planner sees them) saying
// which year, schedule entry and template it was made from, so the planner can find its copies
// again from any computer — nothing about the copies has to be saved in the plan itself.
// Template files are only ever read (copied, or downloaded for a folder on the computer).

import { DriveError } from './drive.js';
import { googleTypeFor } from './locations.js';

const API = 'https://www.googleapis.com/drive/v3/files';
const FOLDER_MIME = 'application/vnd.google-apps.folder';
const COPY_FIELDS = 'id,name,mimeType,parents,appProperties';
export const COPY_LABEL = 'lessonPlannerCopy';

// Where filled-in details are typed in, by kind of Google file.
const FILLERS = {
  'application/vnd.google-apps.presentation': {
    api: 'Google Slides API',
    url: (id) => `https://slides.googleapis.com/v1/presentations/${id}:batchUpdate`,
    request: (find, text) => ({ replaceAllText: { containsText: { text: find, matchCase: true }, replaceText: text } }),
  },
  'application/vnd.google-apps.document': {
    api: 'Google Docs API',
    url: (id) => `https://docs.googleapis.com/v1/documents/${id}:batchUpdate`,
    request: (find, text) => ({ replaceAllText: { containsText: { text: find, matchCase: true }, replaceText: text } }),
  },
  'application/vnd.google-apps.spreadsheet': {
    api: 'Google Sheets API',
    url: (id) => `https://sheets.googleapis.com/v4/spreadsheets/${id}:batchUpdate`,
    request: (find, text) => ({ findReplace: { find, replacement: text, allSheets: true, matchCase: true } }),
  },
};

// What a Google file is saved as on the computer.
const EXPORTS = {
  'application/vnd.google-apps.presentation': ['application/vnd.openxmlformats-officedocument.presentationml.presentation', '.pptx'],
  'application/vnd.google-apps.document': ['application/vnd.openxmlformats-officedocument.wordprocessingml.document', '.docx'],
  'application/vnd.google-apps.spreadsheet': ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', '.xlsx'],
  'application/vnd.google-apps.drawing': ['application/pdf', '.pdf'],
};

/** A Google service the planner needs is switched off in the Google project (`err.api` names it). */
function serviceOff(body) {
  const text = JSON.stringify(body?.error ?? {});
  return /SERVICE_DISABLED|accessNotConfigured|has not been used in project/.test(text);
}

async function call(fetchFn, token, url, init = {}) {
  let res;
  try {
    res = await fetchFn(url, { ...init, headers: { Authorization: `Bearer ${token}`, ...init.headers } });
  } catch {
    throw new DriveError('offline');
  }
  if (res.ok) return res;
  const body = await res.json().catch(() => null);
  if (res.status === 401) throw new DriveError('signed_out');
  if (res.status === 403 && serviceOff(body)) throw new DriveError('api_off');
  if (res.status === 403) throw new DriveError('no_access');
  if (res.status === 404) throw new DriveError('not_found');
  throw new DriveError('drive_failed');
}

const jsonInit = (method, body) => ({ method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
const quote = (text) => `'${text.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;

function haveFrom(file) {
  const p = file.appProperties ?? {};
  return {
    id: file.id, entryId: p.entryId, lessonId: p.lessonId, hash: p.hash, place: p.place,
    name: file.name, mimeType: file.mimeType, parentId: file.parents?.[0] ?? null,
  };
}

/**
 * The lesson copies of a year inside a Drive output folder.
 * `rootId` = the output folder; returns { list, create, move, remove } (see exportBridge.js).
 */
export function driveCopies({ token, rootId, yearId, fetchFn = fetch }) {
  const send = (url, init) => call(fetchFn, token, url, init);
  const folders = new Map(); // "a/b/c" → folder id, for this visit

  async function childFolder(parentId, name) {
    const params = new URLSearchParams({
      q: `${quote(parentId)} in parents and name = ${quote(name)} and mimeType = '${FOLDER_MIME}' and trashed = false`,
      fields: 'files(id)', pageSize: '1', supportsAllDrives: 'true', includeItemsFromAllDrives: 'true',
    });
    const found = (await (await send(`${API}?${params}`)).json()).files?.[0];
    if (found) return found.id;
    const made = await send(`${API}?fields=id&supportsAllDrives=true`, jsonInit('POST', { name, mimeType: FOLDER_MIME, parents: [parentId] }));
    return (await made.json()).id;
  }

  async function folderFor(path) {
    let parentId = rootId;
    for (let i = 0; i < path.length; i += 1) {
      const key = path.slice(0, i + 1).join('/');
      if (!folders.has(key)) folders.set(key, await childFolder(parentId, path[i]));
      parentId = folders.get(key);
    }
    return parentId;
  }

  async function list() {
    const copies = [];
    let pageToken = '';
    do {
      const params = new URLSearchParams({
        q: `appProperties has { key='${COPY_LABEL}' and value=${quote(yearId)} } and trashed = false`,
        fields: `nextPageToken,files(${COPY_FIELDS})`, pageSize: '1000', supportsAllDrives: 'true', includeItemsFromAllDrives: 'true',
      });
      if (pageToken) params.set('pageToken', pageToken);
      const body = await (await send(`${API}?${params}`)).json();
      copies.push(...(body.files ?? []).map(haveFrom));
      pageToken = body.nextPageToken ?? '';
    } while (pageToken);
    return copies;
  }

  async function copyInto(want, source) {
    const fill = Object.keys(want.values).length > 0;
    const meta = {
      name: want.name, parents: [await folderFor(want.path)],
      appProperties: { [COPY_LABEL]: yearId, entryId: want.entryId, lessonId: want.lessonId, hash: want.hash, place: want.place },
    };
    const googleType = fill ? googleTypeFor(source.mimeType) : null;
    if (googleType) meta.mimeType = googleType;
    const url = `${API}/${encodeURIComponent(source.fileId)}/copy?supportsAllDrives=true&fields=${COPY_FIELDS}`;
    return haveFrom(await (await send(url, jsonInit('POST', meta))).json());
  }

  /** Copy the template into its week folder and fill in the details. */
  async function create(want, source) {
    let have;
    try {
      have = await copyInto(want, source);
    } catch (err) {
      if (err.message !== 'not_found' || !folders.size) throw err;
      folders.clear(); // a folder may have been deleted in Drive: look them up again once
      have = await copyInto(want, source);
    }
    try {
      await fillIn(have, want.values);
    } catch (err) {
      await remove(have).catch(() => {}); // never leave a half-made copy behind
      throw err;
    }
    return have;
  }

  async function fillIn(have, values) {
    const filler = FILLERS[have.mimeType];
    const pairs = Object.entries(values);
    if (!filler || !pairs.length) return;
    try {
      await send(filler.url(encodeURIComponent(have.id)), jsonInit('POST', { requests: pairs.map(([find, text]) => filler.request(find, text)) }));
    } catch (err) {
      err.api = filler.api;
      throw err;
    }
  }

  /** Put a copy in its new folder and/or give it its new name. */
  async function move(have, want) {
    const parentId = await folderFor(want.path);
    const params = new URLSearchParams({ supportsAllDrives: 'true', fields: COPY_FIELDS });
    if (parentId !== have.parentId) {
      params.set('addParents', parentId);
      if (have.parentId) params.set('removeParents', have.parentId);
    }
    const res = await send(`${API}/${encodeURIComponent(have.id)}?${params}`, jsonInit('PATCH', { name: want.name, appProperties: { place: want.place } }));
    return haveFrom(await res.json());
  }

  /** Put a copy in Drive's trash (it can be brought back from there for 30 days). */
  async function remove(have) {
    try {
      await send(`${API}/${encodeURIComponent(have.id)}?supportsAllDrives=true&fields=id`, jsonInit('PATCH', { trashed: true }));
    } catch (err) {
      if (err.message !== 'not_found') throw err;
    }
  }

  return { kind: 'drive', list, create, move, remove };
}

/**
 * A Drive template's contents, for a copy on the computer: Google files are saved as Office files
 * (Slides → .pptx…). Returns { blob, ext } (ext like ".pptx", or "" if the name has none).
 */
export async function downloadTemplate(token, fileId, { fetchFn = fetch } = {}) {
  const send = (url) => call(fetchFn, token, url);
  const id = encodeURIComponent(fileId);
  const info = await (await send(`${API}/${id}?fields=name,mimeType&supportsAllDrives=true`)).json();
  const exported = EXPORTS[info.mimeType];
  if (exported) {
    const res = await send(`${API}/${id}/export?mimeType=${encodeURIComponent(exported[0])}`);
    return { blob: await res.blob(), ext: exported[1] };
  }
  const res = await send(`${API}/${id}?alt=media&supportsAllDrives=true`);
  return { blob: await res.blob(), ext: info.name?.match(/\.[\w]{1,6}$/)?.[0] ?? '' };
}
