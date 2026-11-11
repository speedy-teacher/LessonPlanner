// The Template Maker window knows where to put things: a templates folder from the plan's Lesson Templates
// that is still in Google Drive (and maybe a pictures folder). Several → the teacher picks; the pick is remembered.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { describeSetup, driveFolders, findSetup, setupProblemText } from '../public/js/templateMaker/setup.js';
import { copyPace } from '../public/js/copyPace.js';
import { plannerState, teacherDrive } from './e2e/templateMaker/samples.js';

const pace = copyPace();
const found = (calls, opts) => findSetup(calls, plannerState(opts), 'yr_1', { pace });

test('the plan’s Drive folders are found by themselves', async () => {
  const { calls } = teacherDrive();
  const setup = describeSetup(await found(calls));
  assert.equal(setup.problem, null);
  assert.equal(setup.templateFolder.path, 'Lessons', 'the top watched folder is the default');
  assert.equal(setup.imageFolder.path, 'Bitmojis');
  assert.deepEqual(setup.several, { templateFolder: true, imageFolder: false });
});

test('folder paths read from the top down; another year’s folders aren’t offered', () => {
  const state = plannerState();
  assert.deepEqual(driveFolders(state, 'yr_1', 'deckFolders').map((f) => f.path), ['Lessons', 'Lessons › Grade 2']);
  assert.deepEqual(driveFolders(state, 'yr_other', 'deckFolders'), []);
});

test('a folder that was deleted in Drive isn’t offered', async () => {
  const { g, calls } = teacherDrive();
  g.get('g2Folder').trashed = true;
  assert.deepEqual((await found(calls)).templateFolders.map((f) => f.path), ['Lessons']);
});

test('a plan without a templates folder from Drive explains what to do', async () => {
  const { calls } = teacherDrive();
  const setup = describeSetup(await findSetup(calls, { ...plannerState(), deckFolders: [] }, 'yr_1', { pace }));
  assert.equal(setup.problem, 'no_templates');
  assert.match(setupProblemText(setup.problem), /\+ Add/);
});

test('the pictures folder is optional, and the teacher’s earlier picks are used', async () => {
  const { calls } = teacherDrive({ images: false });
  const none = await found(calls, { images: false });
  assert.equal(describeSetup(none).imageFolder, null);
  assert.equal(describeSetup(none, { templateFolderId: 'fld_g2' }).templateFolder.path, 'Lessons › Grade 2');
  const { calls: withPictures } = teacherDrive();
  assert.equal(describeSetup(await found(withPictures), { imageFolderId: 'none' }).imageFolder, null, '“no pictures” is remembered');
});
