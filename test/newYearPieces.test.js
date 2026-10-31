// A new school year made from a plan in pieces: new School Year + new Lesson Schedule, the same Teacher Resources.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { add, normalize } from '../public/js/model.js';
import { seedState } from '../public/js/seed.js';
import { composeState, splitState } from '../public/js/pieces.js';
import { newYearPlan } from '../public/js/workspaceFile.js';
import { mergeResources } from '../public/js/resourceMerge.js';

const FIELDS = { name: '2027-28', startDate: '2027-08-23', endDate: '2028-06-09' };

/** The teacher's plan as the app sees it when a plan in pieces is open. */
function openPlan() {
  const s = normalize(seedState());
  s.lessons[0].locations = [{ kind: 'drive', uri: 'https://drive.google.com/open?id=deck-1', fileId: 'deck-1' }];
  add(s, 'weekLessons', {
    yearId: s.activeYearId, schoolId: s.schools[0].id, gradeId: s.grades[0].id, weekStart: '2026-09-14', lessonId: s.lessons[0].id, criterionId: s.criteria[0].id, position: 0,
  });
  s.grades[0].color = '#654321';
  return composeState(splitState(normalize(s)));
}

test('the new Lesson Schedule starts with no weeks but keeps lesson order and colors', () => {
  const old = openPlan();
  const next = splitState(newYearPlan(old, FIELDS, { copy: true }).state);
  assert.equal(next.schedule.weekLessons.length, 0);
  assert.deepEqual(next.schedule.criterionLessons.map((c) => [c.criterionId, c.lessonId]), old.criterionLessons.map((c) => [c.criterionId, c.lessonId]));
  assert.equal(next.schedule.looks.grades[old.grades[0].id], '#654321');
});

test('the new School Year has empty calendars and the same schools, grades and outcomes (same ids)', () => {
  const old = openPlan();
  const next = splitState(newYearPlan(old, FIELDS, { copy: true }).state);
  assert.equal(next.schoolYear.placements.length, 0);
  assert.equal(next.schoolYear.instrumentBlocks.length, 0);
  for (const collection of ['schools', 'grades', 'outcomes']) {
    assert.deepEqual(next.schoolYear[collection].map((r) => r.id), old[collection].map((r) => r.id), collection);
  }
});

test('the same Teacher Resources fits the new year: nothing is added and every id maps to itself', () => {
  const old = openPlan();
  const before = splitState(old).resources;
  const next = splitState(newYearPlan(old, FIELDS, { copy: true }).state);
  const { resources, map } = mergeResources(before, next.resources);
  assert.deepEqual(resources, before);
  assert.ok(Object.entries(map).every(([a, b]) => a === b));
});

test('a year started without copying adds nothing to the Teacher Resources', () => {
  const old = openPlan();
  const before = splitState(old).resources;
  const next = splitState(newYearPlan(old, FIELDS, { copy: false }).state);
  const { resources } = mergeResources(before, next.resources);
  assert.deepEqual(resources, before);
});
