// Behavior tests for the planner's data rules (the requirements list).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  add, addStep, autoFill, blocksFor, createYear, criteriaFor, emptyState, find, inYear,
  instrumentsAt, moveStep, normalize, paintInstrument, placeCriterion, placementWarnings,
  movePlacement, resizePlacement, criteriaForGrade, addInstrumentBlock, moveRange, resizeRange,
  remove, stepsFor, toggleGrade, lessonsByCategory, lessonEvals, lessonUsageByGrade, duplicateLesson, nextColor,
} from '../public/js/model.js';
import { seedState } from '../public/js/seed.js';
import { monthWeeks, weekdaysBetween } from '../public/js/dates.js';

function place({ s, year, school, grade, crit }, startDate, endDate = startDate) {
  return placeCriterion(s, { yearId: year.id, schoolId: school.id, gradeId: grade.id, criterionId: crit.id, startDate, endDate });
}

function smallYear() {
  const s = emptyState();
  const year = createYear(s, { name: 'Year A', startDate: '2026-08-24', endDate: '2027-06-11' });
  const school = add(s, 'schools', { yearId: year.id, name: 'Test School' });
  const grade = add(s, 'grades', { yearId: year.id, name: 'Grade 3', short: '3' });
  const uke = add(s, 'instruments', { yearId: year.id, name: 'Ukulele', color: '#b5654a' });
  const lesson = add(s, 'lessons', { yearId: year.id, name: 'Strum', category: '', autoFields: ['school', 'grade', 'date', 'instrument'], instrumentIds: [uke.id] });
  const outcome = add(s, 'outcomes', { yearId: year.id, code: 'MU1', title: 'Steady beat' });
  const crit = add(s, 'criteria', { outcomeId: outcome.id, title: 'Plays the beat', gradeIds: [grade.id] });
  const step = addStep(s, crit.id, lesson.id);
  return { s, year, school, grade, uke, lesson, outcome, crit, step };
}

test('placeholder data has 4 schools, grades K–5 and 3 instruments', () => {
  const s = seedState();
  const yearId = s.activeYearId;
  assert.equal(inYear(s, 'schools', yearId).length, 4);
  assert.deepEqual(inYear(s, 'grades', yearId).map((g) => g.short), ['K', '1', '2', '3', '4', '5']);
  assert.equal(inYear(s, 'instruments', yearId).length, 3);
});

test('a new year copies instruments, schools, grades, outcomes and lesson decks', () => {
  const { s, year } = smallYear();
  const next = createYear(s, { name: 'Year B', startDate: '2027-08-23', endDate: '2028-06-09' }, year.id);
  for (const c of ['instruments', 'schools', 'grades', 'outcomes', 'lessons']) {
    assert.equal(inYear(s, c, next.id).length, 1, c);
    assert.notEqual(inYear(s, c, next.id)[0].id, inYear(s, c, year.id)[0].id, `${c} is a copy`);
  }
  assert.equal(s.activeYearId, next.id);
});

test('copied outcomes bring criteria, grades and lesson order that point at the new year', () => {
  const { s, year } = smallYear();
  const next = createYear(s, { name: 'Year B', startDate: '2027-08-23', endDate: '2028-06-09' }, year.id);
  const outcome = inYear(s, 'outcomes', next.id)[0];
  const [crit] = criteriaFor(s, outcome.id);
  assert.deepEqual(crit.gradeIds, [inYear(s, 'grades', next.id)[0].id]);
  const [step] = stepsFor(s, crit.id);
  const lesson = inYear(s, 'lessons', next.id)[0];
  assert.equal(step.lessonId, lesson.id);
  assert.deepEqual(lesson.instrumentIds, [inYear(s, 'instruments', next.id)[0].id]);
});

test('editing the new year leaves the old year untouched', () => {
  const { s, year, school } = smallYear();
  const next = createYear(s, { name: 'Year B', startDate: '2027-08-23', endDate: '2028-06-09' }, year.id);
  remove(s, 'schools', inYear(s, 'schools', next.id)[0].id);
  assert.ok(find(s, 'schools', school.id));
  assert.equal(inYear(s, 'schools', next.id).length, 0);
});

test('a new year without copying starts empty, and calendars never carry over', () => {
  const { s, year, school, grade, crit } = smallYear();
  place({ s, year, school, grade, crit }, '2026-09-14');
  const copied = createYear(s, { name: 'B', startDate: '2027-08-23', endDate: '2028-06-09' }, year.id);
  assert.equal(inYear(s, 'placements', copied.id).length, 0);
  const blank = createYear(s, { name: 'C', startDate: '2028-08-21', endDate: '2029-06-08' });
  assert.equal(inYear(s, 'schools', blank.id).length, 0);
});

test('eval criteria grades can be added and removed', () => {
  const { s, crit, grade } = smallYear();
  toggleGrade(s, crit.id, grade.id);
  assert.deepEqual(crit.gradeIds, []);
  toggleGrade(s, crit.id, grade.id);
  assert.deepEqual(crit.gradeIds, [grade.id]);
});

test('an eval lists lesson decks in a teaching order that can be changed', () => {
  const { s, year, crit, lesson } = smallYear();
  const deck = (name) => add(s, 'lessons', { yearId: year.id, name, category: '', autoFields: [], instrumentIds: [] });
  const b = addStep(s, crit.id, deck('B').id);
  const c = addStep(s, crit.id, deck('C').id);
  moveStep(s, c.id, 0);
  const names = () => stepsFor(s, crit.id).map((x) => find(s, 'lessons', x.lessonId).name);
  assert.deepEqual(names(), ['C', 'Strum', 'B']);
  remove(s, 'criterionLessons', b.id);
  assert.deepEqual(stepsFor(s, crit.id).map((x) => x.position), [0, 1]);
  assert.ok(find(s, 'lessons', b.lessonId), 'taking a lesson out of an eval keeps the deck');
  addStep(s, crit.id, lesson.id);
  assert.deepEqual(names(), ['C', 'Strum', 'Strum'], 'the same deck can be taught twice');
});

test('removing an outcome removes its criteria, lesson order and calendar entries', () => {
  const { s, year, school, grade, outcome, crit } = smallYear();
  place({ s, year, school, grade, crit }, '2026-09-14');
  remove(s, 'outcomes', outcome.id);
  assert.equal(s.criteria.length, 0);
  assert.equal(stepsFor(s, crit.id).length, 0);
  assert.equal(s.lessons.length, 1, 'lesson decks stay in the library');
  assert.equal(s.placements.length, 0);
});

test('removing a grade takes it off eval criteria', () => {
  const { s, crit, grade } = smallYear();
  remove(s, 'grades', grade.id);
  assert.deepEqual(crit.gradeIds, []);
});

test('removing an instrument clears it from lessons and the schedule', () => {
  const { s, year, school, uke, lesson } = smallYear();
  paintInstrument(s, { yearId: year.id, schoolId: school.id, instrumentId: uke.id, dates: ['2026-09-14'], on: true });
  remove(s, 'instruments', uke.id);
  assert.deepEqual(lesson.instrumentIds, []);
  assert.equal(s.instrumentBlocks.length, 0);
});

test('painting school days makes merged ranges across weekends; erasing splits them', () => {
  const { s, year, school, uke } = smallYear();
  const args = { yearId: year.id, schoolId: school.id, instrumentId: uke.id };
  paintInstrument(s, { ...args, dates: weekdaysBetween('2026-09-14', '2026-09-25'), on: true });
  assert.deepEqual(blocksFor(s, year.id, school.id, uke.id).map((b) => [b.startDate, b.endDate]), [['2026-09-14', '2026-09-25']]);
  paintInstrument(s, { ...args, dates: ['2026-09-17'], on: false });
  assert.deepEqual(blocksFor(s, year.id, school.id, uke.id).map((b) => [b.startDate, b.endDate]),
    [['2026-09-14', '2026-09-16'], ['2026-09-18', '2026-09-25']]);
  assert.deepEqual(instrumentsAt(s, year.id, school.id, '2026-09-18'), [uke.id]);
  assert.deepEqual(instrumentsAt(s, year.id, school.id, '2026-09-17'), []);
});

test('an instrument is dropped on a school for one day, then stretched to a date range', () => {
  const { s, year, school, uke } = smallYear();
  const b = addInstrumentBlock(s, { yearId: year.id, schoolId: school.id, instrumentId: uke.id, startDate: '2026-09-14' });
  assert.deepEqual(instrumentsAt(s, year.id, school.id, '2026-09-14'), [uke.id]);
  assert.deepEqual(instrumentsAt(s, year.id, school.id, '2026-09-15'), []);
  resizeRange(s, 'instrumentBlocks', b.id, { endDate: '2026-10-30' });
  assert.deepEqual(instrumentsAt(s, year.id, school.id, '2026-10-30'), [uke.id]);
  resizeRange(s, 'instrumentBlocks', b.id, { startDate: '2026-09-21' });
  assert.deepEqual(instrumentsAt(s, year.id, school.id, '2026-09-18'), []);
});

test('moving an instrument range keeps its length and updates lesson warnings', () => {
  const ctx = smallYear();
  const { s, year, school, uke } = ctx;
  const b = addInstrumentBlock(s, { yearId: year.id, schoolId: school.id, instrumentId: uke.id, startDate: '2026-09-14', endDate: '2026-09-18' });
  const p = place(ctx, '2026-10-05', '2026-10-09');
  assert.equal(placementWarnings(s, p).length, 1);
  moveRange(s, 'instrumentBlocks', b.id, '2026-10-05');
  assert.deepEqual([b.startDate, b.endDate], ['2026-10-05', '2026-10-09']);
  assert.equal(placementWarnings(s, p).length, 0);
});

test('warns when an eval needs an instrument the school does not have on some of its days', () => {
  const ctx = smallYear();
  const { s, year, school, uke, lesson } = ctx;
  paintInstrument(s, { yearId: year.id, schoolId: school.id, instrumentId: uke.id, dates: weekdaysBetween('2026-10-05', '2026-10-09'), on: true });
  assert.equal(placementWarnings(s, place(ctx, '2026-10-06', '2026-10-09')).length, 0);
  const [warning] = placementWarnings(s, place(ctx, '2026-10-08', '2026-10-13'));
  assert.equal(warning.lesson.id, lesson.id);
  assert.equal(warning.instrument.name, 'Ukulele');
  assert.deepEqual(warning.missingDates, ['2026-10-12', '2026-10-13']);
  assert.deepEqual(warning.blocks.map((b) => b.startDate), ['2026-10-05']);
});

test('only eval criteria for the selected grade are offered for dragging', () => {
  const { s, year, outcome, crit, grade } = smallYear();
  const k = add(s, 'grades', { yearId: year.id, name: 'Kindergarten', short: 'K' });
  assert.deepEqual(criteriaForGrade(s, outcome.id, grade.id).map((c) => c.id), [crit.id]);
  assert.deepEqual(criteriaForGrade(s, outcome.id, k.id), []);
});

test('an eval placed on a day can be stretched over several days', () => {
  const ctx = smallYear();
  const p = place(ctx, '2026-10-05');
  assert.deepEqual([p.startDate, p.endDate], ['2026-10-05', '2026-10-05']);
  resizePlacement(ctx.s, p.id, { endDate: '2026-10-09' });
  assert.deepEqual([p.startDate, p.endDate], ['2026-10-05', '2026-10-09']);
  resizePlacement(ctx.s, p.id, { startDate: '2026-10-12' });
  assert.deepEqual([p.startDate, p.endDate], ['2026-10-09', '2026-10-12'], 'dragged past the end: swapped');
});

test('moving a multi-day eval keeps its length', () => {
  const ctx = smallYear();
  const p = place(ctx, '2026-10-05', '2026-10-09');
  movePlacement(ctx.s, p.id, '2026-10-19');
  assert.deepEqual([p.startDate, p.endDate], ['2026-10-19', '2026-10-23']);
});

test('removing an eval criterion removes it from the calendar', () => {
  const ctx = smallYear();
  place(ctx, '2026-10-05');
  remove(ctx.s, 'criteria', ctx.crit.id);
  assert.equal(ctx.s.placements.length, 0);
});

test('lesson decks fill in school, grade, dates and instrument from the calendar', () => {
  const ctx = smallYear();
  const one = Object.fromEntries(autoFill(ctx.s, ctx.step, place(ctx, '2026-10-13')).map((f) => [f.key, f.value]));
  assert.deepEqual(one, { school: 'Test School', grade: 'Grade 3', date: '2026-10-13', instrument: 'Ukulele' });
  const many = Object.fromEntries(autoFill(ctx.s, ctx.step, place(ctx, '2026-10-13', '2026-10-15')).map((f) => [f.key, f.value]));
  assert.equal(many.date, '2026-10-13/2026-10-15');
});

test('outcomes get a color, and each new one gets an unused color', () => {
  const s = seedState();
  const outcomes = inYear(s, 'outcomes', s.activeYearId);
  assert.ok(outcomes.every((o) => /^#[0-9a-f]{6}$/i.test(o.color)));
  assert.equal(new Set(outcomes.map((o) => o.color)).size, outcomes.length);
  assert.ok(!outcomes.some((o) => o.color === nextColor(s, 'outcomes', s.activeYearId)));
});

test('saved data from the first version is upgraded: outcome entries become eval entries', () => {
  const { s, year, school, grade, outcome, crit } = smallYear();
  add(s, 'criteria', { outcomeId: outcome.id, title: 'Other grade only', gradeIds: [] }); // not converted: no matching grade
  const old = { ...s, schemaVersion: 1, placements: [{ id: 'p1', yearId: year.id, schoolId: school.id, gradeId: grade.id, outcomeId: outcome.id, date: '2026-09-14' }] };
  delete outcome.color;
  const upgraded = normalize(structuredClone(old));
  assert.equal(upgraded.schemaVersion, 3);
  assert.equal(upgraded.placements.length, 1);
  assert.deepEqual(
    [upgraded.placements[0].criterionId, upgraded.placements[0].startDate, upgraded.placements[0].endDate],
    [crit.id, '2026-09-14', '2026-09-14'],
  );
  assert.ok(upgraded.outcomes[0].color);
});

test('lesson decks are grouped by category, alphabetically, uncategorized last', () => {
  const { s, year } = smallYear();
  add(s, 'lessons', { yearId: year.id, name: 'Zebra', category: 'Openers', autoFields: [], instrumentIds: [] });
  add(s, 'lessons', { yearId: year.id, name: 'Apple', category: 'Openers', autoFields: [], instrumentIds: [] });
  const groups = lessonsByCategory(s, year.id);
  assert.deepEqual(groups.map((g) => g.category), ['Openers', '']);
  assert.deepEqual(groups[0].lessons.map((l) => l.name), ['Apple', 'Zebra']);
});

test('a lesson deck shows which evals teach it, and where in the order', () => {
  const { s, year, lesson, crit, outcome } = smallYear();
  addStep(s, crit.id, add(s, 'lessons', { yearId: year.id, name: 'Other', category: '', autoFields: [], instrumentIds: [] }).id);
  addStep(s, crit.id, lesson.id);
  const evals = lessonEvals(s, lesson.id);
  assert.equal(evals.length, 1, 'one eval, even though it is in that eval twice');
  assert.equal(evals[0].criterion.id, crit.id);
  assert.equal(evals[0].outcome.id, outcome.id);
  assert.deepEqual(evals[0].positions, [1, 3]);
});

test('a lesson deck lists the grades, essential outcomes and evals it is used in', () => {
  const { s, year, lesson, crit, grade, outcome } = smallYear();
  const k = add(s, 'grades', { yearId: year.id, name: 'Kindergarten', short: 'K' });
  const mu2 = add(s, 'outcomes', { yearId: year.id, code: 'MU2', title: 'Melody' });
  const sings = add(s, 'criteria', { outcomeId: mu2.id, title: 'Sings', gradeIds: [grade.id, k.id] });
  const someday = add(s, 'criteria', { outcomeId: mu2.id, title: 'No grades yet', gradeIds: [] });
  addStep(s, sings.id, lesson.id);
  addStep(s, someday.id, lesson.id);
  const view = lessonUsageByGrade(s, lesson.id).map(({ grade: g, outcomes }) => [
    g?.name ?? null, outcomes.map((o) => [o.outcome.code, o.evals.map((e) => e.criterion.title)]),
  ]);
  assert.deepEqual(view, [
    ['Grade 3', [['MU1', ['Plays the beat']], ['MU2', ['Sings']]]],
    ['Kindergarten', [['MU2', ['Sings']]]],
    [null, [['MU2', ['No grades yet']]]],
  ]);
  assert.equal(outcome.code, 'MU1');
  assert.ok(crit.gradeIds.includes(grade.id));
});

test('duplicating a lesson deck makes an independent copy', () => {
  const { s, lesson } = smallYear();
  const copy = duplicateLesson(s, lesson.id);
  assert.equal(copy.name, 'Strum (copy)');
  copy.autoFields.push('outcome');
  assert.equal(lesson.autoFields.includes('outcome'), false);
  assert.equal(lessonEvals(s, copy.id).length, 0);
});

test('deleting a lesson deck takes it out of every eval', () => {
  const { s, lesson, crit } = smallYear();
  remove(s, 'lessons', lesson.id);
  assert.equal(stepsFor(s, crit.id).length, 0);
});

test('saved data with templates and slides is upgraded to lesson decks in order', () => {
  const { s, year, school, grade, uke, crit } = smallYear();
  const old = {
    ...structuredClone(s), schemaVersion: 2, lessons: undefined, criterionLessons: undefined,
    templates: [{ id: 'tpl1', yearId: year.id, name: 'Main', category: 'Lesson', autoFields: ['grade'] }],
    slides: [
      { id: 's2', criterionId: crit.id, title: 'Second', templateId: 'tpl1', instrumentId: uke.id, position: 1 },
      { id: 's1', criterionId: crit.id, title: 'First', templateId: null, instrumentId: null, position: 0 },
    ],
  };
  const v3 = normalize(old);
  assert.equal(v3.templates, undefined);
  assert.equal(v3.slides, undefined);
  const names = stepsFor(v3, crit.id).map((st) => find(v3, 'lessons', st.lessonId).name);
  assert.deepEqual(names, ['First', 'Main'], 'a slide without a template becomes its own lesson');
  assert.deepEqual(find(v3, 'lessons', 'tpl1').instrumentIds, [uke.id], 'the instrument moves onto the lesson');
  const p = placeCriterion(v3, { yearId: year.id, schoolId: school.id, gradeId: grade.id, criterionId: crit.id, startDate: '2026-10-05' });
  assert.equal(placementWarnings(v3, p)[0].lesson.name, 'Main');
});

test('deleting a year removes everything inside it', () => {
  const { s, year } = smallYear();
  const other = createYear(s, { name: 'B', startDate: '2027-08-23', endDate: '2028-06-09' }, year.id);
  remove(s, 'years', year.id);
  assert.equal(s.criterionLessons.length, 1);
  assert.ok(s.schools.every((x) => x.yearId === other.id));
  assert.equal(s.activeYearId, other.id);
});

test('older or partial saved files still load', () => {
  const s = normalize({ schemaVersion: 1, years: [{ id: 'y1', name: 'Old', startDate: '2020-08-24', endDate: '2021-06-11' }] });
  assert.equal(s.activeYearId, 'y1');
  assert.deepEqual(s.placements, []);
});

test('month calendar weeks are Monday–Friday and cover the whole month', () => {
  const weeks = monthWeeks('2026-11');
  assert.equal(weeks[0][0], '2026-11-02'); // Nov 1 is a Sunday
  assert.equal(weeks.at(-1)[4], '2026-12-04');
  assert.ok(weeks.every((w) => w.length === 5));
});
