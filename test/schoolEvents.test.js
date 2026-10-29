// The year's events: first and last day of school and U.S. holidays are there without typing them,
// your own events are added on top (and can replace a built-in date), and pictures fit around them.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { add, createYear, emptyState, inYear } from '../public/js/model.js';
import { addImage } from '../public/js/library.js';
import { addWeekLesson, schoolWeeks } from '../public/js/weekPlan.js';
import { pictureForEntry } from '../public/js/imagePick.js';
import { usHolidays, yearEvents } from '../public/js/schoolEvents.js';

const YEAR = { name: 'Year A', startDate: '2026-08-26', endDate: '2027-06-10' };

test('U.S. holidays inside the school year are worked out, including the ones that move every year', () => {
  const dates = Object.fromEntries(usHolidays(YEAR.startDate, YEAR.endDate).map((h) => [h.name, h.startDate]));
  assert.equal(dates['Labor Day'], '2026-09-07');
  assert.equal(dates['Columbus Day / Indigenous Peoples’ Day'], '2026-10-12');
  assert.equal(dates.Halloween, '2026-10-31');
  assert.equal(dates.Thanksgiving, '2026-11-26');
  assert.equal(dates['Martin Luther King Jr. Day'], '2027-01-18');
  assert.equal(dates['Presidents’ Day'], '2027-02-15');
  assert.equal(dates['Memorial Day'], '2027-05-31');
  assert.equal(dates.Juneteenth, undefined, 'after the last day of school');
  assert.equal(dates['Independence Day'], undefined, 'in the summer');
});

test('the first and last day of school are events, following the year’s dates', () => {
  const s = emptyState();
  const year = createYear(s, YEAR);
  const events = yearEvents(s, year.id);
  assert.deepEqual(events.slice(0, 1).map((e) => [e.name, e.startDate]), [['First Day of School', '2026-08-26']]);
  assert.ok(events.some((e) => e.name === 'Last Day of School' && e.startDate === '2027-06-10'));
  year.startDate = '2026-08-24';
  assert.equal(yearEvents(s, year.id)[0].startDate, '2026-08-24');
});

test('your own events join the list; one with a built-in event’s name replaces its date', () => {
  const s = emptyState();
  const year = createYear(s, YEAR);
  add(s, 'holidays', { yearId: year.id, name: 'Winter Break', startDate: '2026-12-21', endDate: '2027-01-01' });
  add(s, 'holidays', { yearId: year.id, name: 'halloween', startDate: '2026-10-30', endDate: '2026-10-30' });
  const events = yearEvents(s, year.id);
  assert.ok(events.some((e) => e.name === 'Winter Break' && !e.builtIn));
  assert.deepEqual(events.filter((e) => e.name.toLowerCase() === 'halloween').map((e) => e.startDate), ['2026-10-30']);
});

test('a new year has its own first/last day and holidays, and keeps your events a year later', () => {
  const s = emptyState();
  const year = createYear(s, YEAR);
  add(s, 'holidays', { yearId: year.id, name: 'Winter Break', startDate: '2026-12-21', endDate: '2027-01-01' });
  const next = createYear(s, { name: 'Year B', startDate: '2027-08-25', endDate: '2028-06-08' }, year.id);
  const events = yearEvents(s, next.id);
  assert.equal(events[0].startDate, '2027-08-25');
  assert.equal(events.find((e) => e.name === 'Thanksgiving').startDate, '2027-11-25');
  assert.equal(events.find((e) => e.name === 'Winter Break').startDate, '2027-12-21');
  assert.equal(inYear(s, 'holidays', next.id).length, 1);
});

test('pictures fit around built-in events without anyone adding them', () => {
  const s = emptyState();
  const year = createYear(s, YEAR);
  const school = add(s, 'schools', { yearId: year.id, name: 'School A' });
  const grade = add(s, 'grades', { yearId: year.id, name: 'Grade 1', short: '1' });
  const lesson = add(s, 'lessons', { yearId: year.id, name: 'Beat', autoFields: ['image'], instrumentIds: [], locations: [] });
  const turkey = Object.assign(addImage(s, { yearId: year.id, name: 'Turkey' }), {
    when: { anytime: false, priority: 3, windows: [{ type: 'holiday', holiday: 'Thanksgiving', anchor: 'start', daysBefore: 7, daysAfter: 0 }] },
  });
  const week = schoolWeeks(year).find((w) => w.weekStart === '2026-11-23');
  const entry = addWeekLesson(s, { yearId: year.id, schoolId: school.id, gradeId: grade.id, weekStart: week.weekStart, lessonId: lesson.id });
  assert.equal(pictureForEntry(s, entry).image.id, turkey.id);
});
