// Behavior tests: a teacher can skip a school week. It gets no number, the weeks after it renumber,
// it stays on the Lesson Schedule greyed out, and a new school year never copies skipped weeks.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { add, createYear, emptyState, weekNumber } from '../public/js/model.js';
import { runCommand } from '../public/js/agentCommands.js';
import { setWeekSkipped, yearWeeks } from '../public/js/weekPlan.js';

// School year from Monday 2026-08-24 to Friday 2026-12-18 (17 weeks, no holidays entered).
function setup() {
  const s = emptyState();
  const year = createYear(s, { name: 'Year C', startDate: '2026-08-24', endDate: '2026-12-18' });
  s.activeYearId = year.id;
  return { s, year };
}

test('a skipped week is off, has no number, and the weeks after it renumber', () => {
  const { s, year } = setup();
  setWeekSkipped(s, year.id, '2026-11-23', true);
  const weeks = yearWeeks(s.years.find((y) => y.id === year.id));
  const skipped = weeks.find((w) => w.weekStart === '2026-11-23');
  assert.equal(skipped.off, 'skipped');
  assert.equal(skipped.number, null);
  const before = weeks.find((w) => w.weekStart === '2026-11-16');
  const after = weeks.find((w) => w.weekStart === '2026-11-30');
  assert.equal(after.number, before.number + 1);
  assert.equal(weeks.length, 17, 'the skipped week is still on the schedule');
});

test('counting a week again gives it its number back', () => {
  const { s, year } = setup();
  setWeekSkipped(s, year.id, '2026-11-23', true);
  setWeekSkipped(s, year.id, '2026-11-23', false);
  assert.deepEqual(s.years.find((y) => y.id === year.id).skippedWeeks, []);
  assert.equal(yearWeeks(s.years.find((y) => y.id === year.id)).every((w) => !w.off), true);
});

test('skipped weeks are stored in date order, once each', () => {
  const { s, year } = setup();
  setWeekSkipped(s, year.id, '2026-11-23', true);
  setWeekSkipped(s, year.id, '2026-10-05', true);
  setWeekSkipped(s, year.id, '2026-11-23', true);
  assert.deepEqual(s.years.find((y) => y.id === year.id).skippedWeeks, ['2026-10-05', '2026-11-23']);
});

test('a placement in a skipped week has no week number', () => {
  const { s, year } = setup();
  setWeekSkipped(s, year.id, '2026-11-23', true);
  assert.equal(weekNumber(year.startDate, '2026-11-24', [], ['2026-11-23']), null);
});

test('a new school year does not copy skipped weeks from the year before', () => {
  const { s, year } = setup();
  setWeekSkipped(s, year.id, '2026-11-23', true);
  const next = createYear(s, { name: 'Year D', startDate: '2027-08-23', endDate: '2027-12-17' }, year.id);
  assert.equal(next.skippedWeeks, undefined);
  assert.equal(yearWeeks(next).every((w) => !w.off), true);
});

test('the skipWeek command skips and counts a week, given a date in it', () => {
  const { s, year } = setup();
  const result = runCommand(s, 'skipWeek', { week: '2026-11-25', skip: 'true' });
  assert.match(result.done, /Skipped the week of 2026-11-23/);
  assert.deepEqual(s.years.find((y) => y.id === year.id).skippedWeeks, ['2026-11-23']);
  runCommand(s, 'skipWeek', { week: '2026-11-23', skip: 'false' });
  assert.deepEqual(s.years.find((y) => y.id === year.id).skippedWeeks, []);
});

test('the skipWeek command needs a date, not a week number', () => {
  const { s } = setup();
  assert.throws(() => runCommand(s, 'skipWeek', { week: 14, skip: 'true' }), /Give the week as a date/);
});

test('add is still usable (the year record keeps its other fields)', () => {
  const { s, year } = setup();
  setWeekSkipped(s, year.id, '2026-11-23', true);
  add(s, 'grades', { yearId: year.id, name: 'Grade 1', short: '1' });
  assert.equal(s.years.find((y) => y.id === year.id).skippedWeeks[0], '2026-11-23');
});
