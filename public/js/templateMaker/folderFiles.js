// Picking whole folders in the Template Maker window: every lesson file inside a picked folder (and the
// folders inside it) is added, each noting the folder it came from ("Fall › Week 3").
// Files that can't become templates (pictures, PDFs…) are skipped, and so are the planner's own files.
//
// Works with driveCalls (makerDrive.js) on the real Google Drive or the fake one in the tests.

import { FOLDER_MIME, kindOf } from './fileKinds.js';

/** At most this many files from one pick (a whole Drive by mistake would take hours). */
export const MAX_FROM_FOLDERS = 150;
const MAX_DEPTH = 6;

const byName = (a, b) => a.name.localeCompare(b.name, undefined, { numeric: true });

/**
 * The files to make templates from, for what the teacher picked (files and/or folders), in the order picked
 * (a folder's files by name, then its folders'). Returns { files: [{ …driveFile, fromFolder }], skipped, tooMany }.
 */
export async function filesFromPicks(calls, picked) {
  const files = [];
  const seenFolders = new Set();
  let skipped = 0;
  let tooMany = false;
  const take = (file, fromFolder) => {
    if (files.length >= MAX_FROM_FOLDERS) { tooMany = true; return; }
    if (!files.some((f) => f.id === file.id)) files.push(fromFolder ? { ...file, fromFolder } : file);
  };
  const walk = async (folder, path, depth) => {
    if (seenFolders.has(folder.id) || depth > MAX_DEPTH || tooMany) return;
    seenFolders.add(folder.id);
    const inside = (await calls.listFolder(folder.id)).sort(byName);
    for (const item of inside.filter((i) => i.mimeType !== FOLDER_MIME)) {
      if (usable(item)) take(item, path); else skipped += 1;
    }
    for (const sub of inside.filter((i) => i.mimeType === FOLDER_MIME)) await walk(sub, `${path} › ${sub.name}`, depth + 1);
  };
  for (const item of picked) {
    if (item.mimeType === FOLDER_MIME) await walk(item, item.name, 0);
    else take(item, null);
  }
  return { files, skipped, tooMany };
}

/** A file that can become a template (and isn't one of the planner's own files). */
function usable(file) {
  return Boolean(kindOf(file.mimeType)) && !file.properties?.lessonPlanner && !file.appProperties?.templateMaker;
}
