// Scenario builders for lookingAt.e2e.js: signing in to the fake Drive, my own plan in pieces, and
// colleagues' files (Lesson Schedules and Teacher Resources) with made-up names only.

import * as workspace from '/js/workspace.js';
import { DRIVE_SCOPE, google } from '/js/google.js';
import { driveKey } from '/js/pieceEngine.js';
import { emptyPiece } from '/js/pieces.js';
import { flushSave, refresh, setUi } from '/js/store.js';
import { check, commands, saved, sleep, startNewYear, text, waitFor } from './helpers.js';
import * as fakeDrive from './fakeDrive.js';

export const PAT = 'Pat Example';
export const SAM = 'Sam Sample';
export const LEE = 'Lee Placeholder';
export const YEAR1 = { name: 'Test Year 2030–31', start: '2030-08-26', end: '2031-06-13' };
export const WEEK_ONE = '2030-08-26';

/** Sign in to the fake Drive (never Google's own window). Nothing here can reach Google. */
export function signIn() {
  Object.assign(google, { status: 'connected', token: 'fake-token', userName: fakeDrive.ME.displayName, userId: fakeDrive.ME.permissionId, scope: DRIVE_SCOPE, message: '' });
  refresh();
}

/** Wait until everything changed so far is in the fake Drive. */
export async function settled() {
  await flushSave();
  await waitFor(() => {
    if (!workspace.pieces.unsaved().length) return true;
    workspace.syncNow();
    return false;
  }, 10000, 'the plan to finish saving to the fake Drive');
  await sleep(100);
}

/**
 * My own plan in pieces, saved in the fake Drive, with a school, grade, template, outcome + eval,
 * a week entry and a tag. Returns the ids of my three files.
 */
export async function seedMine() {
  fakeDrive.install();
  signIn();
  await startNewYear({ ...YEAR1 });
  commands([
    { command: 'addSetupItem', args: { list: 'schools', name: 'Maple School' } },
    { command: 'addSetupItem', args: { list: 'grades', name: 'Grade 3', short: '3', color: '#6b8f5e' } },
    { command: 'addLesson', args: { name: 'My Steady Beat Game', category: 'Rhythm' } },
    { command: 'addOutcome', args: { title: 'Keep a steady beat', code: 'MU1' } },
    { command: 'addEval', args: { outcome: 'MU1', title: 'Claps a steady beat', grades: ['Grade 3'], lessons: ['My Steady Beat Game'] } },
    { command: 'addTagCategory', args: { name: 'My Season' } },
    { command: 'addTag', args: { category: 'My Season', name: 'my autumn' } },
    { command: 'addLessonToWeek', args: { school: 'Maple School', grade: 'Grade 3', week: 1, lesson: 'My Steady Beat Game' } },
  ]);
  await settled();
  const ids = { year: only('schoolYear'), schedule: only('schedule'), resources: only('resources') };
  await saved();
  return ids;
}

function only(kind) {
  const found = fakeDrive.mineOf(kind);
  check(found.length === 1, `expected one ${kind} file of mine in the fake Drive, found ${found.length}`);
  return found[0];
}

const slug = (name) => name.toLowerCase().replace(/[^a-z]+/g, '-');
const link = (fileId) => ({ key: driveKey(fileId), fileId, name: fakeDrive.describe(fileId).name });

/**
 * A colleague's Teacher Resources in the fake Drive: one template, one tag, and (with `picture`) one picture.
 * `role`: 'writer' (Editor) or 'reader' (Viewer); `shared: false` = they did not share it with me.
 */
export function addResources({ owner, role = 'writer', shared = true, picture = false, name = 'Teacher Resources' }) {
  const who = slug(owner);
  const data = emptyPiece('resources', { ownerId: `perm-${who}` });
  data.lessons.push({ id: `les-${who}`, name: `${owner.split(' ')[0]} Rhythm Game`, category: 'Rhythm', autoFields: [], instrumentIds: [], folderId: null, locations: [], isNew: false });
  data.tagGroups.push({ id: `tgrp-${who}`, name: `${owner.split(' ')[0]} Season` });
  data.tags.push({ id: `tag-${who}`, groupId: `tgrp-${who}`, name: `${owner.split(' ')[0].toLowerCase()} winter` });
  if (picture) data.images.push(pictureRecord(who, `${owner.split(' ')[0]} Snowman`));
  return fakeDrive.addFile({ name, data, owner, canEdit: role === 'writer', shared, properties: { lessonPlanner: 'resources' } });
}

export function pictureRecord(who, name) {
  return {
    id: `img-${who}-${slug(name)}`, name, description: '', folderId: null, locations: [], isNew: false, tagIds: [], instrumentIds: [], lessonIds: [], autoFields: [], category: '',
    when: { anytime: true, priority: 1, windows: [] },
  };
}

/**
 * A colleague's Lesson Schedule using my School Year, with one week entry for their template. It links to
 * their Teacher Resources `resourcesFileId` (which may or may not be shared with me). `yearFileId` defaults to mine.
 */
export function addSchedule({ owner, ids, resourcesFileId = null, yearFileId = ids.year, role = 'writer', shared = true }) {
  const who = slug(owner);
  const year = fakeDrive.read(yearFileId);
  const links = { schoolYear: link(yearFileId) };
  if (resourcesFileId) links.resources = link(resourcesFileId);
  const data = emptyPiece('schedule', { links, ownerId: `perm-${who}` });
  data.weekLessons.push({
    id: `wk-${who}`, schoolId: year.schools[0].id, gradeId: year.grades[0].id, weekStart: WEEK_ONE, lessonId: `les-${who}`, criterionId: null, position: 0,
  });
  return fakeDrive.addFile({
    name: 'Lesson Schedule', data, owner, canEdit: role === 'writer', shared,
    properties: { lessonPlanner: 'schedule', lpSchoolYear: yearFileId },
  });
}

// ---------- the page ----------

/** Go to a tab and wait until it has finished showing (no "Loading…"). */
export async function goTo(tab) {
  setUi({ tab });
  await waitFor(() => {
    const main = document.querySelector('main');
    return main?.dataset.view?.startsWith(`${tab}/`) && !text(main).startsWith('Loading…');
  }, 8000, `the ${tab} tab to finish loading`);
  await sleep(50);
}

export const pageText = () => text(document.querySelector('main'));
export const barText = () => text(document.getElementById('piece-bar'));

/** The name written on the "Looking at" button on the open tab. */
export const lookingAtLabel = () => text(document.querySelector('.people-picker summary')?.querySelector('strong') ?? { textContent: '(no picker)' });

/** Open the "Looking at" list and return the names in it (waits for the list from the fake Drive). */
export async function pickerNames() {
  const picker = await waitFor(() => document.querySelector('.people-picker'), 4000, 'the "Looking at" button');
  picker.open = true;
  await sleep(350);
  const names = [...picker.querySelectorAll('.people-row')].map((b) => text(b).replace(/^✓ /, ''));
  const hint = text(picker.querySelector('.people-list .hint') ?? { textContent: '' });
  picker.open = false;
  return { names, hint };
}

/** Choose a person in the "Looking at" list on the open tab, like a click would, and wait for the tab to settle. */
export async function chooseInUi(name) {
  const picker = await waitFor(() => document.querySelector('.people-picker'), 4000, 'the "Looking at" button');
  picker.open = true;
  const row = await waitFor(() => [...picker.querySelectorAll('.people-row')].find((b) => text(b).replace(/^✓ /, '') === name), 4000, `${name} in the list`);
  row.click();
  await waitFor(() => !pageText().startsWith('Loading…') && lookingAtLabel() === name, 8000, `the tab to show ${name}`);
  await sleep(100);
}

/** Keep checking with Drive (as the app does every few minutes) until `done()` is true. */
export async function syncUntil(done, what) {
  await waitFor(async () => {
    workspace.syncNow();
    await sleep(250);
    return done();
  }, 12000, what);
}

/** A School Year file of someone else's (a different one from mine), as a copy of mine. */
export function addOtherYear(ids, owner) {
  return fakeDrive.addFile({ name: 'School Year Other', data: fakeDrive.read(ids.year), owner, properties: { lessonPlanner: 'schoolYear' } });
}

/** The names of things in the data on the page: `names('lessons')`. */
export const names = (store, collection) => store.state[collection].map((r) => r.name ?? r.title ?? r.id);
