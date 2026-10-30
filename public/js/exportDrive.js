// Lesson copies in Google Drive (see exportPlan.js for what goes where).
// Each copy carries a small hidden label (Drive "appProperties", only the planner sees them) saying
// which year, schedule entry and template it was made from, and what details were typed into it — so
// the planner can find its copies again from any computer, and update them in place later
// (exportFill.js), without saving anything about the copies in the plan itself.
// Template files are only ever read (copied, or downloaded for a folder on the computer).

import { DriveError } from './drive.js';
import { googleTypeFor } from './locations.js';
import { copyHash } from './exportPlan.js';
import { NotInPlace } from './exportFill.js';
import { googleFiles } from './exportGoogle.js';

const API = 'https://www.googleapis.com/drive/v3/files';
const FOLDER_MIME = 'application/vnd.google-apps.folder';
const COPY_FIELDS = 'id,name,mimeType,parents,appProperties';
export const COPY_LABEL = 'lessonPlannerCopy';
const PROP_BYTES = 124; // Drive's limit for one label (name + value)
const TOO_LONG = '…'; // a detail too long to remember: that copy is remade instead of updated in place
// Problems placing a picture that still leave a good copy (the picture is tried again after the next change).
const PICTURE_PROBLEMS = ['cant_share', 'drive_failed', 'no_access', 'not_found'];

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

// Google asked the planner to slow down (several copies are made at once): wait this long, then try again.
const SLOW_DOWN_MS = [1000, 3000, 8000];
const sleep = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });

/** "Too many requests right now" (Drive also says it with a 403 and a rate-limit reason), or a passing hiccup. */
function slowDown(status, body) {
  if (status === 429 || status >= 500) return true;
  return status === 403 && /rateLimitExceeded|userRateLimitExceeded/.test(JSON.stringify(body?.error ?? {}));
}

async function call(fetchFn, token, url, init = {}, wait = sleep) {
  for (let attempt = 0; ; attempt += 1) {
    let res;
    try {
      res = await fetchFn(url, { ...init, headers: { Authorization: `Bearer ${token}`, ...init.headers } });
    } catch {
      throw new DriveError('offline');
    }
    if (res.ok) return res;
    const body = await res.json().catch(() => null);
    if (!slowDown(res.status, body) || attempt >= SLOW_DOWN_MS.length) throw driveError(res.status, body);
    await wait(SLOW_DOWN_MS[attempt] * (1 + Math.random() / 2));
  }
}

function driveError(status, body) {
  if (status === 401) return new DriveError('signed_out');
  if (status === 403 && serviceOff(body)) return new DriveError('api_off');
  if (status === 403) return new DriveError('no_access');
  if (status === 404) return new DriveError('not_found');
  return new DriveError('drive_failed');
}

const jsonInit = (method, body) => ({ method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
const quote = (text) => `'${text.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
const bytes = (text) => new TextEncoder().encode(text).length;

// The copy has a picture the schedule no longer wants (one on hold is still wanted: it stays).
const losesPicture = (have, want) => !want.picture && Boolean(have.picture) && have.picture !== want.heldPicture;

// Details are remembered as labels "v_school", "v_week_number"… (from {{school}}, {{week_number}}…).
const labelOf = (placeholder) => `v_${placeholder.replace(/[{}]/g, '')}`;
const placeholderOf = (label) => `{{${label.slice(2)}}}`;

/** The labels that describe a copy's contents (old detail labels it no longer has are cleared). */
function contentLabels(want, picture, before = {}) {
  const labels = { hash: copyHash(want.template, want.values, picture), tpl: want.template, pic: picture || null };
  for (const key of Object.keys(before)) if (key.startsWith('v_')) labels[key] = null;
  for (const [placeholder, value] of Object.entries(want.values)) {
    const label = labelOf(placeholder);
    labels[label] = bytes(label) + bytes(value) <= PROP_BYTES ? value : TOO_LONG;
  }
  return labels;
}

function haveFrom(file) {
  const p = file.appProperties ?? {};
  const details = Object.entries(p).filter(([k]) => k.startsWith('v_'));
  return {
    id: file.id, entryId: p.entryId, lessonId: p.lessonId, hash: p.hash, place: p.place, template: p.tpl ?? null,
    picture: p.pic ?? '', labels: p,
    values: details.some(([, v]) => v === TOO_LONG) ? null : Object.fromEntries(details.map(([k, v]) => [placeholderOf(k), v])),
    name: file.name, mimeType: file.mimeType, parentId: file.parents?.[0] ?? null,
  };
}

const sameValues = (a, b) => JSON.stringify(Object.entries(a).sort()) === JSON.stringify(Object.entries(b).sort());

/**
 * The lesson copies of a year inside a Drive output folder.
 * `rootId` = the output folder; returns { list, create, update, move, remove } (see exportBridge.js).
 */
export function driveCopies({ token, rootId, yearId, fetchFn = fetch, wait = sleep }) {
  const send = (url, init) => call(fetchFn, token, url, init, wait);
  const files = googleFiles(send);
  // "a/b/c" → the folder id (a promise, so copies made at the same time into a new folder make it once), for this visit
  const folders = new Map();
  const movedTo = new Map(); // file id → folder it was moved into when same-name folders were combined

  /** Every file matching a Drive search (all pages). */
  async function search(q, fields, extra = {}) {
    const found = [];
    let pageToken = '';
    do {
      const params = new URLSearchParams({
        q, fields: `nextPageToken,files(${fields})`, pageSize: '1000', supportsAllDrives: 'true', includeItemsFromAllDrives: 'true', ...extra,
      });
      if (pageToken) params.set('pageToken', pageToken);
      const body = await (await send(`${API}?${params}`)).json();
      found.push(...(body.files ?? []));
      pageToken = body.nextPageToken ?? '';
    } while (pageToken);
    return found;
  }

  const children = (folderId) => search(`${quote(folderId)} in parents and trashed = false`, 'id,name,mimeType');

  async function childFolder(parentId, name) {
    const q = `${quote(parentId)} in parents and name = ${quote(name)} and mimeType = '${FOLDER_MIME}' and trashed = false`;
    const [oldest, ...twins] = await search(q, 'id', { orderBy: 'createdTime' });
    // Same-name folders side by side (two computers made it at once): their contents go into the oldest.
    for (const twin of twins) await combineInto(oldest.id, twin.id).catch(() => {});
    if (oldest) return oldest.id;
    const made = await send(`${API}?fields=id&supportsAllDrives=true`, jsonInit('POST', { name, mimeType: FOLDER_MIME, parents: [parentId] }));
    return (await made.json()).id;
  }

  /** Move everything in folder `fromId` into `keepId` (combining folders with the same name too), then trash `fromId`. */
  async function combineInto(keepId, fromId) {
    const inKeep = await children(keepId);
    for (const child of await children(fromId)) {
      const twin = child.mimeType === FOLDER_MIME && inKeep.find((f) => f.mimeType === FOLDER_MIME && f.name === child.name);
      if (twin) {
        await combineInto(twin.id, child.id);
      } else {
        const params = new URLSearchParams({ addParents: keepId, removeParents: fromId, supportsAllDrives: 'true', fields: 'id' });
        await send(`${API}/${encodeURIComponent(child.id)}?${params}`, jsonInit('PATCH', {}));
        movedTo.set(child.id, keepId);
      }
    }
    await send(`${API}/${encodeURIComponent(fromId)}?supportsAllDrives=true&fields=id`, jsonInit('PATCH', { trashed: true }));
  }

  function folderFor(path) {
    let parent = Promise.resolve(rootId);
    for (let i = 0; i < path.length; i += 1) {
      const key = path.slice(0, i + 1).join('/');
      if (!folders.has(key)) {
        const found = parent.then((parentId) => childFolder(parentId, path[i]));
        found.catch(() => { if (folders.get(key) === found) folders.delete(key); });
        folders.set(key, found);
      }
      parent = folders.get(key);
    }
    return parent;
  }

  async function list() {
    const q = `appProperties has { key='${COPY_LABEL}' and value=${quote(yearId)} } and trashed = false`;
    return (await search(q, COPY_FIELDS)).map(haveFrom);
  }

  /** A folder's hidden labels (the folder is made if needed): used to note which computer is updating the copies. */
  function folderLabels(path) {
    const url = async () => `${API}/${encodeURIComponent(await folderFor(path))}?supportsAllDrives=true`;
    return {
      read: async () => (await (await send(`${await url()}&fields=appProperties`)).json()).appProperties ?? {},
      write: async (labels) => { await send(`${await url()}&fields=id`, jsonInit('PATCH', { appProperties: labels })); },
    };
  }

  async function copyInto(want, source) {
    const meta = {
      name: want.name, parents: [await folderFor(want.path)],
      appProperties: { [COPY_LABEL]: yearId, entryId: want.entryId, lessonId: want.lessonId, place: want.place, ...contentLabels(want, '') },
    };
    const googleType = Object.keys(want.values).length || want.picture ? googleTypeFor(source.mimeType) : null;
    if (googleType) meta.mimeType = googleType;
    const url = `${API}/${encodeURIComponent(source.fileId)}/copy?supportsAllDrives=true&fields=${COPY_FIELDS}`;
    return haveFrom(await (await send(url, jsonInit('POST', meta))).json());
  }

  async function relabel(have, labels) {
    const res = await send(`${API}/${encodeURIComponent(have.id)}?supportsAllDrives=true&fields=${COPY_FIELDS}`, jsonInit('PATCH', { appProperties: labels }));
    return haveFrom(await res.json());
  }

  /** Put the picture in (sharing it for a moment). A picture problem leaves the copy as it is, noted on it. */
  async function addPicture(have, want, { swap = false } = {}) {
    if (!want.picture || want.picture === have.picture) return { picture: have.picture, problem: null };
    try {
      await files.placePicture(have, want.picture, { swap });
      return { picture: want.picture, problem: null };
    } catch (err) {
      if (!PICTURE_PROBLEMS.includes(err.message)) throw err;
      return { picture: have.picture, problem: err };
    }
  }

  /** Copy the template into its week folder, fill in the details and place the picture. */
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
      await files.fill(have, want.values);
    } catch (err) {
      await remove(have).catch(() => {}); // never leave a half-made copy behind
      throw err;
    }
    const { picture, problem } = await addPicture(have, want);
    const done = picture ? await relabel(have, contentLabels(want, picture, have.labels)) : have;
    return { ...done, pictureProblem: problem };
  }

  /**
   * Bring a copy up to date in the same file: move it if needed, swap its old details for the new ones,
   * and swap its picture. Throws NotInPlace ('not_in_place') when that can't be done safely.
   */
  async function update(have, want, source) {
    if (!have.values || have.template !== want.template || have.lessonId !== want.lessonId) throw new NotInPlace('not known');
    if (losesPicture(have, want)) throw new NotInPlace('picture taken away');
    const moved = have.place !== want.place || have.name !== want.name || have.entryId !== want.entryId;
    const current = moved ? await move(have, want) : have;
    if (!sameValues(have.values, want.values)) {
      await files.refill({ id: source.fileId, mimeType: source.mimeType }, current, have.values, want.values);
    }
    const { picture, problem } = await addPicture(current, want, { swap: Boolean(have.picture) });
    const done = await relabel(current, contentLabels(want, picture, have.labels));
    return { ...done, pictureProblem: problem };
  }

  /** Put a copy in its new folder and/or give it its new name (and its new schedule entry, when reused). */
  async function move(have, want) {
    const parentId = await folderFor(want.path);
    const params = new URLSearchParams({ supportsAllDrives: 'true', fields: COPY_FIELDS });
    const oldParent = movedTo.get(have.id) ?? have.parentId;
    if (parentId !== oldParent) {
      params.set('addParents', parentId);
      if (oldParent) params.set('removeParents', oldParent);
    }
    const labels = { place: want.place, entryId: want.entryId };
    const res = await send(`${API}/${encodeURIComponent(have.id)}?${params}`, jsonInit('PATCH', { name: want.name, appProperties: labels }));
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

  return { kind: 'drive', list, create, update, move, remove, folderLabels };
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
