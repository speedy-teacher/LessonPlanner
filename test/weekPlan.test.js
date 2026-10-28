// Behavior tests for the Lesson Schedule (lessons per school week, in order).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { add, addStep, addInstrumentBlock, createYear, emptyState, normalize, placeCriterion, remove } from '../public/js/model.js';
import {
  addWeekLesson, autoFillWeek, autoFillWeeks, entryOutcome, filterLessons, instrumentsInWeek, missingInstruments,
  moveWeekLesson, placementsInWeek, removeWeekLesson, schoolWeeks, weekLessonsFor,
} from '../public/js/weekPlan.js';

function setup() {
  const s = emptyState();
  // Starts on a Wednesday, ends on a Tuesday.
  const year = createYear(s, { name: 'Year A', startDate: '2026-08-26', endDate: '2026-10-06' });
  const school = add(s, 'schools', { yearId: year.id, name: 'Test School' });
  const grade = add(s, 'grades', { yearId: year.id, name: 'Grade 3', short: '3' });
  const grade4 = add(s, 'grades', { yearId: year.id, name: 'Grade 4', short: '4' });
  const uke = add(s, 'instruments', { yearId: year.id, name: 'Ukulele', color: '#b5654a' });
  const deck = (name, category = '', instrumentIds = []) => add(s, 'lessons', { yearId: year.id, name, category, autoFields: [], instrumentIds });
  const [a, b, c, d] = [deck('Alpha', 'Singing'), deck('Bravo', 'Ukulele', [uke.id]), deck('Charlie'), deck('Delta', 'Ukulele')];
  const outcome = add(s, 'outcomes', { yearId: year.id, code: 'MU1', title: 'Steady beat', color: '#6b8f5e' });
  const outcome2 = add(s, 'outcomes', { yearId: year.id, code: 'MU2', title: 'Pitch', color: '#6a4c93' });
  const crit = add(s, 'criteria', { outcomeId: outcome.id, title: 'Plays the beat', gradeIds: [grade.id] });
  const crit2 = add(s, 'criteria', { outcomeId: outcome2.id, title: 'Sings in tune', gradeIds: [grade4.id] });
  [a, b, c].forEach((l) => addStep(s, crit.id, l.id));
  addStep(s, crit2.id, d.id);
  const cls = { yearId: year.id, schoolId: school.id, gradeId: grade.id };
  const weeks = schoolWeeks(year);
  return { s, year, school, grade, grade4, uke, a, b, c, d, outcome, crit, crit2, cls, weeks };
}

const names = (s, list) => list.map((e) => s.lessons.find((l) => l.id === e.lessonId).name);

test('every school week of the year is a numbered row with its dates', () => {
  const { weeks } = setup();
  assert.equal(weeks.length, 7);
  assert.deepEqual(weeks.map((w) => w.number), [1, 2, 3, 4, 5, 6, 7]);
  assert.equal(weeks[0].weekStart, '2026-08-24');
  // The first and last weeks only count the days inside the school year.
  assert.deepEqual(weeks[0].days, ['2026-08-26', '2026-08-27', '2026-08-28']);
  assert.deepEqual(weeks.at(-1).days, ['2026-10-05', '2026-10-06']);
  assert.equal(weeks[1].days.length, 5);
});

test('lessons are added to a week in order, and can be put at a chosen place', () => {
  const { s, a, b, c, cls, weeks } = setup();
  const week = weeks[1].weekStart;
  addWeekLesson(s, { ...cls, weekStart: week, lessonId: a.id });
  addWeekLesson(s, { ...cls, weekStart: week, lessonId: b.id });
  addWeekLesson(s, { ...cls, weekStart: week, lessonId: c.id, index: 0 });
  assert.deepEqual(names(s, weekLessonsFor(s, cls, week)), ['Charlie', 'Alpha', 'Bravo']);
  assert.deepEqual(weekLessonsFor(s, cls, week).map((e) => e.position), [0, 1, 2]);
});

test('the same lesson template can be used in many weeks; the template stays in the library', () => {
  const { s, a, cls, weeks } = setup();
  addWeekLesson(s, { ...cls, weekStart: weeks[0].weekStart, lessonId: a.id });
  addWeekLesson(s, { ...cls, weekStart: weeks[2].weekStart, lessonId: a.id });
  assert.equal(s.weekLessons.length, 2);
  assert.equal(s.lessons.filter((l) => l.id === a.id).length, 1);
});

test('lessons can be reordered within a week and moved to another week', () => {
  const { s, a, b, c, cls, weeks } = setup();
  const [w1, w2] = [weeks[0].weekStart, weeks[1].weekStart];
  const ea = addWeekLesson(s, { ...cls, weekStart: w1, lessonId: a.id });
  addWeekLesson(s, { ...cls, weekStart: w1, lessonId: b.id });
  const ec = addWeekLesson(s, { ...cls, weekStart: w1, lessonId: c.id });
  moveWeekLesson(s, ec.id, w1, 0);
  assert.deepEqual(names(s, weekLessonsFor(s, cls, w1)), ['Charlie', 'Alpha', 'Bravo']);
  moveWeekLesson(s, ea.id, w2, 0);
  assert.deepEqual(names(s, weekLessonsFor(s, cls, w1)), ['Charlie', 'Bravo']);
  assert.deepEqual(weekLessonsFor(s, cls, w1).map((e) => e.position), [0, 1]);
  assert.deepEqual(names(s, weekLessonsFor(s, cls, w2)), ['Alpha']);
});

test('taking a lesson off a week keeps the deck and closes the gap', () => {
  const { s, a, b, c, cls, weeks } = setup();
  const w = weeks[0].weekStart;
  addWeekLesson(s, { ...cls, weekStart: w, lessonId: a.id });
  const eb = addWeekLesson(s, { ...cls, weekStart: w, lessonId: b.id });
  addWeekLesson(s, { ...cls, weekStart: w, lessonId: c.id });
  removeWeekLesson(s, eb.id);
  assert.deepEqual(names(s, weekLessonsFor(s, cls, w)), ['Alpha', 'Charlie']);
  assert.deepEqual(weekLessonsFor(s, cls, w).map((e) => e.position), [0, 1]);
  assert.ok(s.lessons.some((l) => l.id === b.id));
});

test('each school and grade has its own lesson schedule', () => {
  const { s, a, grade4, cls, weeks } = setup();
  addWeekLesson(s, { ...cls, weekStart: weeks[0].weekStart, lessonId: a.id });
  assert.equal(weekLessonsFor(s, { ...cls, gradeId: grade4.id }, weeks[0].weekStart).length, 0);
});

test('the schedule is saved with the data and survives reloading', () => {
  const { s, a, cls, weeks } = setup();
  addWeekLesson(s, { ...cls, weekStart: weeks[0].weekStart, lessonId: a.id });
  const again = normalize(JSON.parse(JSON.stringify(s)));
  assert.equal(weekLessonsFor(again, cls, weeks[0].weekStart).length, 1);
  assert.deepEqual(normalize({ years: [] }).weekLessons, [], 'older files load with an empty schedule');
});

test('deleting a lesson deck, school or grade removes it from the schedule; deleting an eval keeps the lesson', () => {
  const { s, a, b, crit, cls, weeks } = setup();
  const w = weeks[0].weekStart;
  addWeekLesson(s, { ...cls, weekStart: w, lessonId: a.id, criterionId: crit.id });
  addWeekLesson(s, { ...cls, weekStart: w, lessonId: b.id });
  remove(s, 'lessons', b.id);
  assert.deepEqual(names(s, weekLessonsFor(s, cls, w)), ['Alpha']);
  remove(s, 'criteria', crit.id);
  assert.equal(weekLessonsFor(s, cls, w)[0].criterionId, null);
  remove(s, 'grades', cls.gradeId);
  assert.equal(s.weekLessons.length, 0);
});

test('a week shows the evals on the Outcome & Eval Calendar that touch it', () => {
  const { s, crit, cls, weeks } = setup();
  placeCriterion(s, { ...cls, criterionId: crit.id, startDate: '2026-09-03', endDate: '2026-09-08' });
  assert.deepEqual(weeks.map((w) => placementsInWeek(s, cls, w).length), [0, 1, 1, 0, 0, 0, 0]);
});

test('a week shows which instruments are at the school, and whether for the whole week', () => {
  const { s, uke, cls, weeks } = setup();
  addInstrumentBlock(s, { yearId: cls.yearId, schoolId: cls.schoolId, instrumentId: uke.id, startDate: '2026-09-02', endDate: '2026-09-11' });
  assert.deepEqual(instrumentsInWeek(s, cls, weeks[0]), []);
  const [partWeek] = instrumentsInWeek(s, cls, weeks[1]);
  assert.equal(partWeek.allWeek, false);
  assert.deepEqual(partWeek.days, ['2026-09-02', '2026-09-03', '2026-09-04']);
  assert.equal(instrumentsInWeek(s, cls, weeks[2])[0].allWeek, true);
});

test('a lesson is flagged when its instrument is not at the school that week', () => {
  const { s, b, uke, cls, weeks } = setup();
  addInstrumentBlock(s, { yearId: cls.yearId, schoolId: cls.schoolId, instrumentId: uke.id, startDate: '2026-09-04', endDate: '2026-09-04' });
  const early = addWeekLesson(s, { ...cls, weekStart: weeks[0].weekStart, lessonId: b.id });
  const partly = addWeekLesson(s, { ...cls, weekStart: weeks[1].weekStart, lessonId: b.id });
  assert.deepEqual(missingInstruments(s, early, weeks[0]), [uke.id]);
  assert.deepEqual(missingInstruments(s, partly, weeks[1]), [], 'there for part of the week is fine');
});

test('a lesson takes its color from its eval, or from an eval that week that teaches it', () => {
  const { s, a, d, crit, outcome, cls, weeks } = setup();
  placeCriterion(s, { ...cls, criterionId: crit.id, startDate: '2026-09-01', endDate: '2026-09-04' });
  const placed = placementsInWeek(s, cls, weeks[1]);
  const fromWeek = addWeekLesson(s, { ...cls, weekStart: weeks[1].weekStart, lessonId: a.id });
  const unrelated = addWeekLesson(s, { ...cls, weekStart: weeks[1].weekStart, lessonId: d.id });
  const chosen = addWeekLesson(s, { ...cls, weekStart: weeks[4].weekStart, lessonId: a.id, criterionId: crit.id });
  assert.equal(entryOutcome(s, fromWeek, placed).id, outcome.id);
  assert.equal(entryOutcome(s, unrelated, placed), null);
  assert.equal(entryOutcome(s, chosen, []).id, outcome.id);
});

test('the lesson list can be searched and filtered by category, grade, outcome and eval', () => {
  const { s, year, grade, grade4, outcome, crit } = setup();
  const list = (f) => filterLessons(s, year.id, f).map((x) => x.lesson.name);
  assert.deepEqual(list({}), ['Alpha', 'Bravo', 'Charlie', 'Delta']);
  assert.deepEqual(list({ search: 'ar' }), ['Charlie']);
  assert.deepEqual(list({ search: 'UKUL' }), ['Bravo', 'Delta'], 'search looks at the category too');
  assert.deepEqual(list({ category: 'Ukulele' }), ['Bravo', 'Delta']);
  assert.deepEqual(list({ gradeId: grade4.id }), ['Delta']);
  assert.deepEqual(list({ outcomeId: outcome.id }), ['Alpha', 'Bravo', 'Charlie']);
  assert.deepEqual(list({ gradeId: grade.id, category: 'Ukulele' }), ['Bravo']);
  const byEval = filterLessons(s, year.id, { criterionId: crit.id });
  assert.deepEqual(byEval.map((x) => x.lesson.name), ['Alpha', 'Bravo', 'Charlie'], 'in teaching order');
  assert.ok(byEval.every((x) => x.criterionId === crit.id), 'remembers which eval they were picked for');
});

test('auto-fill spreads each eval’s lessons, in order, over the weeks it is on the calendar', () => {
  const { s, a, crit, cls, weeks } = setup();
  // Three lessons over two weeks (Sep 1 – Sep 10).
  placeCriterion(s, { ...cls, criterionId: crit.id, startDate: '2026-09-01', endDate: '2026-09-10' });
  addWeekLesson(s, { ...cls, weekStart: weeks[5].weekStart, lessonId: a.id });
  const count = autoFillWeeks(s, cls, weeks);
  assert.equal(count, 3);
  assert.deepEqual(names(s, weekLessonsFor(s, cls, weeks[1].weekStart)), ['Alpha', 'Bravo']);
  assert.deepEqual(names(s, weekLessonsFor(s, cls, weeks[2].weekStart)), ['Charlie']);
  assert.equal(weekLessonsFor(s, cls, weeks[5].weekStart).length, 0, 'replaces what was there');
  assert.ok(s.weekLessons.every((e) => e.criterionId === crit.id));
});

test('auto-fill keeps calendar order when evals share a week, and leaves other classes alone', () => {
  const { s, a, d, crit, crit2, grade4, cls, weeks } = setup();
  const other = { ...cls, gradeId: grade4.id };
  addWeekLesson(s, { ...other, weekStart: weeks[1].weekStart, lessonId: a.id });
  placeCriterion(s, { ...cls, criterionId: crit2.id, startDate: '2026-09-03', endDate: '2026-09-03' });
  placeCriterion(s, { ...cls, criterionId: crit.id, startDate: '2026-09-01', endDate: '2026-09-02' });
  autoFillWeeks(s, cls, weeks);
  assert.deepEqual(names(s, weekLessonsFor(s, cls, weeks[1].weekStart)), ['Alpha', 'Bravo', 'Charlie', 'Delta']);
  assert.equal(weekLessonsFor(s, other, weeks[1].weekStart)[0].lessonId, a.id);
  assert.ok(d);
});

test('the ✨ on one week fills only that week from the calendar', () => {
  const { s, a, d, crit, cls, weeks } = setup();
  // Three lessons over two weeks: Alpha + Bravo in week 2, Charlie in week 3.
  placeCriterion(s, { ...cls, criterionId: crit.id, startDate: '2026-09-01', endDate: '2026-09-10' });
  addWeekLesson(s, { ...cls, weekStart: weeks[1].weekStart, lessonId: d.id });
  addWeekLesson(s, { ...cls, weekStart: weeks[2].weekStart, lessonId: d.id });
  assert.equal(autoFillWeek(s, cls, weeks, weeks[1].weekStart), 2);
  assert.deepEqual(names(s, weekLessonsFor(s, cls, weeks[1].weekStart)), ['Alpha', 'Bravo'], 'replaces that week');
  assert.deepEqual(names(s, weekLessonsFor(s, cls, weeks[2].weekStart)), ['Delta'], 'other weeks untouched');
  assert.ok(a);
});

test('the ✨ on a week with nothing on the calendar leaves the week as it is', () => {
  const { s, d, cls, weeks } = setup();
  addWeekLesson(s, { ...cls, weekStart: weeks[4].weekStart, lessonId: d.id });
  assert.equal(autoFillWeek(s, cls, weeks, weeks[4].weekStart), 0);
  assert.deepEqual(names(s, weekLessonsFor(s, cls, weeks[4].weekStart)), ['Delta']);
});
