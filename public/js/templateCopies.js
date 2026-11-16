// "+ Add" → "Files or folders…" on the Lesson Templates tab: the planner never uses the picked Drive files
// themselves as templates — they may be a colleague's, and editing a "template" would change her original.
// Every picked lesson file is copied into the teacher's own templates folder; a picked folder is copied as a
// new folder there (same name, with its folders inside), and the copies become the templates.
//
//   templatesHome — where copies go: the "Adds to" folder, else the Template Maker's templates folder, else the
//                   top watched one … — only a Drive folder of the teacher's own that can take new files.
//                   None → null (the caller makes a "Lesson Templates" folder: makeTemplatesHome).
//   copyPicked    — make the copies: [{ id, name, mimeType, modifiedTime, children? }] for importDriveItems.
//                   `review: true` = new copies (and copied folders) carry the label COPY_REVIEW until the
//                   teacher has looked at them, so watched folders don't bring them in yet.
//   reviewList    — the copied files to look at, one by one (with the folder path they're in).
//   keepCopies    — after looking: kept copies lose the label (and take a new name), new copies not kept go to
//                   the trash (and copied folders left with nothing kept); returns the nodes to bring in.
//   staleReviews  — copies nobody looked at for a day (a tab closed halfway), to tidy away.
//
// A file already in the templates folder, or one the planner copied before, is used as it is. Picking the
// same file again finds the copy made last time (label `lpCopiedFrom` = the original's id) instead of another.
// Works with driveCalls (templateMaker/makerDrive.js) on the real Google Drive or the fake one in the tests.

import { driveFolders, isOwnFolder } from './templateMaker/setup.js';
import { COPY_REVIEW } from './templateMaker/makerDrive.js';

export const COPIED_FROM = 'lpCopiedFrom';
export const HOME_NAME = 'Lesson Templates';
export const MAX_COPIES = 200;
export { COPY_REVIEW };
const DAY = 24 * 60 * 60 * 1000;
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
export async function copyPicked(calls, picked, { folderDriveId, wanted, step = () => {}, review = false }) {
  const run = { calls, home: folderDriveId, wanted, step, review, done: 0, failed: [], tooMany: false };
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
/** A lesson file in the templates folder (a copy, or one already there): `copy` = one to look at before adding. */
const copyNode = (info) => ({ ...nodeOf(info), copy: true });
/** Made for this look (or left from an earlier one nobody finished): goes to the trash if it isn't kept. */
export const isReviewCopy = (node) => node.properties?.lessonPlanner === COPY_REVIEW;

function copyItem(run, info, parentId, depth) {
  if (info.mimeType === FOLDER) return copyFolder(run, info, parentId, depth);
  if (!run.wanted(info)) return depth === 0 ? nodeOf(info) : null;
  return copyFile(run, info, parentId);
}

async function copyFolder(run, info, parentId, depth) {
  const keep = inPlace(run, info);
  let target = info;
  if (!keep) {
    target = await run.calls.findCopy(parentId, info.id)
      ?? await run.calls.makeFolder({ name: info.name, parentId, from: info.id, review: run.review }).catch(() => null);
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
  if (info.mimeType !== FOLDER) return run.wanted(info) ? copyNode(info) : null;
  const kids = depth < MAX_DEPTH ? await run.calls.listFolder(info.id).catch(() => []) : [];
  const children = [];
  for (const child of kids) {
    const node = await asItIs(run, child, depth + 1);
    if (node) children.push(node);
  }
  return nodeOf(info, children);
}

async function copyFile(run, info, parentId) {
  if (inPlace(run, info)) return copyNode(info);
  if (run.done >= MAX_COPIES) { run.tooMany = true; return null; }
  try {
    const copy = await run.calls.findCopy(parentId, info.id)
      ?? await run.calls.copyTemplate(info.id, { name: info.name, folderId: parentId, review: run.review });
    run.done += 1;
    run.step(run.done);
    return copyNode(copy);
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

// ---------- looking before adding ----------

/** Every copied file to look at: [{ id, name, mimeType, path: "Fall Unit › Week 3" | '', review }]. */
export function reviewList(nodes, path = []) {
  return nodes.flatMap((node) => {
    if (node.children) return reviewList(node.children, [...path, node.name]);
    return node.copy ? [{ id: node.id, name: node.name, mimeType: node.mimeType, path: path.join(' › '), review: isReviewCopy(node) }] : [];
  });
}

/**
 * The teacher looked: `keep` = ids of the copies to add, `names` = Map id → the name she gave it. Kept copies lose
 * the review label (and take the new name); new copies not kept go to the trash, and so do copied folders with
 * nothing kept inside. Returns { nodes: what to bring in (importDriveItems), failed: [names] }.
 */
export async function keepCopies(calls, nodes, { keep, names = new Map() }) {
  const run = { calls, keep, names, failed: [] };
  const kept = [];
  for (const node of nodes) {
    const left = await keepNode(run, node);
    if (left) kept.push(left);
  }
  return { nodes: kept, failed: run.failed };
}

function keepNode(run, node) {
  if (node.children) return keepFolder(run, node);
  if (!node.copy) return node; // picked on its own but not a lesson: counted as skipped
  return run.keep.has(node.id) ? keepFile(run, node) : dropCopy(run, node);
}

async function keepFolder(run, node) {
  const children = [];
  for (const child of node.children) {
    const left = await keepNode(run, child);
    if (left) children.push(left);
  }
  if (!children.some((c) => c.copy || c.children)) return dropCopy(run, node);
  if (isReviewCopy(node)) await run.calls.keepCopy(node.id).catch(() => {});
  return { ...node, properties: {}, children };
}

async function keepFile(run, node) {
  const wanted = run.names.get(node.id)?.trim();
  const name = wanted && wanted !== node.name ? wanted : null;
  if (!isReviewCopy(node) && !name) return node;
  try {
    const info = await run.calls.keepCopy(node.id, { name });
    return { ...node, name: info?.name ?? name ?? node.name, properties: {} };
  } catch {
    run.failed.push(node.name);
    return null;
  }
}

/** Not kept: a copy made for this look goes to the trash; anything that was already there is just left out. */
async function dropCopy(run, node) {
  if (isReviewCopy(node)) await run.calls.trashFile(node.id).catch(() => {});
  return null;
}

/** Copies (and copied folders) still waiting to be looked at a day later: nobody finished looking — to trash. */
export function staleReviews(files, now = Date.now()) {
  return files.filter((f) => f.properties?.lessonPlanner === COPY_REVIEW && now - Date.parse(f.modifiedTime ?? 0) > DAY);
}
