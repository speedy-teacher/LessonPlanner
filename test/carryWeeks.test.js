// Starting a new school year can bring last year's week-by-week lesson schedule along, by week number:
// week 1 → week 1, same order; weeks past the end of the new year are left out.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalize } from '../public/js/model.js';
import { seedState } from '../public/js/seed.js';
import { addWeekLesson, schoolWeeks } from '../public/js/weekPlan.js';
import { newYearPlan } from '../public/js/workspaceFile.js';

/** Last year with lessons in weeks 1 (two, in order), 3 and its very last week. */
function lastYear() {
  const s = normalize(seedState());
  const year = s.years.find((y) => y.id === s.activeYearId);
  const weeks = schoolWeeks(year);
  const cls = { yearId: year.id, schoolId: s.schools[0].id, gradeId: s.grades[0].id };
  const put = (n, lesson, index) => addWeekLesson(s, { ...cls, weekStart: weeks[n - 1].weekStart, lessonId: lesson.id, index });
  put(1, s.lessons[0], 0);
  put(1, s.lessons[1], 1);
  put(3, s.lessons[2], 0);
  put(weeks.length, s.lessons[3], 0);
  return { s, weeks, year };
}

const FIELDS = { name: 'Next year', startDate: '2031-08-25', endDate: '2032-05-28' }; // a shorter year

test('week 1 goes to week 1 and week 3 to week 3, in the same order', () => {
  const { s } = lastYear();
  const next = newYearPlan(s, FIELDS, { copy: true, weeks: true });
  const newWeeks = schoolWeeks(next.state.years[0]);
  const inWeek = (n) => next.state.weekLessons.filter((e) => e.weekStart === newWeeks[n - 1].weekStart)
    .sort((a, b) => a.position - b.position).map((e) => e.lessonId);
  assert.deepEqual(inWeek(1), [s.lessons[0].id, s.lessons[1].id]);
  assert.deepEqual(inWeek(3), [s.lessons[2].id]);
  assert.ok(next.state.weekLessons.every((e) => e.yearId === next.state.years[0].id));
});

test('weeks past the end of the new year are left out, and counted', () => {
  const { s, weeks } = lastYear();
  const next = newYearPlan(s, FIELDS, { copy: true, weeks: true });
  assert.ok(schoolWeeks(next.state.years[0]).length < weeks.length, 'the new year is shorter');
  assert.deepEqual(next.carried, { kept: 3, dropped: 1 });
});

test('the carried lessons point at the classes and templates the new year kept', () => {
  const { s } = lastYear();
  const { state } = newYearPlan(s, FIELDS, { copy: true, weeks: true });
  const has = (c, id) => state[c].some((r) => r.id === id);
  assert.ok(state.weekLessons.every((e) => has('schools', e.schoolId) && has('grades', e.gradeId) && has('lessons', e.lessonId)));
});

test('not asked for (or nothing copied): the schedule starts empty as before', () => {
  const { s } = lastYear();
  assert.equal(newYearPlan(s, FIELDS, { copy: true }).state.weekLessons.length, 0);
  assert.equal(newYearPlan(s, FIELDS, { copy: true }).carried, null);
  assert.equal(newYearPlan(s, FIELDS, { copy: false, weeks: true }).state.weekLessons.length, 0);
});
