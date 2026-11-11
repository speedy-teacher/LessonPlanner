// What the teacher does in the Template Maker window, start to finish, without the page itself
// (views/templateMaker.js draws it; the tests drive it):
//   checkSetup → (pick other folders) → addFiles → tick/untick, rename → makeAll → look at each template
//   (picture + "Open it"), untick any to throw away → addKept → added to the open plan.
// Files are read and made several at once (googleApi.js runPool + copyPace.js).
// Only the teacher's folder picks are kept in this browser — nothing else is stored.
//
// `plan` = { state(), yearId(), add(made) } — the open plan; `add` makes the change (one Undo step).
// Works with driveCalls (makerDrive.js) on the real Google Drive or the fake one in the tests.

import { problemText, runPool } from './googleApi.js';
import { dropFile, keepTemplate, makeTemplate, prepareFile, previewPicture, staleDrafts } from './maker.js';
import { describeSetup, findSetup, setupProblemText } from './setup.js';

const PICKS_KEY = 'lesson-planner-template-maker';

function store(storage) {
  return {
    get(key) { try { return JSON.parse(storage.getItem(key)) ?? null; } catch { return null; } },
    set(key, value) { try { storage.setItem(key, JSON.stringify(value)); } catch { /* private window */ } },
  };
}

/** `calls` = driveCalls, `pace` = copyPace(), `storage` = localStorage (or a stand-in), `plan` = the open plan. */
export function createSession({ calls, pace, storage, plan }) {
  const kept = store(storage);
  const state = { setup: { status: 'idle' }, files: [], phase: 'choose', save: { status: 'idle' } };
  const listeners = new Set();
  let uid = 0;
  const changed = () => listeners.forEach((fn) => fn(state));
  const fileOf = (id) => state.files.find((f) => f.uid === id);
  const patchFile = (file, patch) => { Object.assign(file, patch); changed(); };
  const setupNow = () => state.setup.chosen;
  const busy = () => ['making', 'adding'].includes(state.phase) || state.files.some((f) => f.status === 'reading');

  async function checkSetup() {
    state.setup = { status: 'checking' };
    changed();
    try {
      const found = await findSetup(calls, plan.state(), plan.yearId(), { pace });
      const chosen = describeSetup(found, kept.get(PICKS_KEY) ?? {});
      state.setup = chosen.problem ? { status: 'problem', found, message: setupProblemText(chosen.problem) } : { status: 'ready', found, chosen };
      tidyDrafts();
    } catch (err) {
      state.setup = { status: 'problem', message: problemText(err), error: err };
    }
    changed();
  }

  /** Pick another templates folder / pictures folder ('none' = no pictures). Only before files are added. */
  function choose(part, id) {
    if (state.setup.status !== 'ready' || state.files.length) return;
    const picks = { ...(kept.get(PICKS_KEY) ?? {}), [`${part}Id`]: id };
    kept.set(PICKS_KEY, picks);
    state.setup = { ...state.setup, chosen: describeSetup(state.setup.found, picks) };
    changed();
  }

  function tidyDrafts() {
    calls.listDrafts().then((drafts) => Promise.all(staleDrafts(drafts).map((d) => calls.trashFile(d.id)))).catch(() => {});
  }

  async function addFiles(picked) {
    const fresh = picked.filter((p) => !state.files.some((f) => f.source.id === p.id));
    const added = fresh.map((source) => ({ uid: (uid += 1), source, status: 'reading', step: 'Waiting…', prepared: null, made: null, error: null }));
    state.files.push(...added);
    changed();
    await runPool(added, async (file) => {
      try {
        const prepared = await prepareFile(calls, file.source, { setup: setupNow(), step: (step) => patchFile(file, { step }) });
        if (!state.files.includes(file)) { await dropFile(calls, prepared); return; } // taken out while reading
        patchFile(file, { status: 'ready', prepared, step: '' });
      } catch (err) {
        patchFile(file, { status: 'problem', error: problemFor(err), step: '' });
      }
    }, { pace });
  }

  async function removeFile(id) {
    const file = fileOf(id);
    if (!file || state.phase !== 'choose') return;
    state.files = state.files.filter((f) => f !== file);
    changed();
    await dropFile(calls, file.prepared).catch(() => {});
  }

  function edit(id, change) {
    const file = fileOf(id);
    if (file?.prepared && state.phase === 'choose') { change(file.prepared); changed(); }
  }

  async function makeAll() {
    const ready = state.files.filter((f) => f.status === 'ready');
    if (!ready.length || state.phase !== 'choose') return;
    state.phase = 'making';
    changed();
    const shared = { pictures: new Map() };
    await runPool(ready, async (file) => {
      patchFile(file, { status: 'making' });
      try {
        const made = await makeTemplate(calls, file.prepared, { setup: setupNow(), shared, step: (step) => patchFile(file, { step }) });
        patchFile(file, { status: 'made', made, keep: true, step: '' });
        previewPicture(calls, made).then((picture) => patchFile(file, { picture }));
      } catch (err) {
        patchFile(file, { status: 'failed', error: problemFor(err), step: '' });
      }
    }, { pace });
    state.phase = state.files.some((f) => f.status === 'made') ? 'review' : 'done';
    changed();
  }

  /** While looking: keep this template (add it to the planner) or not (thrown away). */
  function setKeep(id, keep) {
    const file = fileOf(id);
    if (file?.status === 'made' && state.phase === 'review') { file.keep = keep; changed(); }
  }

  /** Add the kept templates to the planner; the others (and pictures only they used) go to the trash. */
  async function addKept() {
    if (state.phase !== 'review') return;
    state.phase = 'adding';
    changed();
    const made = state.files.filter((f) => f.status === 'made');
    const kept = made.filter((f) => f.keep);
    const results = await runPool(kept, (f) => keepTemplate(calls, f.made), { pace });
    kept.forEach((f, i) => { if (!results[i].ok) Object.assign(f, { status: 'failed', error: problemFor(results[i].error) }); });
    const added = kept.filter((f) => f.status === 'made').map((f) => f.made);
    await throwAway(made.filter((f) => !f.keep).map((f) => f.made), added);
    if (added.length) save({ lessons: added.map((m) => m.lesson), images: added.flatMap((m) => m.images) });
    state.phase = 'done';
    changed();
  }

  /** Trash thrown-away templates, and pictures saved for them that no kept template uses. */
  async function throwAway(gone, kept) {
    const keptPictures = new Set(kept.flatMap((m) => m.images.map((i) => i.fileId)));
    const ids = [...new Set(gone.flatMap((m) => [m.lesson.fileId, ...m.images.map((i) => i.fileId).filter((id) => !keptPictures.has(id))]))];
    await runPool(ids, (id) => calls.trashFile(id), { pace });
  }

  function save(additions) {
    try {
      const added = plan.add(additions);
      state.save = { status: 'saved', count: additions.lessons.length, firstLessonId: added?.lessons?.[0]?.id ?? null };
    } catch {
      state.save = { status: 'failed', message: 'The templates were made in your Drive folder, but couldn’t be added to this plan. They will show up by themselves when the planner next looks in that folder.' };
    }
  }

  /** Throw away the files and start again (leftover drafts, and templates not added, go to the trash). */
  function startOver() {
    if (busy()) return;
    const dropped = state.phase === 'choose' ? state.files : [];
    const unkept = state.phase === 'review' ? state.files.filter((f) => f.status === 'made').map((f) => f.made) : [];
    state.files = [];
    state.phase = 'choose';
    state.save = { status: 'idle' };
    changed();
    dropped.forEach((f) => dropFile(calls, f.prepared).catch(() => {}));
    throwAway(unkept, []).catch(() => {});
  }

  return {
    state, checkSetup, choose, addFiles, removeFile, makeAll, setKeep, addKept, startOver, busy,
    onChange: (fn) => { listeners.add(fn); return () => listeners.delete(fn); },
    rename: (id, name) => edit(id, (p) => { p.name = name; }),
    tickMatch: (id, key, field) => edit(id, (p) => { p.choices.matches[key] = field; }),
    tickPicture: (id, key, on) => edit(id, (p) => { p.choices.pictures[key] = on; }),
  };
}

const problemFor = (err) => (err?.message === 'not_supported' ? 'This kind of file can’t be made into a template (only Slides, Docs, Sheets, PowerPoint, Word and Excel).' : problemText(err));
