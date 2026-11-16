// "+ Add" → "Files or folders…" on Lesson Templates: the picked Drive files (maybe a colleague's) are never used as
// templates — they're copied into the teacher's own templates folder and the copies are brought in, so editing a
// template never changes the original.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { copyPicked, makeTemplatesHome, templatesHome, watchingFolder } from '../public/js/templateCopies.js';
import { importDriveItems, isDriveLessonFile } from '../public/js/library.js';
import { KINDS } from '../public/js/templateMaker/fileKinds.js';
import { deck, plannerState, teacherDrive } from './e2e/templateMaker/samples.js';

const FOLDER = 'application/vnd.google-apps.folder';
const driveIdOf = (r) => r.locations.find((l) => l.kind === 'drive')?.fileId;

function colleagueDrive() {
  const drive = teacherDrive();
  const { g } = drive;
  g.add({ id: 'herFolder', name: 'Fall Unit', mimeType: FOLDER, ownedByMe: false, parents: ['hers'] });
  g.add({ id: 'herWeek', name: 'Week 3', mimeType: FOLDER, ownedByMe: false, parents: ['herFolder'] });
  g.add({ id: 'herDeck', name: 'Beat Lesson 1', mimeType: KINDS.slides.google, ownedByMe: false, parents: ['herFolder'], content: deck([{ texts: ['Steady Beat'] }]) });
  g.add({ id: 'herDeck2', name: 'Rest Lesson', mimeType: KINDS.slides.google, ownedByMe: false, parents: ['herWeek'], content: deck([{ texts: ['Rests'] }]) });
  g.add({ id: 'herShortcut', name: 'Link', mimeType: 'application/vnd.google-apps.shortcut', ownedByMe: false, parents: ['herFolder'] });
  return drive;
}

const pick = (g, id) => ({ id, name: g.get(id).name, mimeType: g.get(id).mimeType });
const copyAll = (drive, ids, home = 'tplFolder') => copyPicked(drive.calls, ids.map((id) => pick(drive.g, id)), { folderDriveId: home, wanted: isDriveLessonFile });

test('a colleague’s deck is copied into the templates folder, and the copy becomes the template', async () => {
  const drive = colleagueDrive();
  const before = structuredClone(drive.g.get('herDeck'));
  const { nodes, failed } = await copyAll(drive, ['herDeck']);
  assert.deepEqual(failed, []);
  assert.equal(nodes.length, 1);
  const copy = drive.g.get(nodes[0].id);
  assert.notEqual(copy.id, 'herDeck', 'never the original');
  assert.deepEqual(copy.parents, ['tplFolder']);
  assert.equal(copy.name, 'Beat Lesson 1', 'same name, no “Copy of”');
  assert.equal(copy.appProperties.lpCopiedFrom, 'herDeck');
  assert.equal(copy.properties.lessonPlanner, undefined, 'watched folders don’t skip it');
  const after = drive.g.get('herDeck');
  assert.deepEqual({ ...after, headRevisionId: null }, { ...before, headRevisionId: null }, 'her file is untouched');

  const state = plannerState();
  const folder = state.deckFolders.find((f) => f.id === 'fld_top');
  const r = importDriveItems(state, { yearId: 'yr_1', parentId: 'fld_top', nodes, seenBy: watchingFolder(state, 'fld_top') });
  assert.equal(r.added.length, 1);
  assert.equal(driveIdOf(r.added[0]), copy.id);
  assert.equal(r.added[0].folderId, 'fld_top');
  assert.ok(folder.seenDriveIds.includes(copy.id), 'the watched templates folder won’t bring it in twice');
});

test('a picked folder is copied as a new folder in the templates folder, folders inside too', async () => {
  const drive = colleagueDrive();
  const { nodes } = await copyAll(drive, ['herFolder']);
  const [top] = nodes;
  assert.notEqual(top.id, 'herFolder');
  assert.equal(top.name, 'Fall Unit');
  assert.deepEqual(drive.g.get(top.id).parents, ['tplFolder']);
  assert.deepEqual(top.children.map((c) => c.name).sort(), ['Beat Lesson 1', 'Week 3'], 'the shortcut is left out');
  const week = top.children.find((c) => c.name === 'Week 3');
  assert.deepEqual(drive.g.get(week.id).parents, [top.id]);
  assert.deepEqual(drive.g.get(week.children[0].id).parents, [week.id]);
  assert.ok([...drive.g.files.values()].filter((f) => f.parents.includes('herFolder')).length === 3, 'nothing added to her folder');

  const state = plannerState();
  const r = importDriveItems(state, { yearId: 'yr_1', parentId: 'fld_top', nodes, seenBy: watchingFolder(state, 'fld_top') });
  assert.equal(r.added.length, 2);
  assert.ok(r.added.every((l) => !['herDeck', 'herDeck2'].includes(driveIdOf(l))));
  assert.ok(r.folders.every((f) => !f.watch), 'the templates folder’s watching covers them');
});

test('picking the same things again reuses the copies made before', async () => {
  const drive = colleagueDrive();
  const first = await copyAll(drive, ['herFolder', 'herDeck']);
  const count = drive.g.files.size;
  const again = await copyAll(drive, ['herFolder', 'herDeck']);
  assert.equal(drive.g.files.size, count, 'no new copies');
  assert.deepEqual(again.nodes.map((n) => n.id), first.nodes.map((n) => n.id));
});

test('a file already in the templates folder is used as it is', async () => {
  const drive = colleagueDrive();
  drive.g.add({ id: 'mineInTpl', name: 'Echo', mimeType: KINDS.slides.google, parents: ['tplFolder'] });
  const count = drive.g.files.size;
  const { nodes } = await copyAll(drive, ['mineInTpl', 'tplFolder']);
  assert.equal(drive.g.files.size, count);
  assert.equal(nodes[0].id, 'mineInTpl');
  assert.equal(nodes[1].id, 'tplFolder');
});

test('files that can’t be copied are named; files that aren’t lessons are handed back to be skipped', async () => {
  const drive = colleagueDrive();
  drive.g.failNext('/herDeck/copy', { status: 403, reason: 'cannotCopyFile', times: 1 });
  drive.g.add({ id: 'herPlan', name: 'Plan', mimeType: 'application/json', properties: { lessonPlanner: 'schedule' } });
  const { nodes, failed } = await copyAll(drive, ['herDeck', 'herPlan']);
  assert.deepEqual(failed, ['Beat Lesson 1']);
  assert.deepEqual(nodes.map((n) => n.id), ['herPlan']);
  const r = importDriveItems(plannerState(), { yearId: 'yr_1', nodes });
  assert.deepEqual(r.skipped, ['Plan']);
});

test('the templates folder: the teacher’s own Drive folder, never a colleague’s', async () => {
  const drive = colleagueDrive();
  const state = plannerState();
  state.deckFolders.push({ id: 'fld_hers', yearId: 'yr_1', name: 'Fall Unit', parentId: null, watch: true, seenDriveIds: [], locations: [{ kind: 'drive', fileId: 'herFolder', uri: 'x' }] });
  assert.equal((await templatesHome(drive.calls, state, 'yr_1', { prefer: ['fld_hers'] })).id, 'fld_top');
  assert.equal((await templatesHome(drive.calls, state, 'yr_1', { prefer: ['fld_g2'] })).id, 'fld_g2', 'the “Adds to” folder first');
  assert.equal((await templatesHome(drive.calls, state, 'yr_1')).id, 'fld_top', 'else the top watched one');

  state.deckFolders = state.deckFolders.filter((f) => f.id === 'fld_hers');
  assert.equal(await templatesHome(drive.calls, state, 'yr_1'), null);
  const made = await makeTemplatesHome(drive.calls);
  assert.equal(drive.g.get(made.id).name, 'Lesson Templates');
  assert.equal(drive.g.get(made.id).mimeType, FOLDER);
});

test('the Template Maker never offers a colleague’s folder as a templates folder', async () => {
  const { findSetup } = await import('../public/js/templateMaker/setup.js');
  const { copyPace } = await import('../public/js/copyPace.js');
  const drive = colleagueDrive();
  const state = plannerState();
  state.deckFolders.push({ id: 'fld_hers', yearId: 'yr_1', name: 'Fall Unit', parentId: null, watch: true, seenDriveIds: [], locations: [{ kind: 'drive', fileId: 'herFolder', uri: 'x' }] });
  const found = await findSetup(drive.calls, state, 'yr_1', { pace: copyPace() });
  assert.deepEqual(found.templateFolders.map((f) => f.id).sort(), ['fld_g2', 'fld_top']);
});
