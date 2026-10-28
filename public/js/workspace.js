// The open plan (one school year) and where it's kept: always on this computer
// (localCache.js), and in Google Drive when it's a Drive plan (driveFiles.js).
//
// Every change is saved on this computer first, then sent to Drive a moment
// later. Before sending, the planner checks whether the Drive file was changed
// somewhere else, so one computer never quietly overwrites another's work.

import { newId } from './model.js';
import { refresh, setPersist, setSaveStatus, store, useState } from './store.js';
import { device, setDevice } from './deviceSettings.js';
import { google } from './google.js';
import { allPlans, deletePlan, getPlan, putPlan, rescue } from './localCache.js';
import { createPlanFile, keepRevision, planFileInfo, readPlanFile, savePlanFile } from './driveFiles.js';
import {
  deviceSettingsIn, forgetPlan, fromWorkspaceFile, rememberPlan, shouldKeepRevision, splitYears, syncAction, toWorkspaceFile,
} from './workspaceFile.js';
import { showNotice } from './notices.js';

const UPLOAD_DELAY_MS = 2000;

/** The open plan: { key, name, fileId, rev, changed, keptDay, canEdit, savedAt, state }. */
export let current = null;

let uploadTimer = null;
let saves = 0; // counts saves, to tell whether more changes came in while sending to Drive
let syncing = false;
let syncAgain = false;

setPersist({
  save: async (state) => {
    if (!current) return;
    saves += 1;
    current = { ...current, state, changed: Boolean(current.fileId), savedAt: Date.now() };
    await putPlan(current);
    showWhereSaved();
    queueUpload();
  },
  closing: (state) => { if (current) rescue({ ...current, state, changed: Boolean(current.fileId), savedAt: Date.now() }); },
});

const driveKey = (fileId) => `drive:${fileId}`;
const isDrivePlan = () => Boolean(current?.fileId);
const driveReady = () => google.status === 'connected' && google.token;

// ---------- opening ----------

/** Open the plan used last time on this computer. Returns false if there isn't one. */
export async function openLastPlan() {
  const record = device.lastKey ? await getPlan(device.lastKey).catch(() => null) : null;
  if (!record) return false;
  show(record);
  return true;
}

function show(record, { sameDocument = false } = {}) {
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
    show(cached);
    return syncNow();
  }
  const file = await readPlanFile(google.token, fileId);
  const record = { key: driveKey(fileId), name: file.name, fileId, rev: file.rev, canEdit: file.canEdit, changed: false, keptDay: null, state: fromWorkspaceFile(file.text) };
  await putPlan(record);
  return show(record);
}

/** Open a plan kept on this computer (by its key). */
export async function openSavedPlan(key) {
  const record = await getPlan(key);
  if (record) show(record);
}

/**
 * Make a new plan: in Google Drive when connected, otherwise on this computer only.
 * Opens it unless `open` is false. Returns its record.
 */
export async function createPlan({ name, state }, { open = true } = {}) {
  let record = { key: `computer:${newId('plan')}`, name, fileId: null, rev: null, canEdit: true, changed: false, keptDay: null, state };
  if (driveReady()) {
    const file = await createPlanFile(google.token, { name, text: toWorkspaceFile(state) });
    record = { ...record, key: driveKey(file.fileId), fileId: file.fileId, rev: file.rev };
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
export async function importPlannerData(state) {
  const codes = deviceSettingsIn(state);
  setDevice(Object.fromEntries(Object.entries(codes).filter(([key]) => !device[key])));
  const made = [];
  for (const plan of splitYears(state)) {
    made.push(await createPlan(plan, { open: false }));
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
export async function moveToDrive() {
  const old = current;
  const file = await createPlanFile(google.token, { name: old.name, text: toWorkspaceFile(store.state) });
  const record = { ...old, key: driveKey(file.fileId), fileId: file.fileId, rev: file.rev, changed: false, state: store.state };
  await putPlan(record);
  await deletePlan(old.key);
  setDevice({ recent: forgetPlan(device.recent, old.key) });
  show(record, { sameDocument: true });
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
    await syncOnce();
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
  current = { ...current, canEdit: info.canEdit, name: info.name };
  const action = syncAction({ localChanges: current.changed && info.canEdit, knownRev: current.rev, remoteRev: info.rev });
  if (action === 'upload') await upload();
  if (action === 'download') await download('Loaded the newest version of this plan from Google Drive (it was changed on another computer).');
  if (action === 'conflict') askWhichToKeep();
  showWhereSaved();
}

async function upload() {
  setSaveStatus('saving', 'Saving to Google Drive…');
  const sentAt = saves;
  const rev = await savePlanFile(google.token, current.fileId, toWorkspaceFile(current.state));
  current = { ...current, rev, changed: saves !== sentAt };
  if (rev && shouldKeepRevision(current.keptDay)) {
    await keepRevision(google.token, current.fileId, rev).then(() => { current.keptDay = new Date().toISOString().slice(0, 10); }, () => {});
  }
  await putPlan(current);
}

async function download(message) {
  const file = await readPlanFile(google.token, current.fileId);
  const record = { ...current, name: file.name, rev: file.rev, canEdit: file.canEdit, changed: false, state: fromWorkspaceFile(file.text) };
  await putPlan(record);
  show(record);
  if (message) showNotice({ id: 'plan-sync', tone: 'info', title: 'Google Drive', message });
}

function askWhichToKeep() {
  showNotice({
    id: 'plan-sync', tone: 'warn', title: 'This plan was changed on another computer',
    message: 'Both this computer and Google Drive have changes. Which should the plan keep?',
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
  await putPlan({ ...mine, key: `computer:${newId('plan')}`, name: `${mine.name} (my changes)`, fileId: null, rev: null, changed: false });
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
  if (!current.canEdit) return setSaveStatus('local', 'View only — changes stay on this computer');
  if (!current.changed) return setSaveStatus('saved', 'Saved to Google Drive');
  if (trouble === 'problem') return setSaveStatus('error', 'Couldn’t save to Drive — saved on this computer');
  return setSaveStatus('local', driveReady() ? 'Saving to Google Drive…' : 'Saved on this computer — will save to Drive when connected');
}

// Look for changes from other computers whenever you come back to the planner.
window.addEventListener('focus', () => { if (isDrivePlan()) syncNow(); });
window.addEventListener('online', () => { if (isDrivePlan()) syncNow(); });
