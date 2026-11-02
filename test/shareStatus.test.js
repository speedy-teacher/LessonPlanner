// The sharing capsules: each part of a plan in pieces says which file it's in and whether Google Drive
// has it shared, so a teacher can see at a glance what colleagues can see.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { partCapsule, sharingOf } from '../public/js/shareStatus.js';

const mine = (shared) => ({ fileId: 'f1', ownedByMe: true, canEdit: true, shared });

test('my own file: "Shared" or "Only you", as Drive says', () => {
  assert.equal(sharingOf(mine(true)).word, 'Shared');
  assert.equal(sharingOf(mine(false)).word, 'Only you');
});

test('not checked with Drive yet: says it is in Drive, not a guess', () => {
  const s = sharingOf(mine(null));
  assert.equal(s.word, 'In Google Drive');
  assert.equal(s.tone, 'unknown');
});

test('a colleague’s file: "Shared with you", and view only when shared as Viewer', () => {
  const theirs = { fileId: 'f2', ownedByMe: false, owner: 'Pat Example', canEdit: true, shared: true };
  assert.equal(sharingOf(theirs).word, 'Shared with you');
  assert.match(sharingOf(theirs).tip, /Pat Example/);
  assert.equal(sharingOf({ ...theirs, canEdit: false }).word, 'Shared with you · view only');
});

test('kept on this computer only, or missing', () => {
  assert.equal(sharingOf({ fileId: null }).word, 'On this computer');
  assert.equal(sharingOf(null).tone, 'missing');
});

test('the capsule names the part (and whose it is) and its tip says what is in that file', () => {
  const c = partCapsule('schedule', mine(false));
  assert.equal(c.label, 'Lesson Schedule');
  assert.match(c.tip, /grade and instrument colors/);
  assert.equal(partCapsule('resources', mine(true), { whose: 'Lee Placeholder' }).label, 'Lee Placeholder’s Teacher Resources');
  assert.match(partCapsule('schoolYear', mine(true)).tip, /calendars/);
});
