// Plan files: each school year is one file that can live in Google Drive, be shared or downloaded.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { add, createYear, criteriaFor, emptyState, inYear, normalize, stepsFor } from '../public/js/model.js';
import { seedState } from '../public/js/seed.js';
import {
  forgetPlan, fromWorkspaceFile, newYearPlan, planName, rememberPlan, shouldKeepRevision, splitYears, syncAction,
  toWorkspaceFile, WORKSPACE_KIND, yearOnly,
} from '../public/js/workspaceFile.js';

/** Two years, each with its own school, outcome, eval criterion, lesson order and calendar. */
function twoYears() {
  const s = seedState();
  const first = s.years[0];
  createYear(s, { name: '2027–2028', startDate: '2027-08-23', endDate: '2028-06-09' }, first.id);
  const second = s.years[1];
  add(s, 'placements', { yearId: second.id, schoolId: inYear(s, 'schools', second.id)[0].id, gradeId: null, criterionId: null, startDate: '2027-09-01', endDate: '2027-09-03' });
  return { s, first, second };
}

test('a planner file with several years becomes one plan per year, each complete on its own', () => {
  const { s, first, second } = twoYears();
  const plans = splitYears(s);
  assert.deepEqual(plans.map((p) => p.name), [`Music Plans ${first.name}`, `Music Plans ${second.name}`]);
  for (const [i, year] of [first, second].entries()) {
    const plan = plans[i].state;
    assert.deepEqual(plan.years.map((y) => y.id), [year.id]);
    assert.equal(plan.activeYearId, year.id);
    for (const name of ['schools', 'grades', 'instruments', 'outcomes', 'lessons', 'placements', 'instrumentBlocks', 'weekLessons']) {
      assert.deepEqual(plan[name], inYear(s, name, year.id), `${name} of ${year.name}`);
    }
    // Evals and lesson order come along with their outcome.
    const outcomes = inYear(s, 'outcomes', year.id);
    assert.deepEqual(plan.criteria, outcomes.flatMap((o) => criteriaFor(s, o.id)));
    assert.equal(plan.criterionLessons.length, plan.criteria.flatMap((c) => stepsFor(s, c.id)).length);
    assert.ok(plan.criteria.length > 0 && plan.criterionLessons.length > 0);
  }
});

test('splitting a year off does not change the original data', () => {
  const { s, second } = twoYears();
  const before = JSON.stringify(s);
  const plan = yearOnly(s, second.id);
  plan.schools[0].name = 'Changed';
  assert.equal(JSON.stringify(s), before);
});

test('a new school year is a new plan: lists, decks and outcomes come along, calendars start empty', () => {
  const seed = seedState();
  const s = yearOnly(seed, seed.years[0].id);
  const old = s.years[0];
  const fields = { name: '2027–2028', startDate: '2027-08-23', endDate: '2028-06-09' };
  const { name, state } = newYearPlan(s, fields);
  assert.equal(name, 'Music Plans 2027–2028');
  assert.equal(state.years.length, 1);
  const year = state.years[0];
  assert.notEqual(year.id, old.id);
  assert.equal(state.schools.length, inYear(s, 'schools', old.id).length);
  assert.equal(state.lessons.length, inYear(s, 'lessons', old.id).length);
  assert.equal(state.outcomes.length, inYear(s, 'outcomes', old.id).length);
  assert.equal(state.criteria.length, s.criteria.length);
  assert.ok(state.schools.every((r) => r.yearId === year.id && r.copiedFromId));
  assert.deepEqual([state.placements, state.instrumentBlocks, state.weekLessons], [[], [], []]);
  assert.equal(s.years.length, 1, 'the old plan keeps just its own year');

  const blank = newYearPlan(s, fields, { copy: false }).state;
  assert.deepEqual([blank.years.length, blank.schools.length, blank.lessons.length], [1, 0, 0]);
});

test('a plan file is marked as one, reads back the same, and other files are refused', () => {
  const s = normalize(seedState());
  const text = toWorkspaceFile(s);
  assert.equal(JSON.parse(text).kind, WORKSPACE_KIND);
  assert.deepEqual(fromWorkspaceFile(text), s);
  // Files saved by the older planner open too.
  assert.deepEqual(fromWorkspaceFile(JSON.stringify(s)), s);
  for (const bad of ['', 'not json', '{"hello":1}', '[1,2]', '{"schemaVersion":"5","years":[]}']) {
    assert.throws(() => fromWorkspaceFile(bad), /not_a_plan/, bad);
  }
});

test('plans opened recently are listed newest first, once each', () => {
  let list = [];
  list = rememberPlan(list, { key: 'a', name: 'A' }, '2026-01-01');
  list = rememberPlan(list, { key: 'b', name: 'B' }, '2026-01-02');
  list = rememberPlan(list, { key: 'a', name: 'A renamed' }, '2026-01-03');
  assert.deepEqual(list.map((p) => [p.key, p.name]), [['a', 'A renamed'], ['b', 'B']]);
  assert.deepEqual(forgetPlan(list, 'a').map((p) => p.key), ['b']);
  for (let i = 0; i < 20; i += 1) list = rememberPlan(list, { key: `k${i}`, name: '' });
  assert.equal(list.length, 12);
});

test('changes from another computer are never quietly overwritten', () => {
  assert.equal(syncAction({ localChanges: false, knownRev: 'r1', remoteRev: 'r1' }), 'none');
  assert.equal(syncAction({ localChanges: true, knownRev: 'r1', remoteRev: 'r1' }), 'upload');
  assert.equal(syncAction({ localChanges: false, knownRev: 'r1', remoteRev: 'r2' }), 'download');
  assert.equal(syncAction({ localChanges: true, knownRev: 'r1', remoteRev: 'r2' }), 'conflict');
});

test('Google Drive is asked to keep one version per day', () => {
  assert.ok(shouldKeepRevision(null, '2026-10-28'));
  assert.ok(shouldKeepRevision('2026-10-27', '2026-10-28'));
  assert.ok(!shouldKeepRevision('2026-10-28', '2026-10-28'));
});

test('plan names come from the school year', () => {
  assert.equal(planName({ name: '2026–2027' }), 'Music Plans 2026–2027');
  assert.equal(planName(null), 'Music Plans');
  assert.deepEqual(splitYears(emptyState()), []);
});
