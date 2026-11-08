// A colleague shares their Teacher Resources: their lesson templates show in your Lesson Schedule's list
// (with a "From" filter), go on your schedule, and your lesson copies fill in YOUR schedule details and
// YOUR pictures — only the template comes from them, and it's never changed. All names here are made up.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { add, createYear, emptyState, normalize } from '../public/js/model.js';
import { addImage } from '../public/js/library.js';
import { canFillIn, driveFileId, driveLocation } from '../public/js/locations.js';
import { addWeekLesson, filterLessons, schoolWeeks } from '../public/js/weekPlan.js';
import { wantedCopies } from '../public/js/exportPlan.js';
import { composeState, splitState } from '../public/js/pieces.js';
import { PiecePlan } from '../public/js/pieceEngine.js';
import { BorrowedResources } from '../public/js/borrowedPieces.js';
import { heldEntries, keepBorrowed, lessonAuthors, MINE, sharedWhy } from '../public/js/sharedLessons.js';
import { runCommand } from '../public/js/agentCommands.js';

const SLIDES = 'application/vnd.google-apps.presentation';
const THEIRS = 'fake-their-resources';
const COLLEAGUE = 'Pat Example';

/** The colleague's planner: a template that fills in the school and week and has a picture spot, and their own picture. */
function colleaguePieces() {
  const s = emptyState();
  const year = createYear(s, { name: 'Their Year', startDate: '2026-08-24', endDate: '2027-05-28' });
  add(s, 'schools', { yearId: year.id, name: 'Their School' });
  add(s, 'lessons', {
    yearId: year.id, name: 'Rhythm Train', category: 'Rhythm', autoFields: ['school', 'week', 'image'], instrumentIds: [],
    locations: [driveLocation({ fileId: 'fake-their-template', mimeType: SLIDES })],
  });
  Object.assign(addImage(s, { yearId: year.id, name: 'Their bitmoji', locations: [driveLocation({ fileId: 'fake-their-picture', mimeType: 'image/png' })] }),
    { when: { anytime: true, priority: 2, windows: [] } });
  return splitState(normalize(s));
}

/** Your own planner, with their Teacher Resources borrowed. */
function myPlan(borrowedLessons = colleaguePieces().resources.lessons) {
  const s = emptyState();
  const year = createYear(s, { name: 'Year A', startDate: '2026-08-24', endDate: '2027-05-28' });
  const school = add(s, 'schools', { yearId: year.id, name: 'My School' });
  const grade = add(s, 'grades', { yearId: year.id, name: 'Grade 2', short: '2' });
  add(s, 'lessons', { yearId: year.id, name: 'My Own Song', category: 'Singing', autoFields: ['school'], instrumentIds: [], locations: [driveLocation({ fileId: 'fake-my-template', mimeType: SLIDES })] });
  Object.assign(addImage(s, { yearId: year.id, name: 'My bitmoji', locations: [driveLocation({ fileId: 'fake-my-picture', mimeType: 'image/png' })] }),
    { when: { anytime: true, priority: 2, windows: [] } });
  const mine = splitState(normalize(s));
  const state = composeState({ ...mine, borrowed: [{ fileId: THEIRS, owner: COLLEAGUE, lessons: borrowedLessons }] });
  const cls = { yearId: state.activeYearId, schoolId: school.id, gradeId: grade.id };
  return { state, cls, weeks: schoolWeeks(state.years[0]), mine };
}

const lessonNamed = (state, name) => state.lessons.find((l) => l.name === name);

test('a colleague’s shared templates show in your Lesson Schedule list, with a From filter', () => {
  const { state, cls } = myPlan();
  const names = (author) => filterLessons(state, cls.yearId, { author }).map((x) => x.lesson.name);
  assert.deepEqual(names(''), ['My Own Song', 'Rhythm Train'], 'everyone');
  assert.deepEqual(names(MINE), ['My Own Song'], 'just mine');
  assert.deepEqual(names(THEIRS), ['Rhythm Train'], 'just theirs');
  assert.deepEqual(lessonAuthors(state.lessons), [{ id: THEIRS, name: COLLEAGUE }]);
  assert.equal(lessonNamed(state, 'Rhythm Train').sharedBy, COLLEAGUE);
  assert.deepEqual(filterLessons(state, cls.yearId, { search: 'pat' }).map((x) => x.lesson.name), ['Rhythm Train'], 'search finds who shared it');
});

test('their templates are never saved into your own pieces; your schedule remembers where one came from', () => {
  const { state, cls, weeks } = myPlan();
  const entry = addWeekLesson(state, { ...cls, weekStart: weeks[0].weekStart, lessonId: lessonNamed(state, 'Rhythm Train').id });
  assert.equal(entry.sharedFrom, THEIRS);
  const saved = splitState(state);
  assert.deepEqual(saved.resources.lessons.map((l) => l.name), ['My Own Song'], 'their template stays theirs');
  assert.equal(saved.schedule.weekLessons[0].sharedFrom, THEIRS);
  const own = addWeekLesson(state, { ...cls, weekStart: weeks[0].weekStart, lessonId: lessonNamed(state, 'My Own Song').id });
  assert.equal(own.sharedFrom, undefined, 'your own template needs no source');
});

test('your copy of their template fills in your own school, week and picture (never theirs)', () => {
  const { state, cls, weeks } = myPlan();
  addWeekLesson(state, { ...cls, weekStart: weeks[2].weekStart, lessonId: lessonNamed(state, 'Rhythm Train').id });
  const [want] = wantedCopies(state, cls.yearId, { rootKey: 'drive:fakeRoot', yearFolder: 'My plan', templateOf: driveFileId, canFill: canFillIn, canPicture: () => true });
  assert.equal(want.template, 'fake-their-template', 'copied from their template');
  assert.equal(want.values['{{school}}'], 'My School');
  assert.equal(want.values['{{week_number}}'], '3');
  assert.equal(want.picture, 'fake-my-picture', 'your own bitmoji');
  assert.deepEqual(want.path.slice(1, 3), ['My School', 'Grade 2'], 'in your own copies folder layout');
});

test('their templates can’t be changed or deleted from your planner', () => {
  const { state } = myPlan();
  const after = structuredClone(state);
  lessonNamed(after, 'Rhythm Train').name = 'Renamed';
  lessonNamed(after, 'My Own Song').name = 'My Renamed Song';
  const kept = keepBorrowed(state, after);
  assert.equal(kept.touched, true);
  assert.ok(lessonNamed(kept.state, 'Rhythm Train'), 'their template is put back');
  assert.ok(lessonNamed(kept.state, 'My Renamed Song'), 'your own change stays');
  const gone = structuredClone(state);
  gone.lessons = gone.lessons.filter((l) => l.name !== 'Rhythm Train');
  assert.ok(lessonNamed(keepBorrowed(state, gone).state, 'Rhythm Train'), 'can’t delete it either');
});

test('a template no longer shared shows why, and its lesson copies are left alone (not trashed)', () => {
  const { state, cls, weeks } = myPlan();
  const entry = addWeekLesson(state, { ...cls, weekStart: weeks[0].weekStart, lessonId: lessonNamed(state, 'Rhythm Train').id });
  assert.equal(sharedWhy(state, entry), null, 'available: nothing to say');
  const later = composeState({ ...splitState(state), borrowed: [{ fileId: THEIRS, owner: COLLEAGUE, lessons: null }] });
  const stillThere = later.weekLessons.find((e) => e.id === entry.id);
  assert.ok(stillThere, 'the entry stays on your schedule');
  assert.match(sharedWhy(later, stillThere, { [THEIRS]: 'no_access' }), /isn’t shared with you any more/);
  assert.match(sharedWhy(later, stillThere, { [THEIRS]: 'offline' }), /can’t reach Google Drive/);
  assert.match(sharedWhy(later, stillThere), /removed it/);
  assert.deepEqual([...heldEntries(later)], [entry.id], 'its copy is held, never removed');
});

// ---------- loading their file, against a pretend Google Drive ----------

function fakeDrive(text) {
  const drive = {
    deny: false, rev: 'r1', text, reads: 0,
    async info() { if (drive.deny) throw new Error('no_access'); return { fileId: THEIRS, rev: drive.rev, owner: COLLEAGUE }; },
    async read() { drive.reads += 1; return { ...(await drive.info()), name: 'Teacher Resources', text: drive.text }; },
    async listShared() { return drive.deny ? [] : [{ fileId: THEIRS, name: COLLEAGUE }]; },
  };
  return drive;
}

function fakeCache() {
  const map = new Map();
  return { map, get: async (key) => structuredClone(map.get(key) ?? null), put: async (rec) => { map.set(rec.key, structuredClone(rec)); } };
}

test('their Teacher Resources is found in Google Drive, loaded, refreshed when it changes and dropped when unshared', async () => {
  const drive = fakeDrive(JSON.stringify(colleaguePieces().resources));
  const cache = fakeCache();
  const borrowed = new BorrowedResources({ drive, cache });
  await borrowed.relist();
  await borrowed.want({ ownFileIds: ['fake-my-resources'] });
  assert.deepEqual(borrowed.status(), { [THEIRS]: 'not_loaded' });
  assert.equal(await borrowed.sync(), true);
  assert.deepEqual(borrowed.list().map((b) => [b.owner, b.lessons.map((l) => l.name)]), [[COLLEAGUE, ['Rhythm Train']]]);
  assert.equal(await borrowed.sync(), false, 'unchanged: not read again');
  assert.equal(drive.reads, 1);

  const again = new BorrowedResources({ drive: null, cache });
  await again.want({ listed: [{ fileId: THEIRS, name: COLLEAGUE }] });
  assert.equal(again.list()[0].lessons.length, 1, 'next time this computer’s copy shows at once');

  drive.deny = true;
  await borrowed.relist();
  await borrowed.want({ used: [THEIRS] });
  assert.equal(await borrowed.sync(), true);
  assert.equal(borrowed.list()[0].lessons, null, 'no longer shared: no templates');
  assert.deepEqual(borrowed.status(), { [THEIRS]: 'no_access' });
});

test('an open plan adds a colleague’s templates and refuses changes to them', async () => {
  const drive = fakeDrive(JSON.stringify(colleaguePieces().resources));
  const { mine } = myPlan([]);
  const plan = new PiecePlan({ drive, cache: fakeCache() });
  await plan.load({ key: 'local:me', piece: 'schedule', name: 'Mine', data: mine.schedule, canEdit: true }, { shared: [{ fileId: THEIRS, name: COLLEAGUE }] });
  plan.recs.schoolYear = { key: 'local:y', data: mine.schoolYear, canEdit: true };
  plan.recs.resources = { key: 'local:r', data: mine.resources, canEdit: true };
  assert.equal(await plan.syncBorrowed(), true);
  const state = plan.state();
  assert.equal(lessonNamed(state, 'Rhythm Train').sharedBy, COLLEAGUE);
  const edited = structuredClone(state);
  lessonNamed(edited, 'Rhythm Train').category = 'Changed';
  const { state: kept, blocked } = plan.guard(state, edited);
  assert.deepEqual(blocked, ['borrowed']);
  assert.equal(lessonNamed(kept, 'Rhythm Train').category, 'Rhythm');
});

// ---------- assistant commands ----------

test('the assistant can list a colleague’s templates and schedule one, but not change it', () => {
  const { state, weeks } = myPlan();
  const listed = runCommand(state, 'listLessons', { from: COLLEAGUE });
  assert.deepEqual(listed.map((l) => [l.name, l.sharedBy]), [['Rhythm Train', COLLEAGUE]]);
  assert.deepEqual(runCommand(state, 'listLessons', { from: 'me' }).map((l) => l.name), ['My Own Song']);
  assert.throws(() => runCommand(state, 'listLessons', { from: 'Nobody Here' }), /No one called/);
  runCommand(state, 'addLessonToWeek', { school: 'My School', grade: 'Grade 2', week: weeks[0].weekStart, lesson: 'Rhythm Train' });
  assert.equal(state.weekLessons[0].sharedFrom, THEIRS);
  assert.throws(() => runCommand(state, 'editLesson', { lesson: 'Rhythm Train', name: 'Mine now' }), /only they can change it/);
  assert.throws(() => runCommand(state, 'deleteLesson', { lesson: 'Rhythm Train' }), /only they can change it/);
});
