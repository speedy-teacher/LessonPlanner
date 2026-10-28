// Lesson Templates: what to type in the slides for each automatic detail, and adding a deck to an eval.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addStep, AUTO_FIELD_PLACEHOLDERS, AUTO_FIELDS, criteriaFor, inYear, lessonEvals, stepsFor } from '../public/js/model.js';
import { seedState } from '../public/js/seed.js';

test('every automatic detail has its own {{…}} text to type in the slides', () => {
  assert.deepEqual(Object.keys(AUTO_FIELD_PLACEHOLDERS).sort(), Object.keys(AUTO_FIELDS).sort());
  const texts = Object.values(AUTO_FIELD_PLACEHOLDERS);
  assert.equal(new Set(texts.map((t) => t.toLowerCase())).size, texts.length, 'no two are the same');
  for (const text of texts) assert.match(text, /^\{\{[A-Z][a-z ]+\}\}$/);
  assert.equal(AUTO_FIELD_PLACEHOLDERS.school, '{{School}}');
});

test('a lesson deck added to an eval goes last in its lesson order', () => {
  const s = seedState();
  const yearId = s.years[0].id;
  const crit = criteriaFor(s, inYear(s, 'outcomes', yearId)[0].id)[0];
  const lesson = inYear(s, 'lessons', yearId).find((l) => !lessonEvals(s, l.id).some((e) => e.criterion.id === crit.id));
  const before = stepsFor(s, crit.id).length;
  addStep(s, crit.id, lesson.id);
  const steps = stepsFor(s, crit.id);
  assert.equal(steps.length, before + 1);
  assert.equal(steps.at(-1).lessonId, lesson.id);
  assert.ok(lessonEvals(s, lesson.id).some((e) => e.criterion.id === crit.id && e.positions.includes(before + 1)));
});
