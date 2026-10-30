// Grades have their own color (Setup › School Year), and evals can be named with their grades.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { add, createYear, emptyState, evalLabel, GRADE_PALETTE, inYear, nextColor, normalize } from '../public/js/model.js';
import { runCommand } from '../public/js/agentCommands.js';

function setup() {
  const s = emptyState();
  const year = createYear(s, { name: 'Year A', startDate: '2026-08-24', endDate: '2027-06-11' });
  return { s, year };
}

test('grades saved without a color each get a different one when the plan opens', () => {
  const { s, year } = setup();
  ['Kindergarten', 'Grade 1', 'Grade 2'].forEach((name) => add(s, 'grades', { yearId: year.id, name, short: name.at(-1) }));
  const opened = normalize(structuredClone(s));
  const colors = inYear(opened, 'grades', year.id).map((g) => g.color);
  assert.deepEqual(colors, GRADE_PALETTE.slice(0, 3));
});

test('a grade\'s chosen color is kept, and a new grade gets a color not used yet', () => {
  const { s, year } = setup();
  add(s, 'grades', { yearId: year.id, name: 'Kindergarten', short: 'K', color: GRADE_PALETTE[0] });
  assert.equal(nextColor(s, 'grades', year.id), GRADE_PALETTE[1]);
  const opened = normalize(structuredClone(s));
  assert.equal(opened.grades[0].color, GRADE_PALETTE[0]);
});

test('grade colors carry over to a new school year', () => {
  const { s, year } = setup();
  add(s, 'grades', { yearId: year.id, name: 'Grade 3', short: '3', color: '#123456' });
  const next = createYear(s, { name: 'Year B', startDate: '2027-08-23', endDate: '2028-06-09' }, year.id);
  assert.equal(inYear(s, 'grades', next.id)[0].color, '#123456');
});

test('assistant commands can add a grade with a color and change it', () => {
  const { s } = setup();
  runCommand(s, 'addSetupItem', { list: 'grades', name: 'Kindergarten', short: 'K' });
  runCommand(s, 'addSetupItem', { list: 'grades', name: 'Grade 1', color: '#8f5fa8' });
  assert.deepEqual(s.grades.map((g) => g.color), [GRADE_PALETTE[0], '#8f5fa8']);
  runCommand(s, 'editSetupItem', { list: 'grades', item: 'Kindergarten', color: '#3f8a8c' });
  assert.equal(s.grades[0].color, '#3f8a8c');
});

test('an eval\'s name shows its grade levels, in Setup order', () => {
  const { s, year } = setup();
  const [k, g1, g2] = ['Kindergarten', 'Grade 1', 'Grade 2'].map((name, i) => add(s, 'grades', { yearId: year.id, name, short: ['K', '1', '2'][i] }));
  const outcome = add(s, 'outcomes', { yearId: year.id, code: 'MU1', title: 'Steady beat' });
  const crit = add(s, 'criteria', { outcomeId: outcome.id, title: 'Plays the beat', gradeIds: [g2.id, k.id] });
  assert.equal(evalLabel(s, crit), 'Plays the beat (K, 2)');
  crit.gradeIds = [];
  assert.equal(evalLabel(s, crit), 'Plays the beat (no grade yet)');
  assert.ok(g1);
});
