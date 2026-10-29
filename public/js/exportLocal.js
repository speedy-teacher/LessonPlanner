// Lesson copies in a folder on this computer (see exportPlan.js for what goes where).
// Browsers can't label files, so a small list of the planner's copies is kept in the output
// folder itself ("lesson-planner-copies.json"). Details can't be filled in here — Google's
// services do the filling in — so templates are copied as they are.
// Works in browsers that let web pages save into a folder you pick (Chrome and Edge).

import { newId } from './model.js';

export const LIST_FILE = 'lesson-planner-copies.json';

/** Whether this browser can save into a folder on the computer. */
export function canUseComputerFolders() {
  return typeof window !== 'undefined' && 'showDirectoryPicker' in window;
}

async function readList(dir) {
  try {
    const file = await (await dir.getFileHandle(LIST_FILE)).getFile();
    const body = JSON.parse(await file.text());
    return Array.isArray(body.copies) ? body.copies : [];
  } catch {
    return [];
  }
}

async function writeFile(dir, name, data) {
  const writable = await (await dir.getFileHandle(name, { create: true })).createWritable();
  await writable.write(data);
  await writable.close();
}

async function folderFor(dir, path) {
  let folder = dir;
  for (const name of path) folder = await folder.getDirectoryHandle(name, { create: true });
  return folder;
}

async function exists(folder, name) {
  try {
    await folder.getFileHandle(name);
    return true;
  } catch {
    return false;
  }
}

/** "1 - Song.pptx", or "1 - Song (2).pptx" when that name is already taken in the folder. */
async function freeName(folder, base, ext) {
  let name = `${base}${ext}`;
  for (let n = 2; await exists(folder, name); n += 1) name = `${base} (${n})${ext}`;
  return name;
}

/**
 * The lesson copies of a year inside a folder picked on this computer (`dir`, a folder handle).
 * `readTemplate(source)` → { blob, ext } gets a template's contents. Returns { list, create, move, remove }.
 */
export function localCopies({ dir, yearId, readTemplate }) {
  let all = null; // every year's copies in this folder (the saved list)
  const load = async () => { all ??= await readList(dir); return all; };
  const save = () => writeFile(dir, LIST_FILE, JSON.stringify({ copies: all }, null, 1));

  async function list() {
    all = await readList(dir);
    return all.filter((c) => c.yearId === yearId);
  }

  async function put(want, blob, ext) {
    const folder = await folderFor(dir, want.path);
    const fileName = await freeName(folder, want.name, ext);
    await writeFile(folder, fileName, blob);
    return { fileName, ext };
  }

  async function create(want, source) {
    const { blob, ext } = await readTemplate(source);
    const saved = await put(want, blob, ext);
    const have = {
      id: newId('copy'), yearId, entryId: want.entryId, lessonId: want.lessonId, hash: want.hash, place: want.place,
      name: want.name, path: want.path, ...saved,
    };
    (await load()).push(have);
    await save();
    return have;
  }

  async function move(have, want) {
    const from = await folderFor(dir, have.path);
    const blob = await (await from.getFileHandle(have.fileName)).getFile();
    const saved = await put(want, blob, have.ext ?? '');
    await from.removeEntry(have.fileName).catch(() => {});
    const moved = { ...have, place: want.place, name: want.name, path: want.path, ...saved };
    all = (await load()).map((c) => (c.id === have.id ? moved : c));
    await save();
    return moved;
  }

  async function remove(have) {
    const folder = await folderFor(dir, have.path).catch(() => null);
    await folder?.removeEntry(have.fileName).catch(() => {});
    all = (await load()).filter((c) => c.id !== have.id);
    await save();
  }

  return { kind: 'local', list, create, move, remove };
}

// ---------- the picked folder, remembered in this browser only ----------

const DB_NAME = 'lesson-planner-folders';
const STORE = 'handles';

function db() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function run(mode, action) {
  const store = (await db()).transaction(STORE, mode).objectStore(STORE);
  return new Promise((resolve, reject) => {
    const req = action(store);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/** Ask for a folder on this computer and remember it under `key`. Returns the folder handle, or null. */
export async function pickComputerFolder(key) {
  try {
    const handle = await window.showDirectoryPicker({ id: 'lesson-copies', mode: 'readwrite' });
    await run('readwrite', (s) => s.put(handle, key));
    return handle;
  } catch {
    return null; // closed without picking
  }
}

export function rememberedFolder(key) {
  return run('readonly', (s) => s.get(key)).catch(() => null);
}

/**
 * Whether the planner may save in the folder: 'granted', or 'prompt' (the browser asks again after
 * the planner is reopened — `ask` must then be true, and it must follow a click).
 */
export async function folderPermission(handle, { ask = false } = {}) {
  const mode = { mode: 'readwrite' };
  const now = await handle.queryPermission(mode);
  return now === 'granted' || !ask ? now : handle.requestPermission(mode);
}
