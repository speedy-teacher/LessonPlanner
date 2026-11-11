// Finding lesson and week numbers in a file's text (fuzzy), and what they become.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyMatches, findInLine, findNumbers, preview } from '../public/js/templateMaker/numberMatch.js';

const replaced = (text) => applyMatches(text, findNumbers(text));

test('lesson and week numbers become Lesson Planner placeholders (the words stay)', () => {
  assert.equal(replaced('Lesson 1+2 Week 5'), 'Lesson {{lesson_number}} Week {{week_number}}');
  assert.equal(replaced('Day 2'), 'Day {{lesson_number}}');
  assert.equal(replaced('Week 5-6'), 'Week {{week_number}}');
});

test('fuzzy spellings, gaps and number words are found', () => {
  assert.equal(replaced('Lesson #3'), 'Lesson #{{lesson_number}}');
  assert.equal(replaced('Wk. 4'), 'Wk. {{week_number}}');
  assert.equal(replaced('WEEK: 12'), 'WEEK: {{week_number}}');
  assert.equal(replaced('Leson 2'), 'Leson {{lesson_number}}');
  assert.equal(replaced('Lessson two'), 'Lessson {{lesson_number}}');
  assert.equal(replaced('Lesson one and two'), 'Lesson {{lesson_number}}');
  assert.equal(replaced('Week5'), 'Week {{week_number}}');
  assert.equal(replaced('Week No. 7'), 'Week No. {{week_number}}');
});

test('a blank to fill in gets the placeholder', () => {
  assert.equal(replaced('Week ____'), 'Week {{week_number}}');
  assert.equal(replaced('Rhythm Review - Week'), 'Rhythm Review - Week {{week_number}}');
});

test('things that only look like numbers are left alone', () => {
  assert.deepEqual(findNumbers('Field Day 2026'), []);
  assert.deepEqual(findNumbers('Today 5 friends sang'), []);
  assert.deepEqual(findNumbers('Lesson {{lesson_number}} Week {{week_number}}'), []);
  assert.deepEqual(findNumbers('Weekend fun'), []);
  assert.deepEqual(findNumbers('Lessons learned'), []);
});

test('long lines (lesson text, not a title) are skipped', () => {
  const long = 'In lesson 3 we will clap the rhythm together and then sing the song with our friends';
  assert.deepEqual(findInLine(long), []);
  assert.equal(findNumbers(`Lesson 3\n${long}`).length, 1);
});

test('big lesson numbers default to the lesson number in the year', () => {
  assert.equal(findInLine('Lesson 2')[0].field, 'lessonNumber');
  assert.equal(findInLine('Lesson 23')[0].field, 'lessonNumberAbs');
  assert.equal(replaced('Lesson 23'), 'Lesson {{lesson_number_abs}}');
});

test('the teacher can switch a lesson number to the one in the year', () => {
  const [m] = findNumbers('Lesson 2');
  assert.equal(applyMatches('Lesson 2', [{ ...m, chosenField: 'lessonNumberAbs' }]), 'Lesson {{lesson_number_abs}}');
});

test('positions count across lines, and the preview shows the line before and after', () => {
  const text = 'Rhythm Tree\nLesson 1 · Week 5';
  const matches = findNumbers(text);
  assert.equal(matches.length, 2);
  assert.equal(text.slice(matches[1].start, matches[1].end), '5');
  assert.deepEqual(preview(matches[1]), { before: 'Lesson 1 · Week 5', after: 'Lesson 1 · Week {{week_number}}' });
});
