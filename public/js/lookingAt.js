// "Looking at": showing other people's Lesson Schedule or Teacher Resources on a tab (rules in
// lensRules.js). Each tab remembers its own choice for this visit; a tab shows the pieces its choice
// needs, swapping them in when you go there (app.js shows "Loading…" until they are in place).
// Your own pieces are kept aside (and kept up to date) by the plan (pieceEngine.js) until you're back.

import { device, setDevice } from './deviceSettings.js';
import { google } from './google.js';
import { listSchedulesFor, listSharedResources, readPlanFile } from './driveFiles.js';
import { LENS, peopleFrom, sameView, wantedView } from './lensRules.js';
import { getPlan, putPlan } from './localCache.js';
import { showNotice } from './notices.js';
import { driveKey } from './pieceEngine.js';
import { fromPieceFile } from './pieces.js';
import { flushSave, store, useState } from './store.js';
import { pieces, showWhereSaved, syncNow } from './workspace.js';

const NOTHING = wantedView('plan');
let picks = {}; // pageId → the person chosen on that tab
let shown = NOTHING; // what the plan is showing now (a wantedView)
let forPlan = null; // the PiecePlan the choices belong to
let latest = 0; // the newest swap asked for; older ones that finish late are ignored
let inFlight = null; // { wanted, promise }

/** Choices belong to the open plan: another plan opening starts again with "Me" everywhere. */
function forgetIfNewPlan() {
  if (forPlan === pieces) return;
  forPlan = pieces;
  picks = {};
  shown = NOTHING;
  inFlight = null;
}

/** The person chosen on a tab (null = "Me"). */
export function pickedOn(pageId) {
  forgetIfNewPlan();
  return picks[pageId] ?? null;
}

/** Names chosen on each tab: { pageId: name }. */
export function allPicks() {
  forgetIfNewPlan();
  return Object.fromEntries(Object.entries(picks).map(([pageId, p]) => [pageId, p.name]));
}

/** True when going to this tab means different pieces have to be shown first. */
export function needsSwap(pageId) {
  forgetIfNewPlan();
  return Boolean(pieces) && !sameView(wantedView(pageId, picks), shown);
}

const driveReady = () => google.status === 'connected' && Boolean(google.token);

/**
 * People this tab can look at, from Google Drive (only files shared with you are ever found): schedule
 * tabs list Lesson Schedules for the open School Year, template tabs list Teacher Resources. Remembered
 * on this computer, so the list shows at once next time. Returns [{ fileId, name, ownerId }].
 */
export async function peopleFor(pageId) {
  forgetIfNewPlan();
  const lens = pieces ? LENS[pageId] : null;
  const remembered = lens && (lens === 'resources' ? 'resources' : pieces.link('schoolYear')?.fileId);
  if (!remembered) return [];
  if (driveReady()) setDevice({ teammates: { ...device.teammates, [remembered]: await findPeople(lens) } });
  return device.teammates?.[remembered] ?? [];
}

/** Ask Google Drive: shared Teacher Resources (any year) or Lesson Schedules using the open School Year. */
async function findPeople(lens) {
  const mine = (pieces.own ?? pieces.recs)[lens]?.fileId ?? null;
  const files = lens === 'resources'
    ? await listSharedResources(google.token)
    : await listSchedulesFor(google.token, pieces.link('schoolYear').fileId);
  return peopleFrom(files, { mineFileId: mine });
}

/**
 * Choose whose pieces a tab shows (null = "Me"). Shown at once when it's the open tab; another tab
 * shows them when you go there.
 */
export async function pick(pageId, person) {
  forgetIfNewPlan();
  if (person) picks[pageId] = person; else delete picks[pageId];
  return pageId === store.ui.tab ? follow(pageId) : false;
}

/**
 * Show the pieces this tab's choice needs (if they aren't shown already). Resolves to whether pieces
 * were swapped. Asking again while it's loading joins the same load.
 */
export function follow(pageId) {
  forgetIfNewPlan();
  const wanted = wantedView(pageId, picks);
  if (!pieces || sameView(wanted, shown)) return Promise.resolve(false);
  if (inFlight && sameView(inFlight.wanted, wanted)) return inFlight.promise;
  const promise = swapTo(wanted, pageId).finally(() => { if (inFlight?.promise === promise) inFlight = null; });
  inFlight = { wanted, promise };
  return promise;
}

async function swapTo(wanted, pageId) {
  const plan = pieces;
  latest += 1;
  const mine = latest;
  try {
    // Changes made so far are kept before the page's data is replaced.
    await flushSave();
    await plan.save(store.state);
    const records = await recordsFor(wanted);
    if (mine !== latest || plan !== pieces) return false;
    await plan.save(store.state);
    await plan.view(records, whoIs(wanted));
  } catch (err) {
    console.error(err);
    delete picks[pageId];
    showNotice({ id: 'looking-at', tone: 'warn', title: 'Couldn’t open their plans', message: 'Their file could not be read from Google Drive. You’re back at your own.' });
    return false;
  }
  shown = wanted;
  useState(plan.state());
  showWhereSaved();
  syncNow();
  return true;
}

function whoIs(wanted) {
  const some = (p) => (p && p !== 'linked' ? { name: p.name, fileId: p.fileId } : undefined);
  return { schedule: some(wanted.schedule), resources: some(wanted.resources) };
}

/** What PiecePlan.view takes: this computer's copy of a file, else read from Drive. */
async function recordsFor(wanted) {
  const schedule = wanted.schedule ? await recordOf(wanted.schedule.fileId, 'schedule') : null;
  if (wanted.resources === 'linked' || !wanted.resources) return { schedule, resources: wanted.resources };
  const resources = await recordOf(wanted.resources.fileId, 'resources').catch(() => ({ key: driveKey(wanted.resources.fileId), fileId: wanted.resources.fileId }));
  return { schedule, resources };
}

async function recordOf(fileId, piece) {
  const cached = await getPlan(driveKey(fileId)).catch(() => null);
  if (cached) return cached;
  const file = await readPlanFile(google.token, fileId);
  const rec = {
    key: driveKey(fileId), piece, name: file.name, fileId, folderId: file.folderId, rev: file.rev, base: file.text,
    canEdit: file.canEdit, changed: false, keptDay: null, savedAt: 0, data: fromPieceFile(file.text, piece),
  };
  await putPlan(rec);
  return rec;
}
