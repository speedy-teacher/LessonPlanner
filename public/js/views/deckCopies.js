// "+ Add" → "Files or folders…" on Lesson Templates: what's picked in Drive is copied into the teacher's own
// templates folder and the copies are brought in (templateCopies.js) — the picked files are never used or
// changed. With no templates folder of her own yet, a "Lesson Templates" folder is made in her Drive.

import { google } from '../google.js';
import { driveLocation } from '../locations.js';
import { addFolder, DRIVE_FOLDER, importDriveItems, isDriveLessonFile } from '../library.js';
import { showNotice } from '../notices.js';
import { commit, store } from '../store.js';
import { copyPicked, makeTemplatesHome, templatesHome, watchingFolder } from '../templateCopies.js';
import { googleClient } from '../templateMaker/googleApi.js';
import { driveCalls } from '../templateMaker/makerDrive.js';
import { year } from './common.js';

const MAKER_PICKS = 'lesson-planner-template-maker';

function makerPick() {
  try { return JSON.parse(localStorage.getItem(MAKER_PICKS))?.templateFolderId ?? null; } catch { return null; }
}

const copying = (message) => showNotice({ id: 'drive-import', tone: 'info', title: 'Google Drive', message, seconds: null });

/**
 * Copy `picked` into the templates folder (`targetId` = the "Adds to" folder, tried first) and bring the copies in
 * (one Undo step). Returns { result, home: folder name, failed: [names], tooMany }.
 */
export async function copyLessonsIn(picked, { targetId = null } = {}) {
  const calls = driveCalls(googleClient({ token: () => google.token }));
  const y = year();
  copying('Finding your templates folder…');
  const home = await templatesHome(calls, store.state, y.id, { prefer: [targetId, makerPick()].filter(Boolean) });
  const made = home ? null : await makeTemplatesHome(calls);
  const driveId = home?.driveId ?? made.id;
  copying('Copying into your templates folder…');
  const copied = await copyPicked(calls, picked, {
    folderDriveId: driveId, wanted: isDriveLessonFile, step: (n) => copying(`Copying into your templates folder… (${n} done)`),
  });
  const result = commit((s) => {
    const folder = home ? s.deckFolders.find((f) => f.id === home.id) : addFolder(s, {
      yearId: y.id, name: made.name, watch: true, locations: [driveLocation({ fileId: made.id, mimeType: DRIVE_FOLDER })],
    });
    const seenBy = watchingFolder(s, folder.id);
    const r = importDriveItems(s, { yearId: y.id, parentId: folder.id, nodes: copied.nodes, seenBy });
    return { ...r, folders: home ? r.folders : [folder, ...r.folders] };
  });
  return { result, home: home?.name ?? made.name, failed: copied.failed, tooMany: copied.tooMany };
}
