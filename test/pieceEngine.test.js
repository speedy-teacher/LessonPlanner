// An open plan made of three piece files, against a pretend Google Drive: each piece loads, saves and
// combines on its own; missing or unshared pieces leave the rest working and heal when they're back.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { add, normalize } from '../public/js/model.js';
import { seedState } from '../public/js/seed.js';
import { emptyPiece, splitState, toPieceFile } from '../public/js/pieces.js';
import { driveKey, PiecePlan, rebaseState } from '../public/js/pieceEngine.js';

/** A pretend Google Drive: files by id; `deny` = ids you can't open; `viewOnly` = ids shared as Viewer. */
function fakeDrive() {
  const files = new Map();
  let revs = 0;
  const drive = {
    files, deny: new Set(), viewOnly: new Set(), saves: [], offline: false,
    put(fileId, name, text) { revs += 1; files.set(fileId, { fileId, name, text, rev: `r${revs}`, folderId: 'folder-1' }); },
    async info(fileId) {
      if (drive.offline) throw new Error('offline');
      if (drive.deny.has(fileId)) throw new Error('no_access');
      const f = files.get(fileId);
      if (!f) throw new Error('not_found');
      const { text: _t, ...info } = f;
      return { ...info, canEdit: !drive.viewOnly.has(fileId) };
    },
    async read(fileId) { return { ...(await drive.info(fileId)), text: files.get(fileId).text }; },
    async save(fileId, text) { drive.saves.push(fileId); drive.put(fileId, files.get(fileId).name, text); return files.get(fileId).rev; },
    async keep() {},
  };
  return drive;
}

function fakeCache() {
  const map = new Map();
  return { map, get: async (key) => structuredClone(map.get(key) ?? null), put: async (rec) => { map.set(rec.key, structuredClone(rec)); } };
}

function fullPlan() {
  const s = normalize(seedState());
  add(s, 'weekLessons', {
    yearId: s.activeYearId, schoolId: s.schools[0].id, gradeId: s.grades[0].id, weekStart: '2026-09-14', lessonId: s.lessons[0].id, criterionId: null, position: 0,
  });
  return normalize(s);
}

/** The plan saved in Drive as three files, with the Teacher Schedule pointing at the other two. */
function inDrive(state = fullPlan()) {
  const drive = fakeDrive();
  const links = { schoolYear: { key: driveKey('f-year'), fileId: 'f-year' }, resources: { key: driveKey('f-res'), fileId: 'f-res' } };
  const pieces = splitState(state, { schedule: emptyPiece('schedule', { links }) });
  drive.put('f-year', 'School Year', toPieceFile(pieces.schoolYear));
  drive.put('f-sched', 'My Lesson Schedule', toPieceFile(pieces.schedule));
  drive.put('f-res', 'My Teacher Resources', toPieceFile(pieces.resources));
  return { drive, state, pieces };
}

async function openFromDrive(drive, cache = fakeCache()) {
  const file = await drive.read('f-sched');
  const plan = new PiecePlan({ drive, cache, today: () => '2026-10-30' });
  const rec = { key: driveKey('f-sched'), piece: 'schedule', name: file.name, fileId: 'f-sched', rev: file.rev, base: file.text, canEdit: true, changed: false, data: JSON.parse(file.text) };
  await plan.load(rec);
  await plan.syncAll();
  return plan;
}

test('opening the Teacher Schedule brings the School Year and Teacher Resources along', async () => {
  const { drive, state } = inDrive();
  const plan = await openFromDrive(drive);
  assert.deepEqual(plan.state(), state);
  assert.deepEqual(plan.missing, {});
  assert.deepEqual(plan.readOnly(), []);
});

test('templates not shared with you: the rest works, and they heal in once shared', async () => {
  const { drive, state } = inDrive();
  drive.deny.add('f-res');
  const cache = fakeCache();
  const plan = await openFromDrive(drive, cache);
  assert.equal(plan.missing.resources, 'no_access');
  const shown = plan.state();
  assert.equal(shown.lessons.length, 0);
  assert.deepEqual(shown.weekLessons, state.weekLessons, 'schedule still points at the templates');
  assert.deepEqual(plan.readOnly(), ['resources']);

  drive.deny.delete('f-res');
  await plan.syncAll();
  assert.deepEqual(plan.missing, {});
  assert.deepEqual(plan.state(), state);
});

test('a change saves only the piece it touched, to this computer first, then Drive', async () => {
  const { drive } = inDrive();
  const cache = fakeCache();
  const plan = await openFromDrive(drive, cache);
  const s = plan.state();
  s.weekLessons[0].position = 3;
  assert.deepEqual(await plan.save(s), ['schedule']);
  assert.equal(cache.map.get(driveKey('f-sched')).data.weekLessons[0].position, 3);
  assert.deepEqual(plan.unsaved(), ['schedule']);
  drive.saves.length = 0;
  await plan.syncAll();
  assert.deepEqual(drive.saves, ['f-sched']);
  assert.deepEqual(plan.unsaved(), []);
  assert.equal(JSON.parse(drive.files.get('f-sched').text).weekLessons[0].position, 3);
});

test('a School Year shared as Viewer opens view only: its changes are refused, mine still save', async () => {
  const { drive } = inDrive();
  drive.viewOnly.add('f-year');
  const plan = await openFromDrive(drive);
  assert.equal(plan.access('schoolYear'), 'view');
  const before = plan.state();
  const after = structuredClone(before);
  after.schools[0].name = 'Renamed School';
  after.lessons[0].name = 'Renamed template';
  const { state, blocked } = plan.guard(before, after);
  assert.deepEqual(blocked, ['schoolYear']);
  assert.equal(state.schools[0].name, before.schools[0].name);
  assert.deepEqual(await plan.save(state), ['resources']);
});

test('two teachers editing the shared School Year at once: both changes are combined', async () => {
  const { drive } = inDrive();
  const mine = await openFromDrive(drive);
  const theirs = await openFromDrive(drive);
  const a = mine.state();
  a.schools[0].name = 'Renamed here';
  await mine.save(a);
  const b = theirs.state();
  b.schools[1].name = 'Renamed there';
  await theirs.save(b);
  await theirs.syncAll();
  const results = await mine.syncAll();
  const year = results.find((r) => r.name === 'schoolYear');
  assert.equal(year.action, 'conflict');
  assert.deepEqual(year.conflicts, []);
  const combined = JSON.parse(drive.files.get('f-year').text);
  assert.deepEqual(combined.schools.slice(0, 2).map((x) => x.name), ['Renamed here', 'Renamed there']);
});

test('losing access to a piece already on this computer keeps showing it, view only, until access returns', async () => {
  const { drive } = inDrive();
  const plan = await openFromDrive(drive);
  drive.deny.add('f-year');
  await plan.syncAll();
  assert.equal(plan.stale.schoolYear, 'no_access');
  assert.equal(plan.access('schoolYear'), 'view');
  assert.ok(plan.state().schools.length > 0);
  drive.deny.delete('f-year');
  await plan.syncAll();
  assert.deepEqual([plan.stale, plan.access('schoolYear')], [{}, 'edit']);
});

test('offline: a piece never loaded on this computer is missing; the plan still opens', async () => {
  const { drive } = inDrive();
  drive.offline = true;
  const plan = new PiecePlan({ drive, cache: fakeCache() });
  const { pieces } = inDrive();
  await plan.load({ key: driveKey('f-sched'), piece: 'schedule', fileId: 'f-sched', canEdit: true, data: { ...pieces.schedule, meta: { links: { schoolYear: { key: driveKey('f-year'), fileId: 'f-year' } } } } });
  assert.equal(plan.missing.schoolYear, 'not_loaded');
  assert.equal(plan.missing.resources, 'not_linked');
  await plan.syncAll();
  assert.equal(plan.missing.schoolYear, 'offline');
  assert.equal(plan.state().weekLessons.length, 1);
});

test('edits made while Drive was loading are put on top of the newly loaded pieces', async () => {
  const { drive } = inDrive();
  const plan = await openFromDrive(drive);
  const start = plan.state();
  const mine = structuredClone(start);
  mine.weekLessons[0].weekStart = '2026-09-21'; // moved while the sync was running
  // Meanwhile another computer renamed a school in the shared School Year.
  const other = JSON.parse(drive.files.get('f-year').text);
  other.schools[0].name = 'Renamed elsewhere';
  drive.put('f-year', 'School Year', JSON.stringify(other));
  await plan.syncAll();
  const shown = rebaseState(start, mine, plan.datas());
  assert.equal(shown.schools[0].name, 'Renamed elsewhere');
  assert.equal(shown.weekLessons[0].weekStart, '2026-09-21');
});

// ---------- looking at a teammate's plan ----------

/** A teammate's Teacher Schedule + Teacher Resources in the same Drive, using the same School Year. */
function addTeammate(drive, pieces, { shareResources = true, viewOnly = true } = {}) {
  const theirs = structuredClone(pieces.schedule);
  theirs.weekLessons = theirs.weekLessons.map((w) => ({ ...w, id: `${w.id}-t`, weekStart: '2026-10-05' }));
  theirs.meta = { links: { schoolYear: { key: driveKey('f-year'), fileId: 'f-year' }, resources: { key: driveKey('t-res'), fileId: 't-res' } } };
  const theirRes = structuredClone(pieces.resources);
  theirRes.lessons = theirRes.lessons.slice(0, 2).map((l) => ({ ...l, name: `Their ${l.name}` }));
  drive.put('t-sched', 'Lesson Schedule', toPieceFile(theirs));
  drive.put('t-res', 'Teacher Resources', toPieceFile(theirRes));
  if (!shareResources) drive.deny.add('t-res');
  if (viewOnly) ['t-sched', 't-res'].forEach((id) => drive.viewOnly.add(id));
}

async function viewTeammate(plan, drive) {
  const file = await drive.read('t-sched');
  await plan.view({ key: driveKey('t-sched'), piece: 'schedule', name: file.name, fileId: 't-sched', rev: file.rev, base: file.text, canEdit: file.canEdit, changed: false, data: JSON.parse(file.text) }, { name: 'Teammate' });
  await plan.syncAll();
}

test('looking at a teammate: their schedule and templates with our shared School Year; mine come back after', async () => {
  const { drive, pieces, state } = inDrive();
  addTeammate(drive, pieces);
  const plan = await openFromDrive(drive);
  await viewTeammate(plan, drive);
  const shown = plan.state();
  assert.equal(shown.weekLessons[0].weekStart, '2026-10-05');
  assert.ok(shown.lessons.every((l) => l.name.startsWith('Their ')));
  assert.equal(shown.schools.length, state.schools.length, 'the shared School Year');
  assert.deepEqual(plan.myState(), state, 'my own plan is kept aside, for my lesson copies');
  assert.deepEqual(plan.readOnly(), ['schedule', 'resources'], 'shared as Viewer: view only');
  plan.viewMine();
  assert.deepEqual(plan.state(), state);
  assert.deepEqual(plan.readOnly(), []);
});

test('a teammate whose templates aren’t shared with me: their schedule shows, templates are missing', async () => {
  const { drive, pieces } = inDrive();
  addTeammate(drive, pieces, { shareResources: false });
  const plan = await openFromDrive(drive);
  await viewTeammate(plan, drive);
  assert.equal(plan.missing.resources, 'no_access');
  assert.equal(plan.state().lessons.length, 0);
  assert.equal(plan.state().weekLessons.length, 1);
  plan.viewMine();
  assert.deepEqual(plan.missing, {});
});

test('while looking at a teammate, editing the shared School Year still saves to it', async () => {
  const { drive, pieces } = inDrive();
  addTeammate(drive, pieces);
  const plan = await openFromDrive(drive);
  await viewTeammate(plan, drive);
  const s = plan.state();
  s.schools[0].name = 'Renamed while looking';
  s.weekLessons[0].weekStart = '2026-11-02'; // their schedule: view only
  const { state, blocked } = plan.guard(plan.state(), s);
  assert.deepEqual(blocked, ['schedule']);
  assert.deepEqual(await plan.save(state), ['schoolYear']);
  plan.viewMine();
  assert.equal(plan.state().schools[0].name, 'Renamed while looking');
});
