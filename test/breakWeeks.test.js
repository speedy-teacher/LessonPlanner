// Behavior tests: break weeks are not numbered, and numbering resumes after each break.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { add, createYear, emptyState, weekNumber } from '../public/js/model.js';
import { isBreakWeek, weekdaysBetween } from '../public/js/dates.js';
import { schoolWeeks, teachingWeeks } from '../public/js/weekPlan.js';

// A school year from Monday 2026-08-24 to Friday 2026-12-18. Thanksgiving (built in) is Thu 2026-11-26.
function yearWithBreak(breakStart, breakEnd) {
  const s = emptyState();
  const year = createYear(s, { name: 'Year B', startDate: '2026-08-24', endDate: '2026-12-18' });
  if (breakStart) add(s, 'holidays', { yearId: year.id, name: 'Fall Break', startDate: breakStart, endDate: breakEnd });
  return { s, year };
}

test('a whole-week break is not numbered and the weeks after it resume the count', () => {
  const { s, year } = yearWithBreak('2026-11-23', '2026-11-27');
  const weeks = teachingWeeks(s, year.id);
  assert.equal(weeks.some((w) => w.weekStart === '2026-11-23'), false);
  const before = weeks.find((w) => w.weekStart === '2026-11-16');
  const after = weeks.find((w) => w.weekStart === '2026-11-30');
  assert.equal(after.number, before.number + 1);
  assert.deepEqual(weeks.map((w) => w.number), weeks.map((_, i) => i + 1));
});

test('a break that covers only part of a week leaves that week numbered', () => {
  const { s, year } = yearWithBreak('2026-11-26', '2026-11-27');
  const weeks = teachingWeeks(s, year.id);
  const partial = weeks.find((w) => w.weekStart === '2026-11-23');
  assert.ok(partial, 'the partial-break week is still a teaching week');
  assert.equal(partial.days.length, 5, 'the week keeps all five school days');
});

test('a single holiday, such as Thanksgiving, does not skip a week by itself', () => {
  const { s, year } = yearWithBreak(null);
  const weeks = teachingWeeks(s, year.id);
  assert.ok(weeks.some((w) => w.weekStart === '2026-11-23'));
});

test('a date in a break week has no week number; the next date counts from the break', () => {
  const { s, year } = yearWithBreak('2026-11-23', '2026-11-27');
  assert.equal(weekNumber(year.startDate, '2026-11-24', [{ startDate: '2026-11-23', endDate: '2026-11-27' }]), null);
  assert.equal(weekNumber(year.startDate, '2026-11-30', [{ startDate: '2026-11-23', endDate: '2026-11-27' }]),
    weekNumber(year.startDate, '2026-11-16', [{ startDate: '2026-11-23', endDate: '2026-11-27' }]) + 1);
});

test('without events, every week is numbered as before', () => {
  const { year } = yearWithBreak(null);
  const weeks = schoolWeeks(year);
  assert.equal(weeks.length, 17);
  assert.equal(weeks[0].number, 1);
});

test('isBreakWeek needs every school day of the week covered', () => {
  const days = weekdaysBetween('2026-11-23', '2026-11-27');
  assert.equal(isBreakWeek(days, [{ startDate: '2026-11-23', endDate: '2026-11-27' }]), true);
  assert.equal(isBreakWeek(days, [{ startDate: '2026-11-23', endDate: '2026-11-26' }]), false);
  assert.equal(isBreakWeek([], [{ startDate: '2026-11-23', endDate: '2026-11-27' }]), false);
});
