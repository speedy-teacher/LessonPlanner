// An open plan made of three piece files, against a pretend Google Drive: each piece loads, saves and
// combines on its own; missing or unshared pieces leave the rest working and heal when they're back.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { add, normalize } from '../public/js/model.js';
import { seedState } from '../public/js/seed.js';
import { emptyPiece, splitState, toPieceFile } from '../public/js/pieces.js';
import { driveKey, PiecePlan, rebaseState, whyUnavailable } from '../public/js/pieceEngine.js';

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

async function recOf(drive, fileId, piece = 'schedule') {
  const file = await drive.read(fileId);
  return { key: driveKey(fileId), piece, name: file.name, fileId, rev: file.rev, base: file.text, canEdit: file.canEdit, changed: false, data: JSON.parse(file.text) };
}

async function viewTeammate(plan, drive) {
  await plan.view({ schedule: await recOf(drive, 't-sched') }, { schedule: { name: 'Teammate', fileId: 't-sched' } });
  await plan.syncAll();
}

async function viewTheirResources(plan, drive) {
  await plan.view({ resources: await recOf(drive, 't-res', 'resources') }, { resources: { name: 'Teammate', fileId: 't-res' } });
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
  assert.equal(plan.state().lessons.length, 0, 'never my own templates');
  assert.equal(plan.state().weekLessons.length, 1);
  assert.equal(whyUnavailable(plan.state(), 'lessons', plan.myState().lessons[0].id, plan.missing), 'Teacher Resources: Not shared with you.');
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

test('a link to something in a missing piece says why it can’t be followed; it works again once healed', async () => {
  const { drive, state } = inDrive();
  drive.deny.add('f-res');
  const plan = await openFromDrive(drive);
  const lessonId = state.weekLessons[0].lessonId;
  assert.equal(whyUnavailable(plan.state(), 'lessons', lessonId, plan.missing), 'Teacher Resources: Not shared with you.');
  assert.equal(whyUnavailable(plan.state(), 'schools', 'sch_gone', plan.missing), 'Not in this plan any more.');
  drive.deny.delete('f-res');
  await plan.syncAll();
  assert.equal(whyUnavailable(plan.state(), 'lessons', lessonId, plan.missing), null);
});

// ---------- looking at one part at a time ----------

test('looking at only a teammate’s templates: my schedule stays, theirs are the templates; mine come back after', async () => {
  const { drive, pieces, state } = inDrive();
  addTeammate(drive, pieces);
  const plan = await openFromDrive(drive);
  await viewTheirResources(plan, drive);
  const shown = plan.state();
  assert.ok(shown.lessons.every((l) => l.name.startsWith('Their ')));
  assert.deepEqual(shown.weekLessons, state.weekLessons, 'my own lesson schedule');
  assert.deepEqual(plan.myState(), state);
  assert.deepEqual(plan.viewing, { schedule: null, resources: { name: 'Teammate', fileId: 't-res' } });
  assert.deepEqual(plan.readOnly(), ['resources']);
  plan.viewMine();
  assert.deepEqual(plan.state(), state);
  assert.equal(plan.viewing, null);
});

test('my own schedule edited while looking at their templates is still there (and saved) when I come back', async () => {
  const { drive, pieces } = inDrive();
  addTeammate(drive, pieces);
  const plan = await openFromDrive(drive);
  await viewTheirResources(plan, drive);
  const s = plan.state();
  s.weekLessons[0].position = 7;
  assert.deepEqual(await plan.save(s), ['schedule']);
  await plan.syncAll();
  assert.equal(JSON.parse(drive.files.get('f-sched').text).weekLessons[0].position, 7);
  plan.viewMine();
  assert.equal(plan.state().weekLessons[0].position, 7);
  assert.deepEqual(plan.unsaved(), []);
  assert.equal(plan.recs.schedule.rev, drive.files.get('f-sched').rev);
  const results = await plan.syncAll();
  assert.ok(results.every((r) => r.action === 'none'), 'nothing left to upload or combine');
});

test('a teammate’s templates shared as Editor: my change and theirs in Drive are both kept', async () => {
  const { drive, pieces } = inDrive();
  addTeammate(drive, pieces, { viewOnly: false });
  const plan = await openFromDrive(drive);
  await viewTheirResources(plan, drive);
  assert.equal(plan.access('resources'), 'edit');
  const s = plan.state();
  s.lessons[0].name = 'Renamed by me';
  assert.deepEqual(await plan.save(s), ['resources']);
  const theirs = JSON.parse(drive.files.get('t-res').text);
  theirs.lessons[1].name = 'Renamed by them';
  drive.put('t-res', 'Teacher Resources', JSON.stringify(theirs));
  const results = await plan.syncAll();
  assert.equal(results.find((r) => r.name === 'resources').action, 'conflict');
  const merged = JSON.parse(drive.files.get('t-res').text);
  assert.deepEqual(merged.lessons.slice(0, 2).map((l) => l.name), ['Renamed by me', 'Renamed by them']);
  assert.deepEqual(plan.unsaved(), []);
});

test('a teammate’s templates shared as Viewer: my change to them is refused', async () => {
  const { drive, pieces } = inDrive();
  addTeammate(drive, pieces);
  const plan = await openFromDrive(drive);
  await viewTheirResources(plan, drive);
  const before = plan.state();
  const after = structuredClone(before);
  after.lessons[0].name = 'Renamed by me';
  assert.deepEqual(plan.guard(before, after).blocked, ['resources']);
});

test('a teammate’s lesson schedule shared as Editor: my change and theirs in Drive are both kept', async () => {
  const { drive, pieces } = inDrive();
  addTeammate(drive, pieces, { viewOnly: false });
  const plan = await openFromDrive(drive);
  await viewTeammate(plan, drive);
  const s = plan.state();
  s.weekLessons[0].weekStart = '2026-11-02';
  assert.deepEqual(await plan.save(s), ['schedule']);
  const theirs = JSON.parse(drive.files.get('t-sched').text);
  theirs.weekLessons.push({ ...theirs.weekLessons[0], id: 'wl_added_there' });
  drive.put('t-sched', 'Lesson Schedule', JSON.stringify(theirs));
  const results = await plan.syncAll();
  assert.equal(results.find((r) => r.name === 'schedule').action, 'conflict');
  const merged = JSON.parse(drive.files.get('t-sched').text);
  assert.equal(merged.weekLessons.length, 2);
  assert.equal(merged.weekLessons.find((w) => w.id !== 'wl_added_there').weekStart, '2026-11-02');
  plan.viewMine();
  assert.equal(plan.state().weekLessons[0].position, pieces.schedule.weekLessons[0].position, 'my own schedule untouched');
});

test('syncing while looking fetches a chosen Teacher Resources not on this computer yet, and keeps it current', async () => {
  const { drive, pieces } = inDrive();
  addTeammate(drive, pieces);
  const plan = await openFromDrive(drive);
  await plan.view({ resources: { key: driveKey('t-res'), fileId: 't-res' } }, { resources: { name: 'Teammate', fileId: 't-res' } });
  assert.equal(plan.missing.resources, 'not_loaded');
  assert.equal(plan.link('resources').fileId, 't-res');
  await plan.syncAll();
  assert.deepEqual(plan.missing, {});
  assert.ok(plan.state().lessons.every((l) => l.name.startsWith('Their ')));
  const theirs = JSON.parse(drive.files.get('t-res').text);
  theirs.lessons[0].name = 'Changed in Drive';
  drive.put('t-res', 'Teacher Resources', JSON.stringify(theirs));
  await plan.syncAll();
  assert.equal(plan.state().lessons[0].name, 'Changed in Drive');
  plan.viewMine();
  assert.equal(plan.link('resources').fileId, 'f-res');
});

test('switching from one person to another keeps my own pieces aside, unchanged', async () => {
  const { drive, pieces, state } = inDrive();
  addTeammate(drive, pieces);
  const plan = await openFromDrive(drive);
  await viewTeammate(plan, drive);
  await viewTheirResources(plan, drive);
  assert.deepEqual(plan.myState(), state);
  assert.deepEqual(plan.state().weekLessons, state.weekLessons, 'now my own schedule again');
  plan.viewMine();
  assert.deepEqual(plan.state(), state);
});
