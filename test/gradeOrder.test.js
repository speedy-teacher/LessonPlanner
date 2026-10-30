// Each grade of an eval has its own lesson order (Outcomes, Evals & Lesson Order switches between grades).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  add, addStep, copyOrder, createYear, emptyState, find, inYear, lessonNumber, lessonUsageByGrade, moveStep,
  normalize, placeCriterion, remove, setGrades, stepsFor, toggleGrade,
} from '../public/js/model.js';
import { runCommand } from '../public/js/agentCommands.js';

function setup() {
  const s = emptyState();
  const year = createYear(s, { name: 'Year A', startDate: '2026-08-24', endDate: '2027-06-11' });
  const school = add(s, 'schools', { yearId: year.id, name: 'Test School' });
  const [k, g1, g2] = ['Kindergarten', 'Grade 1', 'Grade 2'].map((name) => add(s, 'grades', { yearId: year.id, name, short: name.at(-1) }));
  const deck = (name) => add(s, 'lessons', { yearId: year.id, name, category: '', autoFields: [], instrumentIds: [] });
  const [a, b, c] = ['Alpha', 'Bravo', 'Charlie'].map(deck);
  const outcome = add(s, 'outcomes', { yearId: year.id, code: 'MU1', title: 'Steady beat' });
  const crit = add(s, 'criteria', { outcomeId: outcome.id, title: 'Plays the beat', gradeIds: [k.id, g1.id] });
  [a, b, c].forEach((l) => addStep(s, crit.id, l.id));
  return { s, year, school, k, g1, g2, a, b, c, crit };
}

const names = (s, crit, gradeId) => stepsFor(s, crit.id, gradeId).map((x) => find(s, 'lessons', x.lessonId).name);

test('a lesson added to an eval goes into every grade\'s order, and each grade can be reordered on its own', () => {
  const { s, k, g1, crit } = setup();
  assert.deepEqual(names(s, crit, k.id), ['Alpha', 'Bravo', 'Charlie']);
  assert.deepEqual(names(s, crit, g1.id), ['Alpha', 'Bravo', 'Charlie']);
  moveStep(s, stepsFor(s, crit.id, g1.id)[2].id, 0);
  assert.deepEqual(names(s, crit, g1.id), ['Charlie', 'Alpha', 'Bravo']);
  assert.deepEqual(names(s, crit, k.id), ['Alpha', 'Bravo', 'Charlie'], 'Kindergarten keeps its own order');
});

test('a lesson can be added to or taken out of just one grade', () => {
  const { s, k, g1, a, crit } = setup();
  addStep(s, crit.id, a.id, k.id);
  remove(s, 'criterionLessons', stepsFor(s, crit.id, g1.id)[0].id);
  assert.deepEqual(names(s, crit, k.id), ['Alpha', 'Bravo', 'Charlie', 'Alpha']);
  assert.deepEqual(names(s, crit, g1.id), ['Bravo', 'Charlie']);
  assert.deepEqual(stepsFor(s, crit.id, g1.id).map((x) => x.position), [0, 1]);
});

test('a grade added to an eval starts with a copy of its order; one taken off takes its order along', () => {
  const { s, k, g1, g2, crit } = setup();
  moveStep(s, stepsFor(s, crit.id, k.id)[2].id, 0);
  toggleGrade(s, crit.id, g2.id);
  assert.deepEqual(names(s, crit, g2.id), ['Charlie', 'Alpha', 'Bravo'], 'copied from the first grade');
  toggleGrade(s, crit.id, g2.id);
  assert.equal(s.criterionLessons.filter((x) => x.gradeId === g2.id).length, 0);
  setGrades(s, crit.id, []);
  assert.deepEqual(crit.gradeIds, []);
  assert.deepEqual(names(s, crit, null), ['Alpha', 'Bravo', 'Charlie'], 'the last grade’s order is kept for the next grade');
  toggleGrade(s, crit.id, g1.id);
  assert.deepEqual(names(s, crit, g1.id), ['Alpha', 'Bravo', 'Charlie']);
  assert.ok(k);
});

test('one grade\'s order can be given to every grade', () => {
  const { s, k, g1, crit } = setup();
  moveStep(s, stepsFor(s, crit.id, g1.id)[2].id, 0);
  copyOrder(s, crit.id, g1.id, crit.gradeIds);
  assert.deepEqual(names(s, crit, k.id), ['Charlie', 'Alpha', 'Bravo']);
  assert.equal(s.criterionLessons.length, 6);
});

test('lesson numbers and the lesson template\'s "used in" follow each grade\'s own order', () => {
  const { s, year, school, k, g1, c, crit } = setup();
  moveStep(s, stepsFor(s, crit.id, g1.id)[2].id, 0);
  const p = placeCriterion(s, { yearId: year.id, schoolId: school.id, gradeId: g1.id, criterionId: crit.id, startDate: '2026-09-14', endDate: '2026-09-14' });
  assert.equal(lessonNumber(s, p, { lessonId: c.id }), 1);
  const usage = lessonUsageByGrade(s, c.id).map(({ grade, outcomes }) => [grade.name, outcomes[0].evals[0].positions]);
  assert.deepEqual(usage, [['Kindergarten', [3]], ['Grade 1', [1]]]);
  assert.ok(k);
});

test('saved plans from before get the same lesson order for every grade of an eval', () => {
  const { s, k, g1, crit } = setup();
  const old = structuredClone({ ...s, schemaVersion: 5 });
  const firstSteps = stepsFor(old, crit.id, k.id);
  old.criterionLessons = firstSteps.map(({ gradeId: _g, ...rest }) => rest);
  const v6 = normalize(old);
  assert.deepEqual(names(v6, crit, k.id), ['Alpha', 'Bravo', 'Charlie']);
  assert.deepEqual(names(v6, crit, g1.id), ['Alpha', 'Bravo', 'Charlie']);
  assert.equal(new Set(v6.criterionLessons.map((x) => x.id)).size, 6, 'every copy has its own id');
});

test('a new school year keeps each grade\'s own order', () => {
  const { s, year, g1, crit } = setup();
  moveStep(s, stepsFor(s, crit.id, g1.id)[2].id, 0);
  const next = createYear(s, { name: 'Year B', startDate: '2027-08-23', endDate: '2028-06-09' }, year.id);
  const newCrit = s.criteria.find((x) => x.copiedFromId === crit.id);
  const newG1 = inYear(s, 'grades', next.id).find((g) => g.name === 'Grade 1');
  assert.deepEqual(names(s, newCrit, newG1.id), ['Charlie', 'Alpha', 'Bravo']);
});

test('assistant commands: each grade\'s lesson order can be listed, set and copied', () => {
  const { s, crit } = setup();
  runCommand(s, 'addLessonToEval', { eval: 'Plays the beat', lesson: 'Alpha', grade: 'Kindergarten', position: 1 });
  assert.deepEqual(runCommand(s, 'listEvals', { grade: 'Kindergarten' })[0].lessons, ['Alpha', 'Alpha', 'Bravo', 'Charlie']);
  assert.deepEqual(runCommand(s, 'listEvals', {})[0].lessonsByGrade, {
    Kindergarten: ['Alpha', 'Alpha', 'Bravo', 'Charlie'], 'Grade 1': ['Alpha', 'Bravo', 'Charlie'],
  });
  runCommand(s, 'setEvalLessons', { eval: 'Plays the beat', grade: 'Grade 1', lessons: ['Charlie', 'Bravo'] });
  runCommand(s, 'removeLessonFromEval', { eval: 'Plays the beat', grade: 'Kindergarten', lesson: 'Alpha' });
  assert.deepEqual(runCommand(s, 'listEvals', { grade: '1' })[0].lessons, ['Charlie', 'Bravo']);
  assert.deepEqual(runCommand(s, 'listEvals', { grade: 'Kindergarten' })[0].lessons, ['Bravo', 'Charlie']);
  assert.throws(() => runCommand(s, 'setEvalLessons', { eval: 'Plays the beat', grade: 'Grade 2', lessons: ['Alpha'] }), /isn't for Grade 2/);
  const same = runCommand(s, 'copyEvalOrder', { eval: 'Plays the beat', from: 'Grade 1' });
  assert.deepEqual(same.lessons, ['Charlie', 'Bravo']);
  runCommand(s, 'editEval', { eval: 'Plays the beat', addGrades: ['Grade 2'] });
  assert.deepEqual(runCommand(s, 'listEvals', { grade: '2' })[0].lessons, ['Charlie', 'Bravo'], 'a grade added by command gets the order too');
  assert.ok(crit);
});
