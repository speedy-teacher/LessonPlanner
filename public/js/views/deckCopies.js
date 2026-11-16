// "+ Add" → "Files or folders…" on Lesson Templates: what's picked in Drive is copied into the teacher's own
// templates folder (templateCopies.js) — the picked files are never used or changed. With no templates folder of
// her own yet, a "Lesson Templates" folder is made in her Drive. Then she looks at every copy first
// (views/copyReview.js): only the ones she keeps are brought in; the others go to the trash.

import { google } from '../google.js';
import { driveLocation } from '../locations.js';
import { addFolder, DRIVE_FOLDER, importDriveItems, isDriveLessonFile } from '../library.js';
import { dismissNotice, showNotice } from '../notices.js';
import { commit, store } from '../store.js';
import { copyPicked, makeTemplatesHome, reviewList, staleReviews, templatesHome, watchingFolder } from '../templateCopies.js';
import { googleClient } from '../templateMaker/googleApi.js';
import { driveCalls } from '../templateMaker/makerDrive.js';
import { year } from './common.js';
import { openCopyReview } from './copyReview.js';

const MAKER_PICKS = 'lesson-planner-template-maker';

function makerPick() {
  try { return JSON.parse(localStorage.getItem(MAKER_PICKS))?.templateFolderId ?? null; } catch { return null; }
}

const copying = (message) => showNotice({ id: 'drive-import', tone: 'info', title: 'Google Drive', message, seconds: null });

/** Copies nobody finished looking at (a tab closed halfway) go to the trash after a day. */
function tidyOldReviews(calls) {
  calls.listCopyReviews().then((files) => Promise.all(staleReviews(files).map((f) => calls.trashFile(f.id)))).catch(() => {});
}

/**
 * Copy `picked` into the templates folder (`targetId` = the "Adds to" folder, tried first), then open the window
 * to look at the copies. `done(copies)` runs once she has decided: copies = { result, home: folder name,
 * failed: [names], tooMany } (result = what was brought in, one Undo step).
 */
export async function copyLessonsIn(picked, { targetId = null, done }) {
  const calls = driveCalls(googleClient({ token: () => google.token }));
  const y = year();
  tidyOldReviews(calls);
  copying('Finding your templates folder…');
  const home = await templatesHome(calls, store.state, y.id, { prefer: [targetId, makerPick()].filter(Boolean) });
  const made = home ? null : await makeTemplatesHome(calls);
  copying('Copying into your templates folder…');
  const copied = await copyPicked(calls, picked, {
    folderDriveId: home?.driveId ?? made.id, wanted: isDriveLessonFile, review: true,
    step: (n) => copying(`Copying into your templates folder… (${n} done)`),
  });
  const homeName = home?.name ?? made.name;
  const finish = (result, failed = []) => done({ result, home: homeName, failed: [...copied.failed, ...failed], tooMany: copied.tooMany });
  const add = (nodes) => bringIn(nodes, { home, made, yearId: y.id });
  if (!reviewList(copied.nodes).length) {
    finish(add(copied.nodes));
    return;
  }
  dismissNotice('drive-import');
  openCopyReview({
    calls, nodes: copied.nodes, add, home: homeName,
    onDone: (result) => {
      if (made && !result.added.length) calls.trashFile(made.id).catch(() => {}); // the new folder stayed empty
      finish(result, result.failed);
    },
  });
}

/** Bring the kept copies in (one Undo step); a templates folder made just now is added to the planner too. */
function bringIn(nodes, { home, made, yearId }) {
  return commit((s) => {
    const folder = home ? s.deckFolders.find((f) => f.id === home.id) : addFolder(s, {
      yearId, name: made.name, watch: true, locations: [driveLocation({ fileId: made.id, mimeType: DRIVE_FOLDER })],
    });
    const seenBy = watchingFolder(s, folder.id);
    const r = importDriveItems(s, { yearId, parentId: folder.id, nodes, seenBy });
    return { ...r, folders: home ? r.folders : [folder, ...r.folders] };
  });
}
