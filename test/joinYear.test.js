// Joining a School Year a colleague shared: my schools, grades, instruments, outcomes and evals are
// matched to theirs by name; my schedule, lesson order and templates then point at the shared ones.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { add, normalize } from '../public/js/model.js';
import { seedState } from '../public/js/seed.js';
import { composeState, splitState } from '../public/js/pieces.js';
import { joinedPieces, matchToSchoolYear } from '../public/js/joinYear.js';

function myPlan() {
  const s = normalize(seedState());
  add(s, 'weekLessons', {
    yearId: s.activeYearId, schoolId: s.schools[0].id, gradeId: s.grades[3].id, weekStart: '2026-09-14', lessonId: s.lessons[0].id, criterionId: s.criteria[0].id, position: 0,
  });
  s.grades[3].color = '#123456';
  s.years[0].reports = { watched: [{ id: 'w1', schoolId: s.schools[0].id, gradeIds: [s.grades[3].id] }] };
  return normalize(s);
}

/** The department's School Year: the same names, made separately (so every id is different). */
function departmentYear() {
  return splitState(normalize(seedState())).schoolYear;
}

test('everything with the same name is matched, even written a little differently', () => {
  const mine = myPlan();
  const theirs = departmentYear();
  theirs.grades[0].name = theirs.grades[0].name.toUpperCase();
  const { map, unmatched } = matchToSchoolYear(mine, theirs);
  assert.deepEqual(unmatched, []);
  for (const collection of ['schools', 'grades', 'instruments', 'outcomes', 'criteria']) {
    mine[collection].forEach((r, i) => assert.equal(map[r.id], theirs[collection][i].id, `${collection} ${i}`));
  }
  assert.equal(map[mine.years[0].id], theirs.years[0].id);
});

test('things without a match are listed with the choices to pick from', () => {
  const mine = myPlan();
  const theirs = departmentYear();
  theirs.schools[0].name = 'Somewhere Else Elementary';
  const { unmatched } = matchToSchoolYear(mine, theirs);
  assert.equal(unmatched.length, 1);
  assert.equal(unmatched[0].collection, 'schools');
  assert.equal(unmatched[0].id, mine.schools[0].id);
  assert.deepEqual(unmatched[0].choices.map((c) => c.label), theirs.schools.map((s) => s.name));
});

test('evals are only matched inside the matching outcome', () => {
  const mine = myPlan();
  const theirs = departmentYear();
  const crit = mine.criteria[0];
  const theirOutcome = theirs.outcomes.find((o) => o.code === mine.outcomes.find((x) => x.id === crit.outcomeId).code);
  const { unmatched } = matchToSchoolYear(mine, { ...theirs, criteria: theirs.criteria.filter((c) => c.title !== crit.title) });
  const missing = unmatched.find((u) => u.id === crit.id);
  assert.ok(missing);
  assert.ok(missing.choices.every((c) => theirs.criteria.find((x) => x.id === c.id).outcomeId === theirOutcome.id));
});

test('after joining, my schedule, lesson order, templates, colors and reports point at the shared School Year', () => {
  const mine = myPlan();
  const theirs = departmentYear();
  const { map } = matchToSchoolYear(mine, theirs);
  const joined = joinedPieces(mine, theirs, map);
  const shown = composeState({ schoolYear: theirs, ...joined });
  const has = (collection, id) => shown[collection].some((r) => r.id === id);
  const entry = shown.weekLessons[0];
  assert.ok(has('schools', entry.schoolId) && has('grades', entry.gradeId) && has('criteria', entry.criterionId));
  assert.ok(has('lessons', entry.lessonId), 'my templates keep their own ids');
  assert.ok(shown.criterionLessons.every((c) => has('criteria', c.criterionId) && has('lessons', c.lessonId)));
  assert.ok(shown.lessons.flatMap((l) => l.instrumentIds).every((id) => has('instruments', id)));
  assert.equal(shown.grades[3].color, '#123456', 'my grade colors carry over');
  assert.equal(shown.years[0].reports.watched[0].schoolId, theirs.schools[0].id);
  assert.deepEqual(shown.years[0].reports.watched[0].gradeIds, [theirs.grades[3].id]);
  assert.equal(shown.activeYearId, theirs.years[0].id);
  assert.equal(shown.schools.length, theirs.schools.length, 'the shared School Year is untouched');
});

test('something left unmatched keeps pointing at my old one (shown as not available, nothing lost)', () => {
  const mine = myPlan();
  const theirs = departmentYear();
  theirs.schools[0].name = 'Somewhere Else Elementary';
  const { map } = matchToSchoolYear(mine, theirs);
  const joined = joinedPieces(mine, theirs, map);
  assert.equal(joined.schedule.weekLessons[0].schoolId, mine.schools[0].id);
});
