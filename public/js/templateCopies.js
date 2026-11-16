// "+ Add" → "Files or folders…" on the Lesson Templates tab: the planner never uses the picked Drive files
// themselves as templates — they may be a colleague's, and editing a "template" would change her original.
// Every picked lesson file is copied into the teacher's own templates folder; a picked folder is copied as a
// new folder there (same name, with its folders inside), and the copies become the templates.
//
//   templatesHome — where copies go: the "Adds to" folder, else the Template Maker's templates folder, else the
//                   top watched one … — only a Drive folder of the teacher's own that can take new files.
//                   None → null (the caller makes a "Lesson Templates" folder: makeTemplatesHome).
//   copyPicked    — make the copies: [{ id, name, mimeType, modifiedTime, children? }] for importDriveItems.
//
// A file already in the templates folder, or one the planner copied before, is used as it is. Picking the
// same file again finds the copy made last time (label `lpCopiedFrom` = the original's id) instead of another.
// Works with driveCalls (templateMaker/makerDrive.js) on the real Google Drive or the fake one in the tests.

import { driveFolders, isOwnFolder } from './templateMaker/setup.js';

export const COPIED_FROM = 'lpCopiedFrom';
export const HOME_NAME = 'Lesson Templates';
export const MAX_COPIES = 200;
const MAX_DEPTH = 12;
const FOLDER = 'application/vnd.google-apps.folder';

export { isOwnFolder };

/**
 * The templates folder copies go in: { id, name, driveId } (a deckFolders record), or null when the plan has
 * none of the teacher's own. `prefer` = record ids to try first, in order (the "Adds to" folder, the Template
 * Maker's pick).
 */
export async function templatesHome(calls, state, yearId, { prefer = [] } = {}) {
  const folders = driveFolders(state, yearId, 'deckFolders');
  const rank = (f) => {
    const i = prefer.indexOf(f.id);
    if (i !== -1) return i;
    return prefer.length + (f.watched && !f.path.includes(' › ') ? 0 : 1);
  };
  for (const folder of [...folders].sort((a, b) => rank(a) - rank(b))) {
    const info = await calls.fileInfo(folder.driveId).catch(() => null);
    if (isOwnFolder(info)) return { id: folder.id, name: folder.name, driveId: folder.driveId };
  }
  return null;
}

/** A new "Lesson Templates" folder in the teacher's Drive (for a plan with no templates folder yet). */
export function makeTemplatesHome(calls) {
  return calls.makeFolder({ name: HOME_NAME, parentId: null });
}

/**
 * Copy the picked items into the templates folder (`folderDriveId`). `wanted(file)` = a file that can be a lesson
 * (others picked on their own are handed back as they are, so they're counted as skipped; inside folders they're
 * left out). `step(done)` tells how many files are done. Returns { nodes, failed: [names], tooMany }.
 */
export async function copyPicked(calls, picked, { folderDriveId, wanted, step = () => {} }) {
  const run = { calls, home: folderDriveId, wanted, step, done: 0, failed: [], tooMany: false };
  const nodes = [];
  for (const item of picked) {
    const info = await calls.fileInfo(item.id).catch(() => null);
    if (!info) { run.failed.push(item.name); continue; }
    const node = await copyItem(run, info, folderDriveId, 0);
    if (node) nodes.push(node);
  }
  return { nodes, failed: run.failed, tooMany: run.tooMany };
}

/** Already the teacher's template: the templates folder itself, a file in it, or a copy the planner made. */
const inPlace = (run, info) => info.id === run.home || (info.parents ?? []).includes(run.home) || Boolean(info.appProperties?.[COPIED_FROM]);

const nodeOf = (info, children) => ({
  id: info.id, name: info.name, mimeType: info.mimeType, modifiedTime: info.modifiedTime ?? null, properties: info.properties ?? {},
  ...(children ? { children } : {}),
});

function copyItem(run, info, parentId, depth) {
  if (info.mimeType === FOLDER) return copyFolder(run, info, parentId, depth);
  if (!run.wanted(info)) return depth === 0 ? nodeOf(info) : null;
  return copyFile(run, info, parentId);
}

async function copyFolder(run, info, parentId, depth) {
  const keep = inPlace(run, info);
  let target = info;
  if (!keep) {
    target = await run.calls.findCopy(parentId, info.id) ?? await run.calls.makeFolder({ name: info.name, parentId, from: info.id }).catch(() => null);
    if (!target) { run.failed.push(info.name); return null; }
  }
  const children = [];
  if (depth < MAX_DEPTH) {
    for (const child of await run.calls.listFolder(info.id).catch(() => [])) {
      const node = keep ? await asItIs(run, child, depth + 1) : await copyItem(run, child, target.id, depth + 1);
      if (node) children.push(node);
    }
  }
  return nodeOf(target, children);
}

/** Inside a folder that's already the teacher's own: nothing is copied. */
async function asItIs(run, info, depth) {
  if (info.mimeType !== FOLDER) return run.wanted(info) ? nodeOf(info) : null;
  const kids = depth < MAX_DEPTH ? await run.calls.listFolder(info.id).catch(() => []) : [];
  const children = [];
  for (const child of kids) {
    const node = await asItIs(run, child, depth + 1);
    if (node) children.push(node);
  }
  return nodeOf(info, children);
}

async function copyFile(run, info, parentId) {
  if (inPlace(run, info)) return nodeOf(info);
  if (run.done >= MAX_COPIES) { run.tooMany = true; return null; }
  try {
    const copy = await run.calls.findCopy(parentId, info.id) ?? await run.calls.copyTemplate(info.id, { name: info.name, folderId: parentId });
    run.done += 1;
    run.step(run.done);
    return nodeOf(copy);
  } catch {
    run.failed.push(info.name);
    return null;
  }
}

/** The watched folder (top-most) a templates folder is inside — or is — in the planner; null = none. */
export function watchingFolder(state, folderId) {
  let top = null;
  const visited = new Set();
  for (let f = state.deckFolders.find((x) => x.id === folderId); f && !visited.has(f.id); f = state.deckFolders.find((x) => x.id === f.parentId)) {
    visited.add(f.id);
    if (f.watch) top = f;
  }
  return top;
}
