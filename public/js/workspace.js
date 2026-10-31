// The open plan (one school year) and where it's kept: always on this computer
// (localCache.js), and in Google Drive when it's a Drive plan (driveFiles.js).
//
// Every change is saved on this computer first, then sent to Drive a moment
// later. Before sending, the planner checks whether the Drive file was changed
// somewhere else, so one computer never quietly overwrites another's work:
// when both changed, the two are combined (planMerge.js), and only things both
// changed differently are put to the teacher.

import { newId } from './model.js';
import { commit, flushSave, refresh, setGuard, setPersist, setSaveStatus, store, useState } from './store.js';
import { device, setDevice } from './deviceSettings.js';
import { google } from './google.js';
import { allPlans, deletePlan, getPlan, putPlan, rescue } from './localCache.js';
import {
  createPlanFile, folderName, keepRevision, movePlanFile, PIECE_PROPERTY, planFileInfo, readPlanFile, savePlanFile, SCHOOL_YEAR_PROPERTY,
} from './driveFiles.js';
import { driveKey, MISSING_WORDS, PiecePlan, rebaseState } from './pieceEngine.js';
import { PIECES, pieceFileName, pieceKind, splitState, toPieceFile } from './pieces.js';
import {
  forgetPlan, fromWorkspaceFile, rememberPlan, shouldKeepRevision, splitYears, syncAction, toWorkspaceFile,
} from './workspaceFile.js';
import { conflictSummary, mergePlans, useTheirs } from './planMerge.js';
import { showNotice } from './notices.js';

const UPLOAD_DELAY_MS = 2000;

/**
 * The open plan: { key, name, fileId, folderId, rev, base, changed, keptDay, canEdit, savedAt, state }.
 * `base` = the plan file's text at revision `rev` (what this computer last saved or loaded), so
 * changes made here and on another computer can be told apart and combined.
 */
export let current = null;

/**
 * The open plan's pieces (pieceEngine.js) when it's made of School Year + Teacher Schedule + Teacher
 * Resources files; null for an older one-file plan. `current` then describes the Teacher Schedule.
 */
export let pieces = null;

let uploadTimer = null;
let saves = 0; // counts saves, to tell whether more changes came in while sending to Drive
let syncing = false;
let syncAgain = false;

setPersist({
  save: async (state) => {
    if (!current) return;
    if (pieces) return savePieces(state);
    saves += 1;
    current = { ...current, state, changed: Boolean(current.fileId), savedAt: Date.now() };
    await putPlan(current);
    showWhereSaved();
    queueUpload();
  },
  closing: (state) => {
    if (pieces) rescue({ key: rescueKey(current.key), state, savedAt: Date.now() });
    else if (current) rescue({ ...current, state, changed: Boolean(current.fileId), savedAt: Date.now() });
  },
});

// Changes to pieces you can only look at are taken back out at once (see pieces.js keepViewOnly).
setGuard(
  (before, after) => (pieces?.readOnly().length ? pieces.guard(before(), after) : { state: after, blocked: [] }),
  (blocked) => showNotice({
    id: 'view-only', tone: 'warn', title: 'View only',
    message: `You can look at the ${blocked.map((name) => PIECES[name].label).join(' and ')} but not change it. ${blocked.map(whyViewOnly).join(' ')}`,
  }),
);
const isDrivePlan = () => Boolean(current?.fileId);
const driveReady = () => google.status === 'connected' && google.token;

// ---------- opening ----------

/** Open the plan used last time on this computer. Returns false if there isn't one. */
export async function openLastPlan() {
  const record = device.lastKey ? await getPlan(device.lastKey).catch(() => null) : null;
  if (!record) return false;
  await showAny(record);
  return true;
}

/** An older one-file plan, or a Teacher Schedule (with its pieces). */
function showAny(record) {
  return record.piece === 'schedule' ? openPieces(record) : show(record);
}

function show(record, { sameDocument = false } = {}) {
  pieces = null;
  current = record;
  setDevice({ lastKey: record.key, recent: rememberPlan(device.recent, entryFor(record)) });
  useState(record.state, { sameDocument });
  showWhereSaved();
}

function entryFor(record) {
  return { key: record.key, name: record.name, fileId: record.fileId ?? null };
}

/** Open a plan from Google Drive (this computer's copy shows straight away, then any newer changes are fetched). */
export async function openDrivePlan(fileId) {
  const cached = await getPlan(driveKey(fileId)).catch(() => null);
  if (cached) {
    await showAny(cached);
    return syncNow();
  }
  const file = await readPlanFile(google.token, fileId);
  const kind = pieceKind(JSON.parse(file.text));
  if (kind && kind !== 'schedule') throw new Error('not_a_schedule');
  const record = { key: driveKey(fileId), name: file.name, fileId, folderId: file.folderId, rev: file.rev, base: file.text, canEdit: file.canEdit, changed: false, keptDay: null };
  if (kind) {
    const scheduleRec = { ...record, piece: 'schedule', savedAt: 0, data: JSON.parse(file.text) };
    await putPlan(scheduleRec);
    return openPieces(scheduleRec);
  }
  const plan = { ...record, state: fromWorkspaceFile(file.text) };
  await putPlan(plan);
  return show(plan);
}

/** Open a plan kept on this computer (by its key). */
export async function openSavedPlan(key) {
  const record = await getPlan(key);
  if (record) await showAny(record);
}

/**
 * Make a new plan: in Google Drive when connected (in `folderId`, or else the "Lesson Planner" folder),
 * otherwise on this computer only. Opens it unless `open` is false. Returns its record.
 */
export async function createPlan({ name, state }, { open = true, folderId = null } = {}) {
  let record = { key: `computer:${newId('plan')}`, name, fileId: null, folderId: null, rev: null, canEdit: true, changed: false, keptDay: null, state };
  if (driveReady()) {
    const text = toWorkspaceFile(state);
    const file = await createPlanFile(google.token, { name, text, folderId });
    record = { ...record, key: driveKey(file.fileId), fileId: file.fileId, folderId: file.folderId, rev: file.rev, base: text };
  }
  await putPlan(record);
  if (open) show(record);
  else setDevice({ recent: rememberPlan(device.recent, entryFor(record)) });
  return record;
}

/**
 * Bring in planner data (a downloaded plan, or an older planner file holding several years):
 * each year becomes its own plan. Opens the year that was open in it. Returns the new plans.
 */
export async function importPlannerData(state, { folderId = null } = {}) {
  const made = [];
  for (const plan of splitYears(state)) {
    made.push(await createPlan(plan, { open: false, folderId }));
  }
  const active = made[state.years.findIndex((y) => y.id === state.activeYearId)] ?? made.at(-1);
  if (active) show(active);
  return made;
}

/** Every plan this computer has a copy of. */
export function allCachedPlans() {
  return allPlans().catch(() => []);
}

/** Plans kept only on this computer (not in Google Drive). */
export async function computerPlans() {
  return (await allCachedPlans()).filter((p) => !p.fileId);
}

export async function removeComputerPlan(key) {
  await deletePlan(key);
  setDevice({ recent: forgetPlan(device.recent, key), lastKey: device.lastKey === key ? null : device.lastKey });
}

/** Copy a plan that's only on this computer into Google Drive (it becomes a Drive plan). */
export async function moveToDrive({ folderId = null } = {}) {
  const old = current;
  const text = toWorkspaceFile(store.state);
  const file = await createPlanFile(google.token, { name: old.name, text, folderId });
  const record = { ...old, key: driveKey(file.fileId), fileId: file.fileId, folderId: file.folderId, rev: file.rev, base: text, changed: false, state: store.state };
  await putPlan(record);
  await deletePlan(old.key);
  setDevice({ recent: forgetPlan(device.recent, old.key) });
  show(record, { sameDocument: true });
}

/** The name of the Drive folder the open plan is in (null if it isn't in Drive). */
export async function planFolderName() {
  if (!current?.fileId || !driveReady()) return null;
  let folderId = current.folderId;
  if (!folderId) {
    folderId = (await planFileInfo(google.token, current.fileId)).folderId;
    current = { ...current, folderId };
  }
  return folderId ? folderName(google.token, folderId) : null;
}

/** Move the open plan's Drive file into another folder. */
export async function moveCurrentPlan(folderId) {
  const moved = await movePlanFile(google.token, current.fileId, folderId);
  current = { ...current, folderId: moved };
  await putPlan(current);
}

/** Save this plan as a file on this computer. */
export function downloadCopy() {
  const blob = new Blob([toWorkspaceFile(store.state)], { type: 'application/json' });
  const link = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: `${current?.name || 'Music Plans'}.json` });
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
}

/** The data kept by the older planner that ran on this computer, if it's here. */
export async function oldPlannerData() {
  try {
    const res = await fetch('api/state');
    const body = res.ok ? await res.json() : null;
    return body?.state?.years?.length ? body.state : null;
  } catch {
    return null;
  }
}

// ---------- keeping Google Drive up to date ----------

function queueUpload() {
  clearTimeout(uploadTimer);
  if (isDrivePlan()) uploadTimer = setTimeout(syncNow, UPLOAD_DELAY_MS);
}

/** Compare this computer's copy with Google Drive, and save or load whichever is newer. */
export async function syncNow() {
  if (!isDrivePlan() || !driveReady()) return showWhereSaved();
  if (syncing) { syncAgain = true; return undefined; }
  syncing = true;
  try {
    await (pieces ? syncPieces() : syncOnce());
  } catch (err) {
    syncProblem(err);
  } finally {
    syncing = false;
  }
  if (syncAgain) { syncAgain = false; return syncNow(); }
  return undefined;
}

async function syncOnce() {
  const info = await planFileInfo(google.token, current.fileId);
  current = { ...current, canEdit: info.canEdit, name: info.name, folderId: info.folderId };
  const action = syncAction({ localChanges: current.changed && info.canEdit, knownRev: current.rev, remoteRev: info.rev });
  if (action === 'upload') await upload();
  if (action === 'download') await download('Loaded the newest version of this plan from Google Drive (it was changed on another computer).');
  if (action === 'conflict') await combineWithDrive();
  showWhereSaved();
}

async function upload() {
  setSaveStatus('saving', 'Saving to Google Drive…');
  const sentAt = saves;
  const text = toWorkspaceFile(current.state);
  const rev = await savePlanFile(google.token, current.fileId, text);
  current = { ...current, rev, base: text, changed: saves !== sentAt };
  if (rev && shouldKeepRevision(current.keptDay)) {
    await keepRevision(google.token, current.fileId, rev).then(() => { current.keptDay = new Date().toISOString().slice(0, 10); }, () => {});
  }
  await putPlan(current);
}

async function download(message) {
  const file = await readPlanFile(google.token, current.fileId);
  const record = { ...current, name: file.name, rev: file.rev, base: file.text, canEdit: file.canEdit, changed: false, state: fromWorkspaceFile(file.text) };
  await putPlan(record);
  show(record);
  if (message) showNotice({ id: 'plan-sync', tone: 'info', title: 'Google Drive', message });
}

/**
 * Both this computer and Drive have changes: combine them and save the result. Things both changed
 * differently keep this computer's version, and the teacher can switch them with one click.
 * (Copies saved before the planner remembered `base` can't be combined, so they still ask.)
 */
async function combineWithDrive() {
  if (!current.base) return askWhichToKeep();
  const file = await readPlanFile(google.token, current.fileId);
  const theirs = fromWorkspaceFile(file.text);
  const { state, conflicts } = mergePlans(fromWorkspaceFile(current.base), store.state, theirs);
  saves += 1;
  current = { ...current, name: file.name, rev: file.rev, base: file.text, canEdit: file.canEdit, changed: true, state };
  await putPlan(current);
  show(current);
  await upload();
  return tellCombined(conflicts, theirs);
}

function tellCombined(conflicts, theirs) {
  if (!conflicts.length) {
    return showNotice({ id: 'plan-sync', tone: 'info', title: 'Google Drive', message: 'Combined your changes with newer changes from Google Drive.' });
  }
  return showNotice({
    id: 'plan-sync', tone: 'warn', title: 'The same thing was changed by two people',
    message: `Everything else was combined. For these, your version was kept: ${conflictSummary(store.state, theirs, conflicts)}.`,
    seconds: null,
    actions: [
      { label: 'Keep mine', run: () => {} },
      { label: 'Use the other version', run: () => commit((s) => useTheirs(s, conflicts, theirs)) },
    ],
  });
}

function askWhichToKeep() {
  showNotice({
    id: 'plan-sync', tone: 'warn', title: 'This plan was changed elsewhere',
    message: 'Both this device and Google Drive have changes. Which should the plan keep?',
    seconds: null,
    actions: [
      { label: 'Keep mine', run: () => keepMine() },
      { label: 'Use the Drive version', run: () => useDriveVersion() },
    ],
  });
}

async function keepMine() {
  const info = await planFileInfo(google.token, current.fileId);
  current = { ...current, rev: info.rev };
  await syncNow();
}

/** Load the Drive version, keeping this computer's changes as a separate plan (so nothing is lost). */
async function useDriveVersion() {
  const mine = current;
  await putPlan({ ...mine, key: `computer:${newId('plan')}`, name: `${mine.name} (my changes)`, fileId: null, rev: null, base: null, changed: false });
  await download('Loaded the Drive version. Your changes are kept as a separate plan, “(my changes)”, under the plan menu.');
}

function syncProblem(err) {
  if (err.message === 'no_access') {
    current = { ...current, canEdit: false };
    showNotice({ id: 'plan-sync', tone: 'warn', title: 'Google Drive', message: 'The planner isn’t allowed to save this shared plan yet. Open it once with “Open a plan shared with me” in the plan menu, then your changes save.' });
  } else if (err.message === 'not_found') {
    showNotice({ id: 'plan-sync', tone: 'warn', title: 'Google Drive', message: 'This plan’s file is gone from Google Drive (deleted, or no longer shared). Your copy is still on this computer — use “Download a copy” to keep it.', seconds: null });
  }
  showWhereSaved(err.message === 'offline' || err.message === 'signed_out' ? 'waiting' : 'problem');
}

/** The words next to undo/redo: where the latest changes are. */
export function showWhereSaved(trouble = null) {
  if (!current) return;
  refresh();
  if (!isDrivePlan()) return setSaveStatus('local', 'Saved on this computer');
  if (pieces) return showWherePiecesSaved(trouble);
  if (!current.canEdit) return setSaveStatus('local', 'View only — changes stay on this computer');
  if (!current.changed) return setSaveStatus('saved', 'Saved to Google Drive');
  if (trouble === 'problem') return setSaveStatus('error', 'Couldn’t save to Drive — saved on this computer');
  return setSaveStatus('local', driveReady() ? 'Saving to Google Drive…' : 'Saved on this computer — will save to Drive when connected');
}

// Look for changes from other computers whenever you come back to the planner — and every few minutes
// while it's open, so they arrive (and the lesson copies follow them) even in a window nobody clicks.
const CHECK_EVERY_MS = 5 * 60 * 1000;
window.addEventListener('focus', () => { if (isDrivePlan()) syncNow(); });
setInterval(() => { if (isDrivePlan()) syncNow(); }, CHECK_EVERY_MS);
window.addEventListener('online', () => { if (isDrivePlan()) syncNow(); });

// ---------- plans made of pieces (School Year + Teacher Schedule + Teacher Resources) ----------

const rescueKey = (key) => `rescue:${key}`;
const cacheCalls = { get: getPlan, put: putPlan };
let saveAfterSync = false;

function driveCalls() {
  return {
    info: (id) => planFileInfo(google.token, id),
    read: (id) => readPlanFile(google.token, id),
    save: (id, text) => savePlanFile(google.token, id, text),
    keep: (id, rev) => keepRevision(google.token, id, rev),
  };
}

/** What `current` says about a plan made of pieces: its Teacher Schedule's details. */
function scheduleInfo() {
  const rec = pieces.recs.schedule;
  return {
    kind: 'pieces', key: rec.key, name: rec.name, fileId: rec.fileId ?? null, folderId: rec.folderId ?? null,
    canEdit: rec.canEdit !== false, changed: pieces.unsaved().length > 0, savedAt: rec.savedAt,
  };
}

/** Open a Teacher Schedule with its School Year and Teacher Resources (this computer's copies first, then Drive). */
async function openPieces(scheduleRec, { sameDocument = false } = {}) {
  const plan = new PiecePlan({ drive: scheduleRec.fileId ? driveCalls() : null, cache: cacheCalls });
  await plan.load(scheduleRec);
  pieces = plan;
  current = scheduleInfo();
  setDevice({ lastKey: current.key, recent: rememberPlan(device.recent, entryFor(current)) });
  useState(plan.state(), { sameDocument });
  await takeRescued(scheduleRec);
  showWhereSaved();
  if (isDrivePlan()) syncNow();
}

/** Changes kept while the page was closing (newer than every piece) are saved now. */
async function takeRescued(scheduleRec) {
  const rescued = await getPlan(rescueKey(scheduleRec.key)).catch(() => null);
  const newest = Math.max(...Object.values(pieces.recs).map((r) => r?.savedAt || 0));
  if (!rescued?.state || (rescued.savedAt || 0) <= newest) return;
  await pieces.save(rescued.state);
  useState(pieces.state(), { sameDocument: true });
}

async function savePieces(state) {
  if (syncing) { saveAfterSync = true; return; }
  await pieces.save(state);
  current = scheduleInfo();
  showWhereSaved();
  queueUpload();
}

/**
 * Bring every piece up to date with Drive. Anything changed on the page meanwhile is put on top of
 * what was loaded (rebaseState), so neither side's work is lost.
 */
async function syncPieces() {
  await flushSave();
  const startText = JSON.stringify(store.state);
  const results = await pieces.syncAll();
  const loaded = results.some((r) => r.action === 'download' || r.action === 'conflict');
  const editedMeanwhile = JSON.stringify(store.state) !== startText;
  if (editedMeanwhile) useState(rebaseState(JSON.parse(startText), store.state, pieces.datas()), { sameDocument: true });
  else if (loaded) useState(pieces.state());
  if (editedMeanwhile || saveAfterSync) {
    saveAfterSync = false;
    await pieces.save(store.state);
    syncAgain = true;
  }
  current = scheduleInfo();
  for (const r of results) if (r.conflicts?.length) tellCombined(r.conflicts, r.theirs);
  tellPieceTrouble(results);
}

function tellPieceTrouble(results) {
  const lost = results.filter((r) => r.error && r.error !== 'offline' && r.error !== 'signed_out');
  if (!lost.length) return;
  showNotice({
    id: 'piece-trouble', tone: 'warn', title: 'Part of this plan can’t be loaded',
    message: lost.map((r) => `${PIECES[r.name].label}: ${MISSING_WORDS[r.error] ?? 'Google Drive had a problem.'}`).join(' '),
  });
}

function whyViewOnly(name) {
  if (pieces?.access(name) === 'none') return `${PIECES[name].label}: ${MISSING_WORDS[pieces.missing[name]] ?? ''}`;
  return `Whoever shared the ${PIECES[name].label} can make you an Editor in Google Drive.`;
}

function showWherePiecesSaved(trouble) {
  if (trouble === 'problem') return setSaveStatus('error', 'Couldn’t save to Drive — saved on this computer');
  if (!pieces.unsaved().length) return setSaveStatus('saved', 'Saved to Google Drive');
  return setSaveStatus('local', driveReady() ? 'Saving to Google Drive…' : 'Saved on this computer — will save to Drive when connected');
}

/** A new piece file: in Google Drive when connected (labelled so it can be found again), else on this computer. */
async function newPieceRecord(name, data, { fileName, folderId, schoolYearFileId = null }) {
  const base = { piece: name, name: fileName, fileId: null, folderId: null, rev: null, base: null, canEdit: true, changed: false, keptDay: null, savedAt: Date.now(), data };
  if (!driveReady()) return { ...base, key: `computer:${newId('piece')}` };
  const text = toPieceFile(data);
  const properties = { [PIECE_PROPERTY(name).key]: name, ...(schoolYearFileId ? { [SCHOOL_YEAR_PROPERTY]: schoolYearFileId } : {}) };
  const file = await createPlanFile(google.token, { name: fileName, text, folderId, properties });
  return { ...base, key: driveKey(file.fileId), fileId: file.fileId, folderId: file.folderId, rev: file.rev, base: text };
}

const linkTo = (rec) => ({ key: rec.key, fileId: rec.fileId, name: rec.name });

/**
 * Make a plan as three piece files (School Year, Teacher Resources, Teacher Schedule) from one year's
 * data, in Drive when connected (in `folderId`, or the "Lesson Planner" folder), else on this computer.
 * Opens it unless `open` is false. Returns the Teacher Schedule's record.
 */
export async function createPiecePlan(state, { open = true, folderId = null } = {}) {
  const year = state.years.find((y) => y.id === state.activeYearId) ?? state.years[0];
  const split = splitState(state);
  const made = {};
  for (const name of ['schoolYear', 'resources']) {
    made[name] = await newPieceRecord(name, split[name], { fileName: pieceFileName(name, year), folderId });
    await putPlan(made[name]);
  }
  split.schedule.meta = { ...split.schedule.meta, links: { schoolYear: linkTo(made.schoolYear), resources: linkTo(made.resources) }, ownerId: google.userId || null };
  const schedule = await newPieceRecord('schedule', split.schedule, {
    fileName: pieceFileName('schedule', year), folderId: made.schoolYear.folderId ?? folderId, schoolYearFileId: made.schoolYear.fileId,
  });
  await putPlan(schedule);
  if (open) await openPieces(schedule);
  else setDevice({ recent: rememberPlan(device.recent, entryFor(schedule)) });
  return schedule;
}
