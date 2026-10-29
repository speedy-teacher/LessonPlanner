// The export bridge: keeps the year's lesson copies (exportPlan.js) matching the Lesson Schedule,
// in the background. After any change it compares what the schedule wants with the copies that are
// really in the output folder, and works through the differences one at a time — so it doesn't matter
// who changed the schedule, on which computer, or how long ago. Progress shows bottom-right.
//
// A shared plan's copies are kept by one person: whoever chose the output folder (its "keeper").
// Everyone else's changes reach the copies the next time the keeper opens the planner; until then
// they're told the copies are behind, and who to ask.

import { h } from './dom.js';
import { activeYear, find } from './model.js';
import { refresh, store, subscribe } from './store.js';
import { google } from './google.js';
import { current as plan } from './workspace.js';
import { canFillIn, driveFileId, driveOpenUrl, findLocation, googleTypeFor } from './locations.js';
import { groupCopies, keysToDo, nextStep, SETTLE_MS, sparesFor, updateTime, wantedCopies } from './exportPlan.js';
import { SLIDES } from './exportGoogle.js';
import { isShared, markShareRefused } from './imageSharing.js';
import { downloadTemplate, driveCopies } from './exportDrive.js';
import { folderPermission, localCopies, rememberedFolder } from './exportLocal.js';
import { dismissNotice, showNotice } from './notices.js';

const WAIT_MS = 1500; // after a sign-in or a new folder; after your own changes it's a minute (SETTLE_MS)
const RECHECK_MS = 10 * 60 * 1000;
const MAX_TRIES = 4; // steps for one entry in a row before giving up on it for now
const STOPPERS = ['signed_out', 'offline'];

export const folderKey = (yearId) => `copies:${yearId}`;

const bridge = {
  status: { state: 'none' }, // see copyStatus()
  statusFor: 'null', // the output folder the status is about
  target: null, // { id, adapter, keeps, … } for the open year's output folder
  haves: [], // copies found in it
  queue: new Set(), // schedule entry ids with something to do, in order
  running: false,
  doing: '', // what the bridge is doing right now (for the panel)
  failed: new Map(), // entry id → signature it failed with (not retried until something changes)
  version: 0, // counts changes, so wanted copies are only worked out again when needed
  wants: null, // { version, targetId, map }
};
let timer = null;
let tick = null; // redraws the countdown while waiting
let skipWaitAt = 0; // "Update now" was clicked at this time: changes before it don't need to settle

/** When your last change was (0 = none still settling). */
function lastEdit() {
  return store.editedAt > skipWaitAt ? store.editedAt : 0;
}

const settling = () => Date.now() < lastEdit() + SETTLE_MS;

/**
 * What's happening with the open year's copies:
 * 'none' (no output folder) · 'ready' · 'waiting' (for Google Drive) · 'view-only' · 'needs-permission'
 * (the computer folder must be allowed again) · 'other-computer' · 'other-keeper' ({ keeperName, behind }).
 */
export function copyStatus() {
  const output = (store.state && activeYear(store.state)?.output) ?? null;
  if (!output) return { state: 'none' };
  // A folder just chosen (or another year): say so until it's been looked at.
  return bridge.statusFor === JSON.stringify(output) ? bridge.status : { state: 'checking' };
}

/** Start watching for changes (once, when the planner opens). */
export function startExportBridge() {
  let seenState = null;
  let seenEdit = 0;
  subscribe(() => {
    // Only data changes matter (not switching tabs and the like).
    if (store.state === seenState && store.editedAt === seenEdit) return;
    seenState = store.state;
    seenEdit = store.editedAt;
    bridge.version += 1;
    soon();
  });
  setInterval(() => { bridge.target = null; soon(); }, RECHECK_MS);
  soon();
}

/**
 * Look again soon: a moment from now, but not until a minute after your last change (so a burst of
 * changes is handled once, and nothing is updated while you're still moving things around).
 */
export function soon() {
  clearTimeout(timer);
  const now = Date.now();
  timer = setTimeout(() => look().catch((err) => console.warn('Lesson copies:', err)), updateTime({ now, lastEdit: lastEdit(), delay: WAIT_MS }) - now);
  showWaiting();
}

/** "Update now" in the panel: don't wait for changes to settle. */
function updateNow() {
  skipWaitAt = Date.now();
  soon();
}

/** Look again from scratch, right away (e.g. after a different output folder was chosen). */
export function recheckCopies() {
  bridge.target = null;
  skipWaitAt = Date.now(); // choosing a folder isn't a change that needs to settle
  soon();
}

// ---------- the output folder ----------

function setStatus(status) {
  const before = JSON.stringify([bridge.status, bridge.statusFor]);
  bridge.status = status;
  bridge.statusFor = JSON.stringify((store.state && activeYear(store.state)?.output) ?? null);
  if (JSON.stringify([status, bridge.statusFor]) !== before) refresh();
}

/** Who may change the copies, and what's stopping this computer from doing it (null = nothing). */
function blocker(output) {
  if (!output) return { state: 'none' };
  if (!plan || plan.canEdit === false) return { state: 'view-only' };
  if (google.status !== 'connected' || !google.token) return { state: 'waiting' };
  return otherKeeper(output);
}

/** A Drive folder chosen by someone else: they keep the copies. */
function otherKeeper(output) {
  const someoneElse = output.kind === 'drive' && output.keeperId && google.userId && output.keeperId !== google.userId;
  return someoneElse ? { state: 'other-keeper', keeperName: output.keeperName || 'the person who chose the folder' } : null;
}

async function makeTarget(year, output) {
  const id = JSON.stringify([plan.key, plan.name, year.id, output, google.userId, google.token]);
  if (bridge.target?.id === id) return bridge.target;
  const target = output.kind === 'drive'
    ? driveTarget(year, output)
    : await localTarget(year);
  if (!target.adapter) return target;
  target.id = id;
  bridge.haves = await target.adapter.list();
  bridge.target = target;
  bridge.wants = null;
  return target;
}

function driveTarget(year, output) {
  return {
    rootKey: `drive:${output.folderId}`, keeps: true, yearId: year.id,
    adapter: driveCopies({ token: google.token, rootId: output.folderId, yearId: year.id }),
    templateOf: driveFileId, canFill: canFillIn, sharing: isShared,
    // Pictures go into Google Slides copies (on the template's IMAGE_ANCHOR spots).
    canPicture: (lesson) => googleTypeFor(findLocation(lesson, 'drive')?.mimeType) === SLIDES,
  };
}

async function localTarget(year) {
  const dir = await rememberedFolder(folderKey(year.id));
  if (!dir) return { blocked: { state: 'other-computer', keeperName: year.output.keeperName || '' } };
  if (await folderPermission(dir) !== 'granted') return { blocked: { state: 'needs-permission' } };
  const token = google.token;
  return {
    rootKey: `local:${year.id}`, keeps: true, yearId: year.id,
    adapter: localCopies({ dir, yearId: year.id, readTemplate: (source) => downloadTemplate(token, source.fileId) }),
    templateOf: driveFileId, canFill: () => false,
  };
}

/** A colleague's computer: it can't change the keeper's copies, but it can see whether they're behind. */
async function checkBehind(year, output, status) {
  try {
    const haves = await driveCopies({ token: google.token, rootId: output.folderId, yearId: year.id }).list();
    const wants = wantedCopies(store.state, year.id, { ...driveTarget(year, output), yearFolder: plan.name });
    return { ...status, behind: keysToDo(wants, haves).length };
  } catch {
    return { ...status, behind: null }; // can't see the copies: say who keeps them anyway
  }
}

// ---------- working out what to do ----------

async function look() {
  const year = store.state && activeYear(store.state);
  const output = year?.output ?? null;
  const blocked = blocker(output);
  if (blocked?.state === 'other-keeper') return warnBehind(await checkBehind(year, output, blocked));
  if (blocked) return setStatus(blocked);
  const target = await makeTarget(year, output).catch((err) => ({ blocked: { state: 'problem', reason: err.message } }));
  if (target.blocked) return showBlocked(target.blocked);
  return queueWork(target);
}

function showBlocked(status) {
  return status.state === 'other-computer' ? warnOtherComputer(status) : setStatus(status);
}

async function queueWork(target) {
  warn({ state: 'ready' }, null);
  for (const key of keysToDo([...wanted(target).values()], bridge.haves)) {
    if (bridge.failed.get(key) !== signature(target, key)) bridge.queue.add(key);
  }
  if (!bridge.running) await work();
  return undefined;
}

function wanted(target) {
  if (bridge.wants?.version !== bridge.version || bridge.wants.targetId !== target.id) {
    const list = wantedCopies(store.state, target.yearId, { ...target, yearFolder: plan.name });
    bridge.wants = { version: bridge.version, targetId: target.id, map: new Map(list.map((w) => [w.key, w])) };
  }
  return bridge.wants.map;
}

function stepFor(target, key) {
  const wants = wanted(target);
  const want = wants.get(key) ?? null;
  const spares = want ? sparesFor(want, bridge.haves, new Set(wants.keys())) : [];
  return nextStep(want, bridge.haves.filter((c) => c.entryId === key), spares);
}

function signature(target, key) {
  const want = wanted(target).get(key);
  return JSON.stringify([want?.hash, want?.place, want?.name, bridge.haves.filter((c) => c.entryId === key).map((c) => c.id)]);
}

// ---------- doing it ----------

/** Keep working through the queue? Not while your latest change settles (a look is already planned). */
function canGoOn(target) {
  return Boolean(target) && !settling() && blocker(activeYear(store.state)?.output) === null;
}

async function work() {
  bridge.running = true;
  const tries = new Map();
  try {
    while (bridge.queue.size) {
      const target = bridge.target;
      const key = bridge.queue.values().next().value;
      const step = canGoOn(target) ? stepFor(target, key) : undefined;
      if (step === undefined) break; // a change to settle, or the folder or sign-in changed: the next look carries on
      tries.set(key, (tries.get(key) ?? 0) + 1);
      if (!step || tries.get(key) > MAX_TRIES) { bridge.queue.delete(key); continue; }
      if (await attempt(target, key, step) === 'stop') break;
    }
  } finally {
    bridge.running = false;
    bridge.doing = '';
    drawPanel();
  }
}

async function attempt(target, key, step) {
  bridge.doing = describe(step);
  drawPanel();
  try {
    await run(target, step);
    if (store.ui.tab === 'lessons') refresh();
    return 'ok';
  } catch (err) {
    if (STOPPERS.includes(err.message)) return 'stop'; // try again once Google Drive is back
    bridge.failed.set(key, signature(target, key));
    bridge.queue.delete(key);
    problem(err, step);
    return 'failed';
  }
}

const replaceHave = (old, next) => { bridge.haves = bridge.haves.map((c) => (c.id === old.id ? next : c)); };
const dropHave = (have) => { bridge.haves = bridge.haves.filter((c) => c.id !== have.id); };

async function run(target, step) {
  const { adapter } = target;
  const source = findLocation(find(store.state, 'lessons', step.want?.lessonId), 'drive');
  if (step.kind === 'create') {
    const made = await adapter.create(step.want, source);
    bridge.haves = [...bridge.haves, made];
    pictureProblem(made, step.want);
  }
  if (step.kind === 'refill' || step.kind === 'adopt') await updateInPlace(adapter, step, source);
  if (step.kind === 'remove') {
    await adapter.remove(step.have);
    dropHave(step.have);
  }
  if (step.kind === 'move') replaceHave(step.have, await adapter.move(step.have, step.want));
}

/** Update the same file; when that can't be done safely, a fresh copy replaces it (the old one goes to the trash). */
async function updateInPlace(adapter, step, source) {
  try {
    const updated = await adapter.update(step.have, step.want, source);
    replaceHave(step.have, updated);
    pictureProblem(updated, step.want);
  } catch (err) {
    if (err.message !== 'not_in_place') throw err;
    const made = await adapter.create(step.want, source);
    bridge.haves = [...bridge.haves, made];
    await adapter.remove(step.have);
    dropHave(step.have);
    pictureProblem(made, step.want);
  }
}

/** The copy is fine, but its picture couldn't go in: say so (it's tried again after the next change). */
function pictureProblem(have, want) {
  const err = have.pictureProblem;
  if (!err) return;
  const image = store.state.images.find((i) => driveFileId(i) === want.picture);
  if (err.message === 'cant_share') markShareRefused(want.picture);
  const name = image ? `“${image.name}”` : 'its picture';
  showNotice({
    id: 'copies-picture', tone: 'warn', title: 'Lesson copies',
    message: err.message === 'cant_share'
      ? `The copy of “${lessonName(want.lessonId)}” is made, but Google didn’t let the planner share ${name} for a moment to place it. In Google Drive, share ${name} with “Anyone with the link” (it can stay that way), then the planner places it.`
      : `The copy of “${lessonName(want.lessonId)}” is made, but Google couldn’t fetch ${name} to place it. The planner tries again after your next change.`,
    seconds: 30,
  });
}

function lessonName(id) {
  return find(store.state, 'lessons', id)?.name ?? 'a lesson';
}

const where = (want) => want.path.slice(1).join(' › ');

function describe(step) {
  const name = `“${lessonName(step.want?.lessonId ?? step.have.lessonId)}”`;
  if (step.kind === 'create') return `Copying ${name} to ${where(step.want)}`;
  if (step.kind === 'refill') return `Updating the details in ${name} (${where(step.want)})`;
  if (step.kind === 'adopt') return `Reusing a copy of ${name} for ${where(step.want)}`;
  if (step.kind === 'move') return `Moving ${name} to ${where(step.want)}`;
  return `Removing a copy of ${name} that’s no longer on the schedule`;
}

function problem(err, step) {
  const name = `“${lessonName(step.want?.lessonId ?? step.have?.lessonId)}”`;
  const messages = {
    api_off: `Filling in details needs the ${err.api ?? 'Google'} switched on in your Google project (see the Google Drive setup guide, step 3). ${name} wasn’t copied yet.`,
    not_found: `Couldn’t copy ${name}: its template file (or the output folder) wasn’t found in Google Drive.`,
    no_access: `Couldn’t copy ${name}: the planner isn’t allowed to open its template file or the output folder.`,
  };
  showNotice({
    id: 'copies-problem', tone: 'warn', title: 'Lesson copies',
    message: messages[err.message] ?? `Something went wrong with the copy of ${name}. The planner tries again after your next change.`,
    seconds: 20,
  });
}

// ---------- telling people ----------

const BEHIND_NOTICE = 'copies-behind';
let lastWarning = null; // so a closed warning only comes back when something's different

function warn(status, message) {
  setStatus(status);
  const text = JSON.stringify([store.state?.activeYearId, message]);
  if (text === lastWarning) return;
  lastWarning = text;
  if (!message) return dismissNotice(BEHIND_NOTICE);
  showNotice({ id: BEHIND_NOTICE, tone: 'warn', title: 'Lesson copies aren’t up to date', message, seconds: null });
}

function warnBehind(status) {
  if (status.behind === 0) return warn(status, null);
  const count = status.behind ? `${status.behind} lesson ${status.behind === 1 ? 'copy is' : 'copies are'} out of date. ` : '';
  return warn(status, `${count}${status.keeperName} keeps this plan’s lesson copies, so only they can update them. Ask ${status.keeperName} to open the Lesson Planner (and connect Google Drive) — the copies catch up by themselves then.`);
}

function warnOtherComputer(status) {
  const who = status.keeperName ? ` (chosen by ${status.keeperName})` : '';
  return warn(status, `This plan’s lesson copies are saved in a folder on another computer${who}, so changes made here reach them the next time the planner is opened on that computer. To make copies from this computer instead, choose a folder under Setup › School Year › Lesson copies.`);
}

/** How many copies your recent changes will update (only known when this computer keeps the copies). */
function waitingCount() {
  if (!bridge.target || bridge.status.state !== 'ready') return 0;
  return new Set([...bridge.queue, ...keysToDo([...wanted(bridge.target).values()], bridge.haves)]).size;
}

/** While changes settle, the panel counts down to the update (and offers to do it now). */
function showWaiting() {
  clearInterval(tick);
  if (!settling()) return drawPanel();
  tick = setInterval(() => { if (settling()) drawPanel(); else clearInterval(tick); }, 1000);
  return drawPanel();
}

function panelElement() {
  let el = document.getElementById('copy-queue');
  if (!el) {
    el = h('div', { id: 'copy-queue', class: 'copy-queue', role: 'status', 'aria-live': 'polite' });
    document.body.append(el);
  }
  return el;
}

/** Bottom-right: what the bridge is doing (or waiting to do) and how much is left. Gone when there's nothing to do. */
function drawPanel() {
  const el = panelElement();
  const waiting = settling() ? waitingCount() : 0;
  if (waiting && !bridge.running) return drawWaiting(el, waiting);
  const left = bridge.queue.size;
  el.classList.toggle('show', bridge.running && left > 0);
  return el.replaceChildren(
    h('div', { class: 'copy-queue-head' }, h('span', { class: 'copy-spin', 'aria-hidden': 'true' }, '📂'),
      h('strong', {}, 'Updating lesson copies'), h('span', { class: 'count-badge' }, left)),
    h('div', { class: 'copy-queue-now' }, bridge.doing));
}

function drawWaiting(el, count) {
  const seconds = Math.max(0, Math.ceil((lastEdit() + SETTLE_MS - Date.now()) / 1000));
  el.classList.add('show');
  return el.replaceChildren(
    h('div', { class: 'copy-queue-head' }, h('span', { 'aria-hidden': 'true' }, '⏳'),
      h('strong', {}, `Lesson copies update in ${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`),
      h('span', { class: 'count-badge' }, count)),
    h('div', { class: 'copy-queue-now wait-row' },
      h('span', {}, 'Waiting a minute in case you change more.'),
      h('button', { class: 'btn small light', onclick: updateNow }, 'Update now')));
}

// ---------- for the Lesson Templates page ----------

/**
 * The copies of a lesson in the open year's output folder, in schedule order:
 * [{ copy, label: "School › Grade › Week 3", url (Drive) | path (computer) }].
 */
export function copiesOfLesson(lessonId) {
  if (!bridge.target || bridge.status.state !== 'ready') return [];
  const byEntry = groupCopies(bridge.haves.filter((c) => c.lessonId === lessonId));
  return [...wanted(bridge.target).values()]
    .filter((w) => byEntry.has(w.key))
    .map((w) => {
      const copy = byEntry.get(w.key)[0];
      const onComputer = Boolean(copy.fileName);
      return {
        copy, label: `${where(w)} · ${copy.name}`,
        url: onComputer ? null : driveOpenUrl({ fileId: copy.id, mimeType: copy.mimeType }),
        path: onComputer ? [...copy.path, copy.fileName].join('/') : null,
      };
    });
}
