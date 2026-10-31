// Moving a plan to pieces is stopped, with nothing changed, unless its Drive version is locked in first.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lockOldVersion } from '../public/js/oldPlanLock.js';

test('a saved plan has its Drive version kept forever, and the move goes ahead', async () => {
  const kept = [];
  const rev = await lockOldVersion({ saved: () => true, info: async () => ({ rev: 'r9' }), keep: async (r) => { kept.push(r); } });
  assert.equal(rev, 'r9');
  assert.deepEqual(kept, ['r9']);
});

test('changes that haven’t reached Drive yet stop the move before anything is asked of Drive', async () => {
  let asked = false;
  await assert.rejects(lockOldVersion({ saved: () => false, info: async () => { asked = true; return { rev: 'r1' }; }, keep: async () => {} }), /not_saved/);
  assert.equal(asked, false);
});

test('Drive refusing to keep the version stops the move', async () => {
  await assert.rejects(lockOldVersion({ saved: () => true, info: async () => ({ rev: 'r1' }), keep: async () => { throw new Error('drive_failed'); } }), /cant_keep_backup/);
});

test('a plan with no Drive version to keep stops the move', async () => {
  await assert.rejects(lockOldVersion({ saved: () => true, info: async () => ({ rev: null }), keep: async () => {} }), /cant_keep_backup/);
});
