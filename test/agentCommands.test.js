// Behavior tests for the assistant commands (an AI assistant runs the planner by name, not by clicking).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { add, addStep, createYear, emptyState } from '../public/js/model.js';
import { CommandError, describeCommands, runCommand, runCommands } from '../public/js/agentCommands.js';

function setup() {
  const s = emptyState();
  const year = createYear(s, { name: 'Year A', startDate: '2026-08-26', endDate: '2026-10-06' });
  add(s, 'schools', { yearId: year.id, name: 'Test School' });
  add(s, 'grades', { yearId: year.id, name: 'Grade 3', short: '3' });
  add(s, 'instruments', { yearId: year.id, name: 'Ukulele', color: '#b5654a' });
  const deck = (name) => add(s, 'lessons', { yearId: year.id, name, category: 'Singing', autoFields: [], instrumentIds: [] });
  const [a, b] = [deck('Alpha'), deck('Bravo')];
  const outcome = add(s, 'outcomes', { yearId: year.id, code: 'MU1', title: 'Steady beat', color: '#6b8f5e' });
  const crit = add(s, 'criteria', { outcomeId: outcome.id, title: 'Plays the beat', gradeIds: [s.grades[0].id] });
  [a, b].forEach((l) => addStep(s, crit.id, l.id));
  return s;
}

const cls = { school: 'Test School', grade: 'Grade 3' };
const lessonsIn = (s, week) => runCommand(s, 'getSchedule', { ...cls, fromWeek: week, toWeek: week })[0].lessons.map((l) => l.lesson);

test('the assistant can read an overview of the open year', () => {
  const o = runCommand(setup(), 'overview');
  assert.equal(o.year, 'Year A');
  assert.equal(o.weeks, 7);
  assert.deepEqual(o.schools, ['Test School']);
  assert.equal(o.lessonCount, 2);
});

test('every command is described with what it needs', () => {
  const list = describeCommands();
  const add = list.find((c) => c.name === 'addLessonToWeek');
  assert.equal(add.changesThePlan, true);
  assert.match(add.params.lesson, /required/);
  assert.equal(list.find((c) => c.name === 'overview').changesThePlan, false);
});

test('lessons are added to a week by name, in the chosen order, using week numbers or dates', () => {
  const s = setup();
  runCommand(s, 'addLessonToWeek', { ...cls, week: 2, lesson: 'alpha' });
  runCommand(s, 'addLessonToWeek', { ...cls, week: '2026-09-03', lesson: 'Bravo', position: 1 });
  assert.deepEqual(lessonsIn(s, 2), ['Bravo', 'Alpha']);
});

test('a scheduled lesson can be moved to another week and removed', () => {
  const s = setup();
  const { entryId } = runCommand(s, 'addLessonToWeek', { ...cls, week: 1, lesson: 'Alpha' });
  runCommand(s, 'moveScheduledLesson', { entryId, week: 3 });
  assert.deepEqual(lessonsIn(s, 1), []);
  assert.deepEqual(lessonsIn(s, 3), ['Alpha']);
  runCommand(s, 'removeScheduledLesson', { entryId });
  assert.deepEqual(lessonsIn(s, 3), []);
  assert.equal(s.lessons.length, 2, 'the lesson template is kept');
});

test('evals are placed on the calendar, re-dated, and the schedule fills from it', () => {
  const s = setup();
  const placed = runCommand(s, 'placeEval', { ...cls, eval: 'Plays the beat', startDate: '2026-09-07', endDate: '2026-09-18' });
  assert.equal(placed.outcome, 'MU1 · Steady beat');
  runCommand(s, 'changeEvalDates', { placementId: placed.id, endDate: '2026-09-11' });
  assert.equal(runCommand(s, 'getCalendar', cls)[0].endDate, '2026-09-11');
  assert.equal(runCommand(s, 'fillScheduleFromCalendar', cls).lessonsPlaced, 2);
  assert.deepEqual(lessonsIn(s, 3), ['Alpha', 'Bravo']);
  runCommand(s, 'removeEval', { placementId: placed.id });
  assert.deepEqual(runCommand(s, 'getCalendar', cls), []);
});

test('instrument days can be turned on and off for a school', () => {
  const s = setup();
  runCommand(s, 'setInstrumentDays', { school: 'Test School', instrument: 'Ukulele', startDate: '2026-09-07', endDate: '2026-09-18' });
  runCommand(s, 'setInstrumentDays', { school: 'Test School', instrument: 'Ukulele', startDate: '2026-09-14', present: false });
  const [uke] = runCommand(s, 'getInstrumentSchedule', { school: 'Test School' });
  assert.deepEqual(uke.ranges, [
    { startDate: '2026-09-07', endDate: '2026-09-11' },
    { startDate: '2026-09-15', endDate: '2026-09-18' },
  ]);
});

test('mistakes come back as plain-language messages that list the choices', () => {
  const s = setup();
  assert.throws(() => runCommand(s, 'addLessonToWeek', { ...cls, week: 1, lesson: 'Zulu' }), (e) => e instanceof CommandError && /Alpha, Bravo/.test(e.message));
  assert.throws(() => runCommand(s, 'addLessonToWeek', { ...cls, week: 99, lesson: 'Alpha' }), /week number from 1 to 7/);
  assert.throws(() => runCommand(s, 'addLessonToWeek', { ...cls, week: 1 }), /needs: lesson/);
  assert.throws(() => runCommand(s, 'placeEval', { ...cls, eval: 'Plays the beat', startDate: '2027-01-04' }), /outside the school year/);
  assert.throws(() => runCommand(s, 'flyToTheMoon'), /no command called/);
});

test('a list of commands is all or nothing', () => {
  const s = setup();
  const before = JSON.stringify(s);
  assert.throws(() => runCommands(s, [
    { command: 'addLessonToWeek', args: { ...cls, week: 1, lesson: 'Alpha' } },
    { command: 'addLessonToWeek', args: { ...cls, week: 1, lesson: 'Nope' } },
  ]), /Step 2 \(addLessonToWeek\).*Nothing was changed/);
  assert.equal(JSON.stringify(s), before);

  const ok = runCommands(s, [
    { command: 'addLessonToWeek', args: { ...cls, week: 1, lesson: 'Alpha' } },
    { command: 'addLessonToWeek', args: { ...cls, week: 1, lesson: 'Bravo' } },
  ]);
  assert.equal(ok.changed, true);
  assert.equal(JSON.stringify(s), before, 'the original is only replaced by the caller');
  assert.deepEqual(lessonsIn(ok.state, 1), ['Alpha', 'Bravo']);
  assert.equal(runCommands(s, [{ command: 'overview', args: {} }]).changed, false);
});
