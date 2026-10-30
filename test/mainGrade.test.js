// An eval's main grade: its title wears that grade's color (or its only grade's), and the
// calendar's "All" view colors the eval by it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { add, createYear, emptyState, inYear, normalize, remove, toggleGrade } from '../public/js/model.js';
import { evalColor, evalGradeId, readableText, toggleMainGrade } from '../public/js/evalGrade.js';
import { runCommand } from '../public/js/agentCommands.js';

function setup() {
  const s = emptyState();
  const year = createYear(s, { name: 'Year A', startDate: '2026-08-24', endDate: '2027-06-11' });
  const [k, g1] = [['Kindergarten', 'K', '#c27c4e'], ['Grade 1', '1', '#3f8a8c']]
    .map(([name, short, color]) => add(s, 'grades', { yearId: year.id, name, short, color }));
  const outcome = add(s, 'outcomes', { yearId: year.id, code: 'MU1', title: 'Steady beat' });
  const crit = add(s, 'criteria', { outcomeId: outcome.id, title: 'Plays the beat', gradeIds: [k.id, g1.id] });
  return { s, year, k, g1, crit };
}

test('an eval with several grades has no color until a main grade is picked', () => {
  const { s, g1, crit } = setup();
  assert.equal(evalColor(s, crit), null);
  toggleMainGrade(s, crit.id, g1.id);
  assert.equal(crit.mainGradeId, g1.id);
  assert.equal(evalColor(s, crit), '#3f8a8c');
  toggleMainGrade(s, crit.id, g1.id);
  assert.equal(crit.mainGradeId, null, 'clicking the main grade again clears it');
});

test('an eval with only one grade takes that grade\'s color', () => {
  const { s, k, crit } = setup();
  crit.gradeIds = [k.id];
  assert.equal(evalGradeId(crit), k.id);
  assert.equal(evalColor(s, crit), '#c27c4e');
});

test('only one of the eval\'s own grades can be its main grade, and taking that grade off clears it', () => {
  const { s, year, k, g1, crit } = setup();
  const g2 = add(s, 'grades', { yearId: year.id, name: 'Grade 2', short: '2', color: '#5f6fb8' });
  toggleMainGrade(s, crit.id, g2.id);
  assert.equal(crit.mainGradeId, null);
  toggleMainGrade(s, crit.id, g1.id);
  toggleGrade(s, crit.id, g1.id);
  assert.equal(crit.mainGradeId, null);
  assert.equal(evalGradeId(crit), k.id, 'now its only grade');
});

test('deleting the main grade clears it; a new year keeps the main grade', () => {
  const { s, year, g1, crit } = setup();
  toggleMainGrade(s, crit.id, g1.id);
  createYear(s, { name: 'Year B', startDate: '2027-08-23', endDate: '2028-06-09' }, year.id);
  const copy = s.criteria.find((c) => c.copiedFromId === crit.id);
  assert.equal(copy.mainGradeId, inYear(s, 'grades', s.activeYearId).find((g) => g.name === 'Grade 1').id);
  remove(s, 'grades', g1.id);
  assert.equal(crit.mainGradeId, null);
});

test('older saved evals load without a main grade', () => {
  const { s, crit } = setup();
  delete crit.mainGradeId;
  assert.equal(normalize(structuredClone(s)).criteria[0].mainGradeId, null);
});

test('title text is dark on light grade colors and white on dark ones', () => {
  assert.equal(readableText('#c49a2c'), '#3f3127', 'mustard');
  assert.equal(readableText('#f4e9c8'), '#3f3127');
  assert.equal(readableText('#5f6fb8'), '#ffffff', 'periwinkle');
  assert.equal(readableText('#3f8a8c'), '#ffffff');
});

test('assistant commands can set and clear an eval\'s main grade', () => {
  const { s, crit } = setup();
  assert.equal(runCommand(s, 'editEval', { eval: 'Plays the beat', mainGrade: 'Grade 1' }).mainGrade, 'Grade 1');
  assert.throws(() => runCommand(s, 'editEval', { eval: 'Plays the beat', mainGrade: 'Grade 5' }), /No grade called/);
  assert.equal(runCommand(s, 'editEval', { eval: 'Plays the beat', mainGrade: 'none' }).mainGrade, undefined);
  assert.equal(crit.mainGradeId, null);
});
