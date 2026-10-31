// One Teacher Resources per teacher: moving another year's plan over adds its templates and pictures
// to the Resources the teacher already has, without doubles, and its schedule follows the matches.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { add, normalize } from '../public/js/model.js';
import { seedState } from '../public/js/seed.js';
import { splitState } from '../public/js/pieces.js';
import { newYearPlan } from '../public/js/workspaceFile.js';
import { mergeResources, relinkSchedule } from '../public/js/resourceMerge.js';

const drive = (id) => ({ kind: 'drive', uri: `https://drive.google.com/open?id=${id}`, fileId: id });

/** A plan with a picture, a tag and Drive templates, as one year's pieces. */
function yearPieces() {
  const s = normalize(seedState());
  s.lessons.forEach((l, i) => { l.locations = [drive(`deck-${i}`)]; });
  const group = add(s, 'tagGroups', { yearId: s.activeYearId, name: 'Season' });
  const tag = add(s, 'tags', { yearId: s.activeYearId, groupId: group.id, name: 'Winter' });
  add(s, 'images', { yearId: s.activeYearId, name: 'Snow picture', tagIds: [tag.id], lessonIds: [s.lessons[0].id], locations: [drive('pic-1')] });
  add(s, 'weekLessons', { yearId: s.activeYearId, schoolId: s.schools[0].id, gradeId: s.grades[0].id, weekStart: '2026-09-14', lessonId: s.lessons[1].id, criterionId: null, position: 0 });
  return { state: normalize(s), pieces: splitState(normalize(s)) };
}

test('the same plan moved over twice adds nothing twice', () => {
  const { pieces } = yearPieces();
  const { resources, map } = mergeResources(pieces.resources, pieces.resources);
  assert.deepEqual(resources, pieces.resources);
  assert.ok(Object.entries(map).every(([a, b]) => a === b));
});

test('last year’s plan (made separately, other ids) matches by Drive file and by name; only new things are added', () => {
  const now = yearPieces().pieces;
  const last = yearPieces().pieces; // every id different, the same Drive files and tag names
  last.resources.lessons.push({ ...structuredClone(last.resources.lessons[0]), id: 'les_only_last_year', name: 'Old favourite', locations: [drive('deck-old')] });
  const { resources, map } = mergeResources(now.resources, last.resources);
  assert.equal(resources.lessons.length, now.resources.lessons.length + 1);
  assert.equal(resources.images.length, 1);
  assert.equal(resources.tags.length, 1);
  assert.equal(resources.tagGroups.length, 1);
  assert.equal(map[last.resources.lessons[0].id], now.resources.lessons[0].id);
  const added = resources.lessons.find((l) => l.id === 'les_only_last_year');
  assert.equal(added.folderId, map[last.resources.lessons[0].folderId] ?? null, 'its folder follows the match');
});

test('things carried into a new year are recognised by where they came from', () => {
  const { state, pieces } = yearPieces();
  const next = splitState(newYearPlan(state, { name: '2027–28', startDate: '2027-08-23', endDate: '2028-06-09' }).state);
  const { resources } = mergeResources(pieces.resources, next.resources);
  assert.equal(resources.lessons.length, pieces.resources.lessons.length);
});

test('the moved plan’s schedule and lesson order point at the matched templates', () => {
  const now = yearPieces().pieces;
  const last = yearPieces().pieces;
  const { resources, map } = mergeResources(now.resources, last.resources);
  const schedule = relinkSchedule(last.schedule, map);
  const ids = new Set(resources.lessons.map((l) => l.id));
  assert.ok(schedule.weekLessons.every((w) => ids.has(w.lessonId)));
  assert.ok(schedule.criterionLessons.every((c) => ids.has(c.lessonId)));
  assert.equal(schedule.weekLessons[0].schoolId, last.schedule.weekLessons[0].schoolId, 'School Year links untouched');
});
