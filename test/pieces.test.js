// A plan in three shareable pieces (School Year, Teacher Schedule, Teacher Resources): nothing leaks
// into the wrong file, each piece works without the others, and missing pieces heal when they return.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { add, COLLECTIONS, normalize, remove } from '../public/js/model.js';
import { seedState } from '../public/js/seed.js';
import {
  changedPieces, composeState, emptyPiece, keepViewOnly, fromPieceFile, PIECE_NAMES, PIECES, pieceOf, splitState, toPieceFile,
} from '../public/js/pieces.js';
import { mergePiece } from '../public/js/planMerge.js';

/** A one-year plan with something in every piece: schedule entries, a picture, a tag, reports settings. */
function fullPlan() {
  const s = normalize(seedState());
  const year = s.years[0];
  const lesson = s.lessons[0];
  add(s, 'weekLessons', {
    yearId: year.id, schoolId: s.schools[0].id, gradeId: s.grades[0].id, weekStart: '2026-09-14', lessonId: lesson.id, criterionId: s.criteria[0].id, position: 1,
  });
  const group = add(s, 'tagGroups', { yearId: year.id, name: 'Season' });
  const tag = add(s, 'tags', { yearId: year.id, groupId: group.id, name: 'winter' });
  add(s, 'images', { yearId: year.id, name: 'Snowy picture', tagIds: [tag.id], lessonIds: [lesson.id] });
  add(s, 'holidays', { yearId: year.id, name: 'Winter Break', startDate: '2026-12-21', endDate: '2027-01-01' });
  year.reports = { label: '{{copy_name}}', footer: false };
  year.output = { kind: 'drive', folderId: 'folder-fake', name: 'Copies' };
  return normalize(s);
}

const withoutYear = (r) => { const { yearId: _y, ...rest } = r; return rest; };

test('every collection is saved in exactly one piece', () => {
  for (const c of Object.keys(COLLECTIONS)) {
    const homes = PIECE_NAMES.filter((name) => PIECES[name].collections.includes(c));
    assert.equal(homes.length, 1, `${c} is in ${homes.join(', ') || 'no piece'}`);
  }
  assert.equal(pieceOf('weekLessons'), 'schedule');
  assert.equal(pieceOf('criterionLessons'), 'schedule');
  assert.equal(pieceOf('lessons'), 'resources');
  assert.equal(pieceOf('placements'), 'schoolYear');
});

test('each piece file holds only its own data (nothing leaks into another file)', () => {
  const pieces = splitState(fullPlan());
  const allowed = {
    schoolYear: ['kind', 'schemaVersion', 'meta'],
    schedule: ['kind', 'schemaVersion', 'meta', 'settings', 'yearSettings', 'looks'],
    resources: ['kind', 'schemaVersion', 'meta'],
  };
  for (const name of PIECE_NAMES) {
    const keys = Object.keys(JSON.parse(toPieceFile(pieces[name]))).sort();
    assert.deepEqual(keys, [...allowed[name], ...PIECES[name].collections].sort(), name);
  }
  const shared = toPieceFile(pieces.schoolYear);
  for (const word of ['folder-fake', 'copy_name', 'Snowy picture', 'winter', 'weekStart', '"color":"#c27c4e"']) {
    assert.ok(!shared.includes(word), `the shared School Year must not hold ${word}`);
  }
  for (const g of pieces.schoolYear.grades) assert.equal(g.color, undefined, 'grade colors are personal');
  for (const i of pieces.schoolYear.instruments) assert.equal(i.color, undefined, 'instrument colors are personal');
  for (const y of pieces.schoolYear.years) assert.ok(!('output' in y) && !('reports' in y));
  assert.ok(pieces.schoolYear.outcomes.every((o) => o.color), 'outcome colors stay shared');
  // The teacher's library is kept across years, so its records name no year.
  for (const c of PIECES.resources.collections) assert.ok(pieces.resources[c].every((r) => !('yearId' in r)), c);
});

test('splitting and putting back together gives the same plan', () => {
  const s = fullPlan();
  assert.deepEqual(composeState(splitState(s)), s);
});

test('saved piece files read back the same, and other files are refused', () => {
  const pieces = splitState(fullPlan());
  for (const name of PIECE_NAMES) assert.deepEqual(fromPieceFile(toPieceFile(pieces[name]), name), pieces[name]);
  assert.throws(() => fromPieceFile(toPieceFile(pieces.schedule), 'resources'), /not_a_piece/);
  assert.throws(() => fromPieceFile('{"years":[]}'), /not_a_piece/);
  assert.throws(() => fromPieceFile('not json'), /not_a_piece/);
});

test('without Teacher Resources the schedule still opens, and heals when the resources come back', () => {
  const s = fullPlan();
  const pieces = splitState(s);
  const without = composeState({ ...pieces, resources: null });
  assert.equal(without.lessons.length, 0);
  assert.equal(without.images.length, 0);
  // Schedule entries and lesson order keep pointing at the missing templates…
  assert.deepEqual(without.weekLessons, s.weekLessons);
  assert.deepEqual(without.criterionLessons, s.criterionLessons);
  // …so saving while they're missing loses nothing, and they reconnect when the resources return.
  const savedWithout = splitState(without, pieces);
  assert.deepEqual(composeState({ ...savedWithout, resources: pieces.resources }), s);
});

test('without the School Year the teacher pieces keep their data and the year they belong to', () => {
  const s = fullPlan();
  const pieces = splitState(s);
  const without = composeState({ ...pieces, schoolYear: null });
  assert.equal(without.years.length, 0);
  assert.equal(without.activeYearId, s.activeYearId);
  assert.ok(without.lessons.every((l) => l.yearId === s.activeYearId), 'templates still show under the year');
  const savedWithout = splitState(without, pieces);
  assert.deepEqual(savedWithout.schedule.yearSettings, pieces.schedule.yearSettings, 'reports and copies folder kept');
  assert.deepEqual(savedWithout.schedule.looks, pieces.schedule.looks, 'colors kept');
  assert.deepEqual(composeState({ ...savedWithout, schoolYear: pieces.schoolYear }), s);
});

test('without a Teacher Schedule the shared year opens with default colors and no lessons', () => {
  const pieces = splitState(fullPlan());
  const shared = composeState({ schoolYear: pieces.schoolYear });
  assert.equal(shared.weekLessons.length, 0);
  assert.equal(shared.criterionLessons.length, 0);
  assert.ok(shared.grades.every((g) => /^#/.test(g.color)));
  assert.ok(shared.instruments.every((i) => /^#/.test(i.color)));
  assert.equal(shared.years[0].output, undefined);
});

test('two teachers sharing a School Year each keep their own grade colors', () => {
  const pieces = splitState(fullPlan());
  const grade = pieces.schoolYear.grades[0];
  const mine = { ...pieces.schedule, looks: { grades: { [grade.id]: '#111111' }, instruments: {} } };
  const theirs = { ...pieces.schedule, looks: { grades: { [grade.id]: '#222222' }, instruments: {} } };
  assert.equal(composeState({ schoolYear: pieces.schoolYear, schedule: mine }).grades[0].color, '#111111');
  assert.equal(composeState({ schoolYear: pieces.schoolYear, schedule: theirs }).grades[0].color, '#222222');
});

test('only the pieces that changed need saving', () => {
  const s = fullPlan();
  const before = splitState(s);
  const after = structuredClone(s);
  after.weekLessons[0].position = 2;
  assert.deepEqual(changedPieces(before, splitState(after, before)), ['schedule']);
  after.schools[0].name = 'Renamed School';
  assert.deepEqual(changedPieces(before, splitState(after, before)), ['schoolYear', 'schedule']);
});

test('deleting a template on purpose removes its uses in my schedule in the same change', () => {
  const s = fullPlan();
  const lessonId = s.weekLessons[0].lessonId;
  remove(s, 'lessons', lessonId);
  const pieces = splitState(s);
  assert.ok(!pieces.schedule.weekLessons.some((w) => w.lessonId === lessonId));
  assert.ok(!pieces.resources.images.some((i) => i.lessonIds.includes(lessonId)));
});

test('saving keeps what the planner noted about each piece (links, owner)', () => {
  const s = fullPlan();
  const meta = { links: { schoolYear: { fileId: 'file-a' }, resources: { fileId: 'file-b' } }, ownerId: 'person-1' };
  const previous = { schedule: emptyPiece('schedule', meta) };
  const pieces = splitState(s, previous);
  assert.deepEqual(pieces.schedule.meta.links, meta.links);
  assert.equal(pieces.schedule.meta.ownerId, 'person-1');
  assert.equal(pieces.schedule.meta.year.id, s.activeYearId);
  assert.deepEqual(pieces.resources.meta, {});
});

test('every piece record but the year itself carries no yearId in teacher files', () => {
  const pieces = splitState(fullPlan());
  for (const w of pieces.schedule.weekLessons) assert.deepEqual(w, withoutYear(w));
});

// ---------- combining two computers' versions of one piece ----------

test('a piece changed on two computers keeps both changes, and never tidies away links into other pieces', () => {
  const base = splitState(fullPlan()).schedule;
  const mine = structuredClone(base);
  const theirs = structuredClone(base);
  mine.weekLessons[0].lessonId = 'les_missing_for_now'; // a template in Resources that isn't reachable right now
  theirs.looks.grades = { ...theirs.looks.grades, extra: '#123456' };
  theirs.yearSettings.reports = { ...theirs.yearSettings.reports, footer: true };
  const { state, conflicts } = mergePiece(PIECES.schedule.collections, base, mine, theirs);
  assert.deepEqual(conflicts, []);
  assert.equal(state.weekLessons[0].lessonId, 'les_missing_for_now', 'link into another piece kept');
  assert.equal(state.looks.grades.extra, '#123456');
  assert.equal(state.yearSettings.reports.footer, true);
  assert.deepEqual(Object.keys(state).sort(), Object.keys(base).sort(), 'no other collections creep in');
});

test('inside one piece, links to something deleted on the other computer are still tidied', () => {
  const s = fullPlan();
  const base = splitState(s).resources;
  const mine = structuredClone(base);
  const theirs = structuredClone(base);
  const tag = base.tags[0];
  theirs.tags = theirs.tags.filter((t) => t.id !== tag.id);
  mine.images[0].name = 'Renamed picture';
  const { state } = mergePiece(PIECES.resources.collections, base, mine, theirs);
  assert.deepEqual(state.images[0].tagIds, []);
  assert.equal(state.images[0].name, 'Renamed picture');
});

// ---------- view-only pieces ----------

test('a view-only piece can never be changed; the rest of the same change still happens', () => {
  const before = fullPlan();
  const after = structuredClone(before);
  after.weekLessons[0].position = 5; // someone else's schedule, shared as Viewer
  after.schools[0].name = 'Renamed School'; // the shared School Year, which I can edit
  const { state, changed, blocked } = keepViewOnly(before, after, ['schedule']);
  assert.deepEqual(changed, ['schoolYear']);
  assert.deepEqual(blocked, ['schedule']);
  assert.equal(state.weekLessons[0].position, before.weekLessons[0].position);
  assert.equal(state.schools[0].name, 'Renamed School');
});

test('deleting a shared eval while looking at a view-only schedule leaves that schedule alone', () => {
  const before = fullPlan();
  const after = structuredClone(before);
  const crit = after.weekLessons[0].criterionId;
  remove(after, 'criteria', crit);
  const { state, blocked } = keepViewOnly(before, after, ['schedule', 'resources']);
  assert.deepEqual(blocked, ['schedule']);
  assert.ok(!state.criteria.some((c) => c.id === crit));
  assert.equal(state.weekLessons[0].criterionId, crit, 'their schedule still points at it (greyed, heals if it returns)');
  assert.deepEqual(state.criterionLessons, before.criterionLessons);
});

test('a change with nothing view-only in it passes straight through', () => {
  const before = fullPlan();
  const after = structuredClone(before);
  after.lessons[0].name = 'New name';
  const result = keepViewOnly(before, after, ['schoolYear']);
  assert.equal(result.state, after);
  assert.deepEqual([result.changed, result.blocked], [['resources'], []]);
});
