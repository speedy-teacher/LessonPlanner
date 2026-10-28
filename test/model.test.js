// Behavior tests for the planner's data rules (the requirements list).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  add, addSlide, autoFill, blocksFor, createYear, criteriaFor, emptyState, find, inYear,
  instrumentsAt, moveSlide, normalize, paintInstrument, placeOutcome, placementWarnings,
  remove, slidesFor, toggleGrade, templatesByCategory, templateUsage, duplicateTemplate,
} from '../public/js/model.js';
import { seedState } from '../public/js/seed.js';
import { monthWeeks, weekdaysBetween } from '../public/js/dates.js';

function smallYear() {
  const s = emptyState();
  const year = createYear(s, { name: 'Year A', startDate: '2026-08-24', endDate: '2027-06-11' });
  const school = add(s, 'schools', { yearId: year.id, name: 'Test School' });
  const grade = add(s, 'grades', { yearId: year.id, name: 'Grade 3', short: '3' });
  const uke = add(s, 'instruments', { yearId: year.id, name: 'Ukulele', color: '#b5654a' });
  const tpl = add(s, 'templates', { yearId: year.id, name: 'Main', autoFields: ['school', 'grade', 'date', 'instrument'] });
  const outcome = add(s, 'outcomes', { yearId: year.id, code: 'MU1', title: 'Steady beat' });
  const crit = add(s, 'criteria', { outcomeId: outcome.id, title: 'Plays the beat', gradeIds: [grade.id] });
  const slide = addSlide(s, crit.id, { title: 'Strum', templateId: tpl.id, instrumentId: uke.id });
  return { s, year, school, grade, uke, tpl, outcome, crit, slide };
}

test('placeholder data has 4 schools, grades K–5 and 3 instruments', () => {
  const s = seedState();
  const yearId = s.activeYearId;
  assert.equal(inYear(s, 'schools', yearId).length, 4);
  assert.deepEqual(inYear(s, 'grades', yearId).map((g) => g.short), ['K', '1', '2', '3', '4', '5']);
  assert.equal(inYear(s, 'instruments', yearId).length, 3);
});

test('a new year copies instruments, schools, grades, outcomes and templates', () => {
  const { s, year } = smallYear();
  const next = createYear(s, { name: 'Year B', startDate: '2027-08-23', endDate: '2028-06-09' }, year.id);
  for (const c of ['instruments', 'schools', 'grades', 'outcomes', 'templates']) {
    assert.equal(inYear(s, c, next.id).length, 1, c);
    assert.notEqual(inYear(s, c, next.id)[0].id, inYear(s, c, year.id)[0].id, `${c} is a copy`);
  }
  assert.equal(s.activeYearId, next.id);
});

test('copied outcomes bring criteria, grades and slides that point at the new year', () => {
  const { s, year } = smallYear();
  const next = createYear(s, { name: 'Year B', startDate: '2027-08-23', endDate: '2028-06-09' }, year.id);
  const outcome = inYear(s, 'outcomes', next.id)[0];
  const [crit] = criteriaFor(s, outcome.id);
  assert.deepEqual(crit.gradeIds, [inYear(s, 'grades', next.id)[0].id]);
  const [slide] = slidesFor(s, crit.id);
  assert.equal(slide.instrumentId, inYear(s, 'instruments', next.id)[0].id);
  assert.equal(slide.templateId, inYear(s, 'templates', next.id)[0].id);
});

test('editing the new year leaves the old year untouched', () => {
  const { s, year, school } = smallYear();
  const next = createYear(s, { name: 'Year B', startDate: '2027-08-23', endDate: '2028-06-09' }, year.id);
  remove(s, 'schools', inYear(s, 'schools', next.id)[0].id);
  assert.ok(find(s, 'schools', school.id));
  assert.equal(inYear(s, 'schools', next.id).length, 0);
});

test('a new year without copying starts empty, and calendars never carry over', () => {
  const { s, year, school, grade, outcome } = smallYear();
  placeOutcome(s, { yearId: year.id, schoolId: school.id, gradeId: grade.id, outcomeId: outcome.id, date: '2026-09-14' });
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

test('lesson slides keep a teaching order that can be changed', () => {
  const { s, crit } = smallYear();
  const b = addSlide(s, crit.id, { title: 'B' });
  const c = addSlide(s, crit.id, { title: 'C' });
  moveSlide(s, c.id, 0);
  assert.deepEqual(slidesFor(s, crit.id).map((x) => x.title), ['C', 'Strum', 'B']);
  remove(s, 'slides', b.id);
  assert.deepEqual(slidesFor(s, crit.id).map((x) => x.position), [0, 1]);
});

test('removing an outcome removes its criteria, slides and calendar entries', () => {
  const { s, year, school, grade, outcome, crit } = smallYear();
  placeOutcome(s, { yearId: year.id, schoolId: school.id, gradeId: grade.id, outcomeId: outcome.id, date: '2026-09-14' });
  remove(s, 'outcomes', outcome.id);
  assert.equal(s.criteria.length, 0);
  assert.equal(slidesFor(s, crit.id).length, 0);
  assert.equal(s.placements.length, 0);
});

test('removing a grade takes it off eval criteria', () => {
  const { s, crit, grade } = smallYear();
  remove(s, 'grades', grade.id);
  assert.deepEqual(crit.gradeIds, []);
});

test('removing an instrument clears it from slides and the schedule', () => {
  const { s, year, school, uke, slide } = smallYear();
  paintInstrument(s, { yearId: year.id, schoolId: school.id, instrumentId: uke.id, dates: ['2026-09-14'], on: true });
  remove(s, 'instruments', uke.id);
  assert.equal(slide.instrumentId, null);
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

test('warns when an outcome needs an instrument the school does not have that day', () => {
  const { s, year, school, grade, uke, outcome, slide } = smallYear();
  paintInstrument(s, { yearId: year.id, schoolId: school.id, instrumentId: uke.id, dates: weekdaysBetween('2026-10-05', '2026-10-09'), on: true });
  const ok = placeOutcome(s, { yearId: year.id, schoolId: school.id, gradeId: grade.id, outcomeId: outcome.id, date: '2026-10-06' });
  const bad = placeOutcome(s, { yearId: year.id, schoolId: school.id, gradeId: grade.id, outcomeId: outcome.id, date: '2026-10-13' });
  assert.equal(placementWarnings(s, ok).length, 0);
  const [warning] = placementWarnings(s, bad);
  assert.equal(warning.slide.id, slide.id);
  assert.equal(warning.instrument.name, 'Ukulele');
  assert.deepEqual(warning.blocks.map((b) => b.startDate), ['2026-10-05']);
});

test('no warning for grades the instrument lesson does not apply to', () => {
  const { s, year, school, outcome } = smallYear();
  const k = add(s, 'grades', { yearId: year.id, name: 'Kindergarten', short: 'K' });
  const p = placeOutcome(s, { yearId: year.id, schoolId: school.id, gradeId: k.id, outcomeId: outcome.id, date: '2026-10-13' });
  assert.equal(placementWarnings(s, p).length, 0);
});

test('templates fill in school, grade, date and instrument from the calendar', () => {
  const { s, year, school, grade, outcome, slide } = smallYear();
  const p = placeOutcome(s, { yearId: year.id, schoolId: school.id, gradeId: grade.id, outcomeId: outcome.id, date: '2026-10-13' });
  const values = Object.fromEntries(autoFill(s, slide, p).map((f) => [f.key, f.value]));
  assert.deepEqual(values, { school: 'Test School', grade: 'Grade 3', date: '2026-10-13', instrument: 'Ukulele' });
});

test('templates are grouped by category, alphabetically, uncategorized last', () => {
  const { s, year } = smallYear();
  add(s, 'templates', { yearId: year.id, name: 'Zebra', category: 'Openers', autoFields: [] });
  add(s, 'templates', { yearId: year.id, name: 'Apple', category: 'Openers', autoFields: [] });
  const groups = templatesByCategory(s, year.id);
  assert.deepEqual(groups.map((g) => g.category), ['Openers', '']);
  assert.deepEqual(groups[0].templates.map((t) => t.name), ['Apple', 'Zebra']);
});

test('a template shows which lesson slides use it', () => {
  const { s, tpl, slide, outcome } = smallYear();
  const [use] = templateUsage(s, tpl.id);
  assert.equal(use.slide.id, slide.id);
  assert.equal(use.outcome.id, outcome.id);
});

test('duplicating a template makes an independent copy', () => {
  const { s, tpl } = smallYear();
  const copy = duplicateTemplate(s, tpl.id);
  assert.equal(copy.name, 'Main (copy)');
  copy.autoFields.push('outcome');
  assert.equal(tpl.autoFields.includes('outcome'), false);
  assert.equal(templateUsage(s, copy.id).length, 0);
});

test('deleting a template keeps its slides, just without a template', () => {
  const { s, tpl, slide } = smallYear();
  remove(s, 'templates', tpl.id);
  assert.ok(find(s, 'slides', slide.id));
  assert.equal(slide.templateId, null);
});

test('deleting a year removes everything inside it', () => {
  const { s, year } = smallYear();
  const other = createYear(s, { name: 'B', startDate: '2027-08-23', endDate: '2028-06-09' }, year.id);
  remove(s, 'years', year.id);
  assert.equal(s.slides.length, 1);
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
