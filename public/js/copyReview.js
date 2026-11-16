// "+ Add" → "Files or folders…" on Lesson Templates: look before adding. The picked Drive files have been copied
// into the teacher's templates folder (templateCopies.js, `review: true`); this is the look at them, without the
// page itself (views/copyReview.js draws it; test/copyReview.test.js drives it):
//   every copied file — also each one inside a picked folder — gets a picture, a link to open and change it in
//   Google, a name box and "Add this one" (ticked) → addKept: kept copies are added (one Undo step), the others
//   go to the trash. throwAll = nothing is added.
//
// `add(nodes)` brings the kept copies into the plan and returns what importDriveItems returned.
// Works with driveCalls (templateMaker/makerDrive.js) on the real Google Drive or the fake one in the tests.

import { keepCopies, reviewList } from './templateCopies.js';

// A copy's picture that isn't there yet (Drive makes one a little after the copy) is asked for again after these waits.
const PICTURE_RETRIES_MS = [5000, 15000, 30000, 60000];

/** Where a copy opens in Google, to look at it or change it. */
export const openLink = (fileId) => `https://drive.google.com/open?id=${encodeURIComponent(fileId)}`;

export function createCopyReview({ calls, nodes, add, pictureRetries = PICTURE_RETRIES_MS }) {
  const state = {
    phase: 'review', // review → adding → done
    files: reviewList(nodes).map((f) => ({ ...f, title: f.name, keep: true, picture: null, pictureState: 'loading' })),
    result: null, // { added, folders, skipped, failed } once added
  };
  const listeners = new Set();
  const changed = () => listeners.forEach((fn) => fn(state));
  const fileOf = (id) => state.files.find((f) => f.id === id);

  // Pictures are asked for one at a time; one not there yet is asked for again later.
  let line = Promise.resolve();
  function loadPicture(file, attempt = 0) {
    file.pictureState = 'loading';
    changed();
    line = line.then(async () => {
      if (state.phase !== 'review') return;
      const picture = await calls.thumbnailLink(file.id).catch(() => null);
      if (picture) Object.assign(file, { picture, pictureState: 'ready' });
      else if (attempt < pictureRetries.length) setTimeout(() => loadPicture(file, attempt + 1), pictureRetries[attempt]);
      else file.pictureState = file.picture ? 'ready' : 'none';
      changed();
    });
    return line;
  }

  const inReview = (fn) => (...args) => { if (state.phase === 'review') fn(...args); };

  /** Add the ticked copies (with the names typed in); the others go to the trash. */
  async function addKept() {
    if (state.phase !== 'review') return state.result;
    state.phase = 'adding';
    changed();
    const keep = new Set(state.files.filter((f) => f.keep).map((f) => f.id));
    const names = new Map(state.files.map((f) => [f.id, f.title]));
    const kept = await keepCopies(calls, nodes, { keep, names });
    const result = keep.size ? add(kept.nodes) : { added: [], folders: [], skipped: [] };
    state.result = { ...result, failed: kept.failed };
    state.phase = 'done';
    changed();
    return state.result;
  }

  return {
    state,
    onChange: (fn) => { listeners.add(fn); return () => listeners.delete(fn); },
    loadPictures: () => Promise.all(state.files.map((f) => loadPicture(f))),
    /** Coming back from changing copies in Google: draw their pictures again. */
    refreshPictures: inReview(() => state.files.filter((f) => f.pictureState !== 'loading').forEach((f) => loadPicture(f))),
    reloadPicture: inReview((id) => { const f = fileOf(id); if (f && f.pictureState !== 'loading') loadPicture(f); }),
    setKeep: inReview((id, keep) => { const f = fileOf(id); if (f) { f.keep = keep; changed(); } }),
    setAll: inReview((keep) => { state.files.forEach((f) => { f.keep = keep; }); changed(); }),
    rename: inReview((id, title) => { const f = fileOf(id); if (f) { f.title = title; changed(); } }),
    addKept,
    /** Nothing is added: every copy made for this look goes to the trash. */
    throwAll: () => { if (state.phase !== 'review') return Promise.resolve(state.result); state.files.forEach((f) => { f.keep = false; }); return addKept(); },
  };
}
