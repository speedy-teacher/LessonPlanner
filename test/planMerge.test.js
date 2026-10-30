// A shared plan changed on two computers: the planner combines both sets of changes and only
// asks about the things both computers changed differently.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { add, normalize, remove, update } from '../public/js/model.js';
import { seedState } from '../public/js/seed.js';
import { addWeekLesson, moveWeekLesson } from '../public/js/weekPlan.js';
import { conflictSummary, describeConflict, mergePlans, useTheirs } from '../public/js/planMerge.js';

/** The version both computers started from, and a copy for each computer to change. */
function start() {
  const base = normalize(seedState());
  return { base, mine: structuredClone(base), theirs: structuredClone(base) };
}

const find = (state, collection, id) => state[collection].find((r) => r.id === id);

test('changes to different things on each computer are both kept, with nothing to ask', () => {
  const { base, mine, theirs } = start();
  const [lessonA, lessonB] = base.lessons;
  update(mine, 'lessons', lessonA.id, { name: 'Beat walk (new)' });
  update(theirs, 'lessons', lessonB.id, { category: 'Singing games' });
  const school = add(theirs, 'schools', { yearId: base.activeYearId, name: 'Pinecone Elementary' });
  const { state, conflicts } = mergePlans(base, mine, theirs);
  assert.deepEqual(conflicts, []);
  assert.equal(find(state, 'lessons', lessonA.id).name, 'Beat walk (new)');
  assert.equal(find(state, 'lessons', lessonB.id).category, 'Singing games');
  assert.ok(find(state, 'schools', school.id));
});

test('different fields of the same record changed on each computer are both kept', () => {
  const { base, mine, theirs } = start();
  const lesson = base.lessons[0];
  update(mine, 'lessons', lesson.id, { name: 'Steady beat walk' });
  update(theirs, 'lessons', lesson.id, { category: 'Warm-ups' });
  const { state, conflicts } = mergePlans(base, mine, theirs);
  assert.deepEqual(conflicts, []);
  assert.deepEqual([find(state, 'lessons', lesson.id).name, find(state, 'lessons', lesson.id).category], ['Steady beat walk', 'Warm-ups']);
});

test('the same change made on both computers is not a conflict', () => {
  const { base, mine, theirs } = start();
  const lesson = base.lessons[0];
  update(mine, 'lessons', lesson.id, { name: 'Same new name' });
  update(theirs, 'lessons', lesson.id, { name: 'Same new name' });
  assert.deepEqual(mergePlans(base, mine, theirs).conflicts, []);
});

test('the same thing changed differently keeps mine for now, names it, and can switch to the other computer’s', () => {
  const { base, mine, theirs } = start();
  const lesson = base.lessons[0];
  update(mine, 'lessons', lesson.id, { name: 'Rhythm Review' });
  update(theirs, 'lessons', lesson.id, { name: 'Beat Review' });
  const { state, conflicts } = mergePlans(base, mine, theirs);
  assert.equal(find(state, 'lessons', lesson.id).name, 'Rhythm Review');
  assert.equal(conflicts.length, 1);
  assert.equal(describeConflict(state, theirs, conflicts[0]), 'Lesson “Rhythm Review” (changed on both computers)');
  useTheirs(state, conflicts, theirs);
  assert.equal(find(state, 'lessons', lesson.id).name, 'Beat Review');
});

test('something deleted on one computer and untouched on the other is deleted, with what belonged to it', () => {
  const { base, mine, theirs } = start();
  const crit = base.criteria[0];
  remove(theirs, 'criteria', crit.id);
  const { state, conflicts } = mergePlans(base, mine, theirs);
  assert.deepEqual(conflicts, []);
  assert.equal(find(state, 'criteria', crit.id), undefined);
  assert.equal(state.criterionLessons.filter((s) => s.criterionId === crit.id).length, 0);
  assert.equal(state.placements.filter((p) => p.criterionId === crit.id).length, 0);
});

test('deleted on the other computer but changed here: kept for now, and deleting it is one click', () => {
  const { base, mine, theirs } = start();
  const lesson = base.lessons[0];
  update(mine, 'lessons', lesson.id, { name: 'Changed here' });
  remove(theirs, 'lessons', lesson.id);
  const { state, conflicts } = mergePlans(base, mine, theirs);
  assert.equal(find(state, 'lessons', lesson.id).name, 'Changed here');
  assert.deepEqual(conflicts.map((c) => c.kind), ['removedThere']);
  useTheirs(state, conflicts, theirs);
  assert.equal(find(state, 'lessons', lesson.id), undefined);
  assert.equal(state.criterionLessons.filter((s) => s.lessonId === lesson.id).length, 0);
});

test('deleted here but changed on the other computer: stays deleted for now, and bringing it back restores its parts', () => {
  const { base, mine, theirs } = start();
  const crit = base.criteria[0];
  const steps = base.criterionLessons.filter((s) => s.criterionId === crit.id).length;
  remove(mine, 'criteria', crit.id);
  update(theirs, 'criteria', crit.id, { title: 'Moves to a steady beat (revised)' });
  const { state, conflicts } = mergePlans(base, mine, theirs);
  assert.equal(find(state, 'criteria', crit.id), undefined);
  assert.equal(describeConflict(state, theirs, conflicts[0]), 'Eval “Moves to a steady beat (revised)” (deleted here, changed on the other computer)');
  useTheirs(state, conflicts, theirs);
  assert.equal(find(state, 'criteria', crit.id).title, 'Moves to a steady beat (revised)');
  assert.equal(state.criterionLessons.filter((s) => s.criterionId === crit.id).length, steps);
});

test('lists of ids keep what both computers added and drop what either took out', () => {
  const { base, mine, theirs } = start();
  const crit = base.criteria[0];
  const [g1, g2, g3] = crit.gradeIds;
  const extra = base.grades.find((g) => !crit.gradeIds.includes(g.id));
  update(mine, 'criteria', crit.id, { gradeIds: [g1, g2, g3, extra.id] });
  update(theirs, 'criteria', crit.id, { gradeIds: [g1, g3] });
  const { state, conflicts } = mergePlans(base, mine, theirs);
  assert.deepEqual(conflicts, []);
  assert.deepEqual(find(state, 'criteria', crit.id).gradeIds, [g1, g3, extra.id]);
});

test('a schedule entry added on one computer for a lesson deleted on the other is tidied away', () => {
  const { base, mine, theirs } = start();
  const lesson = base.lessons[0];
  const [school, grade] = [base.schools[0], base.grades[0]];
  addWeekLesson(mine, { yearId: base.activeYearId, schoolId: school.id, gradeId: grade.id, weekStart: '2026-09-07', lessonId: lesson.id });
  remove(theirs, 'lessons', lesson.id);
  const { state, conflicts } = mergePlans(base, mine, theirs);
  assert.deepEqual(conflicts, []);
  assert.equal(find(state, 'lessons', lesson.id), undefined);
  assert.deepEqual(state.weekLessons, []);
});

test('lessons added to the same week on both computers are all kept, numbered in order', () => {
  const { base } = start();
  const cls = { yearId: base.activeYearId, schoolId: base.schools[0].id, gradeId: base.grades[0].id, weekStart: '2026-09-07' };
  addWeekLesson(base, { ...cls, lessonId: base.lessons[0].id });
  const mine = structuredClone(base);
  const theirs = structuredClone(base);
  addWeekLesson(mine, { ...cls, lessonId: base.lessons[1].id });
  addWeekLesson(theirs, { ...cls, lessonId: base.lessons[2].id });
  const { state, conflicts } = mergePlans(base, mine, theirs);
  assert.deepEqual(conflicts, []);
  const week = state.weekLessons.sort((a, b) => a.position - b.position);
  assert.equal(week[0].lessonId, base.lessons[0].id);
  assert.deepEqual(new Set(week.slice(1).map((e) => e.lessonId)), new Set([base.lessons[1].id, base.lessons[2].id]));
  assert.deepEqual(week.map((e) => e.position), [0, 1, 2]);
});

test('reordering the same week on both computers never asks and leaves a clean order', () => {
  const { base } = start();
  const cls = { yearId: base.activeYearId, schoolId: base.schools[0].id, gradeId: base.grades[0].id, weekStart: '2026-09-07' };
  const [a, b, c] = [0, 1, 2].map((i) => addWeekLesson(base, { ...cls, lessonId: base.lessons[i].id }));
  const mine = structuredClone(base);
  const theirs = structuredClone(base);
  moveWeekLesson(mine, c.id, cls.weekStart, 0);
  moveWeekLesson(theirs, a.id, cls.weekStart, 2);
  const { state, conflicts } = mergePlans(base, mine, theirs);
  assert.deepEqual(conflicts, []);
  assert.deepEqual(state.weekLessons.map((e) => e.position).sort(), [0, 1, 2]);
  assert.ok(find(state, 'weekLessons', b.id));
});

test('a deck’s “last seen” date never causes a question: the newest wins', () => {
  const { base } = start();
  const lesson = base.lessons[0];
  lesson.locations = [{ kind: 'drive', uri: 'https://drive.google.com/open?id=FAKE1', fileId: 'FAKE1', lastSeenAt: '2026-10-01' }];
  const mine = structuredClone(base);
  const theirs = structuredClone(base);
  find(mine, 'lessons', lesson.id).locations[0].lastSeenAt = '2026-10-20';
  find(theirs, 'lessons', lesson.id).locations[0].lastSeenAt = '2026-10-25';
  const { state, conflicts } = mergePlans(base, mine, theirs);
  assert.deepEqual(conflicts, []);
  assert.equal(find(state, 'lessons', lesson.id).locations[0].lastSeenAt, '2026-10-25');
});

test('combining leaves both computers’ versions untouched', () => {
  const { base, mine, theirs } = start();
  update(mine, 'lessons', base.lessons[0].id, { name: 'Mine' });
  update(theirs, 'lessons', base.lessons[0].id, { name: 'Theirs' });
  const before = JSON.stringify([base, mine, theirs]);
  const { state, conflicts } = mergePlans(base, mine, theirs);
  useTheirs(state, conflicts, theirs);
  assert.equal(JSON.stringify([base, mine, theirs]), before);
});

test('many conflicts are summed up briefly', () => {
  const { base, mine, theirs } = start();
  base.lessons.slice(0, 6).forEach((l, i) => {
    update(mine, 'lessons', l.id, { name: `Mine ${i}` });
    update(theirs, 'lessons', l.id, { name: `Theirs ${i}` });
  });
  const { state, conflicts } = mergePlans(base, mine, theirs);
  const summary = conflictSummary(state, theirs, conflicts);
  assert.match(summary, /^Lesson “Mine 0” \(changed on both computers\); /);
  assert.match(summary, /; and 2 more$/);
});
