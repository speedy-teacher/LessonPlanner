// Which cached records are listed as plans, which years count as brought in, and what removing a plan deletes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { broughtInYearIds, keysToRemove, listedPlans } from '../public/js/planList.js';

const oldPlan = { key: 'computer:plan1', name: 'Old', state: { years: [{ id: 'y1' }] } };
const sched = (n, yearKey, extra = {}) => ({ key: `computer:s${n}`, piece: 'schedule', name: `Schedule ${n}`, data: { meta: { links: { schoolYear: { key: yearKey }, resources: { key: 'computer:res' } } } }, ...extra });
const year = (key, id, extra = {}) => ({ key, piece: 'schoolYear', data: { years: [{ id }] }, ...extra });
const resources = { key: 'computer:res', piece: 'resources', data: {} };

test('only plans a teacher opens are listed: older plans and Lesson Schedules kept on this computer', () => {
  const records = [oldPlan, sched(1, 'computer:y1'), year('computer:y1', 'a'), resources, { key: 'rescue:computer:s1', state: {} },
    { key: 'drive:1', fileId: '1', piece: 'schedule', data: {} }, { key: 'drive:2', fileId: '2', state: { years: [] } }];
  assert.deepEqual(listedPlans(records).map((r) => r.key), ['computer:plan1', 'computer:s1']);
});

test('year ids come from older plans and from School Year pieces', () => {
  const ids = broughtInYearIds([oldPlan, year('computer:y1', 'a'), sched(1, 'computer:y1'), resources]);
  assert.deepEqual([...ids].sort(), ['a', 'y1']);
});

test('removing one of two local schedules keeps the shared Resources and the other schedule\'s School Year', () => {
  const records = [sched(1, 'computer:y1'), sched(2, 'computer:y2'), year('computer:y1', 'a'), year('computer:y2', 'b'), resources];
  const keys = keysToRemove(records, 'computer:s1');
  assert.ok(keys.includes('computer:s1') && keys.includes('computer:y1'));
  assert.ok(!keys.includes('computer:res') && !keys.includes('computer:y2'));
});

test('a School Year another schedule still uses, or one that lives in Drive, is kept', () => {
  const both = [sched(1, 'computer:y1'), sched(2, 'computer:y1'), year('computer:y1', 'a')];
  assert.ok(!keysToRemove(both, 'computer:s1').includes('computer:y1'));
  const inDrive = [sched(1, 'drive:y1'), year('drive:y1', 'a', { fileId: 'y1' })];
  assert.ok(!keysToRemove(inDrive, 'computer:s1').includes('drive:y1'));
});

test('removing an older one-file plan removes just that plan', () => {
  assert.deepEqual(keysToRemove([oldPlan], 'computer:plan1'), ['computer:plan1', 'rescue:computer:plan1']);
});
