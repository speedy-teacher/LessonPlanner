// Where the Template Maker window puts what it makes: a templates folder (a Lesson Templates folder that
// came from Google Drive) and — if the teacher keeps pictures — a pictures folder (from the Images tab).
// Both come from the open plan and are checked in Drive (still there, can take new files). When there are
// several, the teacher picks; the pick is remembered in this browser only.
//
// findSetup talks to Google; driveFolders / describeSetup / setupProblemText are pure (tested).

import { inYear } from '../model.js';
import { runPool } from './googleApi.js';

/** The year's library folders that are Google Drive folders: [{ id, name, path, driveId, watched }] (path = "Lessons › Grade 2"). */
export function driveFolders(state, yearId, collection) {
  const folders = inYear(state, collection, yearId);
  const byId = new Map(folders.map((f) => [f.id, f]));
  return folders.map((f) => ({ record: f, drive: f.locations?.find((l) => l.kind === 'drive')?.fileId }))
    .filter(({ drive }) => drive)
    .map(({ record, drive }) => ({ id: record.id, name: record.name, path: pathOf(record, byId), driveId: drive, watched: Boolean(record.watch) }))
    .sort((a, b) => a.path.localeCompare(b.path, undefined, { numeric: true }));
}

function pathOf(folder, byId) {
  const names = [];
  const seen = new Set();
  for (let f = folder; f && !seen.has(f.id); f = byId.get(f.parentId)) {
    seen.add(f.id);
    names.unshift(f.name);
  }
  return names.join(' › ');
}

/** The plan's Drive folders that are still in Drive and can take new files: { templateFolders, imageFolders }. */
export async function findSetup(calls, state, yearId, { pace }) {
  const templates = driveFolders(state, yearId, 'deckFolders');
  const pictures = driveFolders(state, yearId, 'imageFolders');
  const all = [...templates, ...pictures];
  const checked = await runPool(all, (folder) => calls.fileInfo(folder.driveId), { pace });
  const usable = new Set(all.filter((f, i) => folderOk(checked[i], calls)).map((f) => f.driveId));
  return { templateFolders: templates.filter((f) => usable.has(f.driveId)), imageFolders: pictures.filter((f) => usable.has(f.driveId)) };
}

const folderOk = (result, calls) => result.ok && !result.value.trashed && calls.isFolder(result.value) && result.value.capabilities?.canAddChildren !== false;

/**
 * What to use, from what was found and what the teacher picked before (`saved` = { templateFolderId, imageFolderId }).
 * Returns { problem: 'no_templates' | null, templateFolders, imageFolders, templateFolder, imageFolder, several }.
 */
export function describeSetup(found, saved = {}) {
  const { templateFolders, imageFolders } = found;
  if (!templateFolders.length) return { problem: 'no_templates', templateFolders, imageFolders };
  return {
    problem: null, templateFolders, imageFolders,
    templateFolder: folderPick(templateFolders, saved.templateFolderId),
    imageFolder: saved.imageFolderId === 'none' ? null : folderPick(imageFolders, saved.imageFolderId),
    several: { templateFolder: templateFolders.length > 1, imageFolder: imageFolders.length > 1 },
  };
}

/** The folder picked before, else the top watched one, else the first (null when there are none). */
function folderPick(folders, savedId) {
  return folders.find((f) => f.id === savedId) ?? folders.find((f) => f.watched && !f.path.includes(' › ')) ?? folders[0] ?? null;
}

/** What's wrong, in the teacher's words (null = nothing). */
export function setupProblemText(problem) {
  return {
    no_templates: 'Your templates need a home in Google Drive first. Close this window, click “+ Add ▾” → “Files or folders…” under Google Drive and bring in the folder where you keep your lesson templates — then open this window again.',
  }[problem] ?? null;
}
