// The Template Maker window with whole folders and a place for each template: pick a folder and every lesson
// inside it (and its folders) is made into a template; each template can go in a folder of its own, chosen
// before or while looking; the pictures of the made templates are drawn again after the teacher edits them.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSession } from '../public/js/templateMaker/session.js';
import { addTemplates } from '../public/js/templateMaker/addToPlan.js';
import { filesFromPicks, MAX_FROM_FOLDERS } from '../public/js/templateMaker/folderFiles.js';
import { KINDS } from '../public/js/templateMaker/fileKinds.js';
import { copyPace } from '../public/js/copyPace.js';
import { deck, plannerState, teacherDrive } from './e2e/templateMaker/samples.js';

const FOLDER = 'application/vnd.google-apps.folder';
const wait = (ms) => new Promise((r) => { setTimeout(r, ms); });

async function visit() {
  const drive = teacherDrive();
  const { g } = drive;
  const m = new Map();
  const storage = { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, v), removeItem: (k) => m.delete(k) };
  const plan = { now: plannerState(), adds: 0 };
  const api = {
    state: () => plan.now, yearId: () => 'yr_1',
    add: (made) => { plan.adds += 1; return addTemplates(plan.now, made, { yearId: 'yr_1', now: '2026-11-16T10:00:00Z' }); },
  };
  // A unit folder: two lessons, a PDF and a picture, and a "Week 3" folder with one more lesson.
  g.add({ id: 'unitFolder', name: 'Fall Unit', mimeType: FOLDER, parents: ['mine'] });
  g.add({ id: 'wk3Folder', name: 'Week 3', mimeType: FOLDER, parents: ['unitFolder'] });
  g.add({ id: 'deckA', name: 'Beat Lesson 1', mimeType: KINDS.slides.google, parents: ['unitFolder'], content: deck([{ texts: ['Steady Beat', 'Lesson 1 · Week 2'] }]) });
  g.add({ id: 'deckB', name: 'Echo Lesson 2', mimeType: KINDS.slides.google, parents: ['unitFolder'], content: deck([{ texts: ['Echo', 'Lesson 2 · Week 2'] }]) });
  g.add({ id: 'pdf1', name: 'Song words.pdf', mimeType: 'application/pdf', parents: ['unitFolder'] });
  g.add({ id: 'png1', name: 'Drum.png', mimeType: 'image/png', parents: ['unitFolder'] });
  g.add({ id: 'deckC', name: 'Rest Lesson 1', mimeType: KINDS.slides.google, parents: ['wk3Folder'], content: deck([{ texts: ['Rests', 'Lesson 1 · Week 3'] }]) });
  g.add({ id: 'otherFolder', name: 'Winter Templates', mimeType: FOLDER });
  const session = createSession({ calls: drive.calls, pace: copyPace(), storage, plan: api });
  await session.checkSetup();
  return { ...drive, session, plan };
}

const unit = { id: 'unitFolder', name: 'Fall Unit', mimeType: FOLDER };

test('picking a folder brings in every lesson inside it and its folders, saying where each came from', async () => {
  const { session } = await visit();
  await session.addFiles([unit]);
  const { files } = session.state;
  assert.deepEqual(files.map((f) => f.source.name), ['Beat Lesson 1', 'Echo Lesson 2', 'Rest Lesson 1']);
  assert.deepEqual(files.map((f) => f.source.fromFolder), ['Fall Unit', 'Fall Unit', 'Fall Unit › Week 3']);
  assert.deepEqual(files.map((f) => f.status), ['ready', 'ready', 'ready']);
  assert.match(session.state.folderNote, /2 files that aren’t lessons were left out/);
  await session.addFiles([unit]);
  assert.equal(session.state.files.length, 3, 'picking the same folder again adds nothing twice');
});

test('files and folders can be picked together; a file also inside a picked folder is listed once', async () => {
  const { calls } = await visit();
  const deckA = { id: 'deckA', name: 'Beat Lesson 1', mimeType: KINDS.slides.google };
  const found = await filesFromPicks(calls, [deckA, unit]);
  assert.deepEqual(found.files.map((f) => f.id), ['deckA', 'deckB', 'deckC']);
  assert.equal(found.files[0].fromFolder, undefined, 'picked on its own');
});

test('a huge folder is cut off with a note, not read for hours', async () => {
  const many = Array.from({ length: MAX_FROM_FOLDERS + 5 }, (_, i) => ({ id: `f${i}`, name: `Lesson ${i}`, mimeType: KINDS.docs.google, parents: ['big'] }));
  const found = await filesFromPicks({ listFolder: async () => many }, [{ id: 'big', name: 'Everything', mimeType: FOLDER }]);
  assert.equal(found.files.length, MAX_FROM_FOLDERS);
  assert.equal(found.tooMany, true);
});

test('each template can go in a folder of its own, chosen before making and changed while looking', async () => {
  const { g, session, plan } = await visit();
  await session.addFiles([unit]);
  const [a, b, c] = session.state.files;
  session.setFolder(b.uid, 'fld_g2');
  await session.makeAll();
  assert.equal(session.state.phase, 'review');
  assert.deepEqual(g.get(a.made.lesson.fileId).parents, ['tplFolder'], 'the folder chosen for all');
  assert.deepEqual(g.get(b.made.lesson.fileId).parents, ['g2Folder'], 'its own folder');
  session.pickFolder({ id: 'otherFolder', name: 'Winter Templates' }, c.uid);
  assert.equal(session.state.setup.chosen.templateFolder.id, 'fld_top', 'the folder for all is unchanged');
  assert.ok(session.state.setup.chosen.templateFolders.some((f) => f.driveId === 'otherFolder'), 'the picked folder is offered in the lists');
  session.setFolder(a.uid, 'fld_g2');
  await session.addKept();
  assert.equal(session.state.save.count, 3);
  assert.deepEqual([a, b, c].map((f) => g.get(f.made.lesson.fileId).parents), [['g2Folder'], ['g2Folder'], ['otherFolder']]);
  const winter = plan.now.deckFolders.find((f) => f.name === 'Winter Templates');
  assert.ok(winter, 'a folder not in the planner yet becomes a Lesson Templates folder');
  const folderOf = (name) => plan.now.lessons.find((l) => l.locations[0].fileId === [a, b, c].find((f) => f.made.lesson.name === name).made.lesson.fileId).folderId;
  assert.deepEqual([a, b, c].map((f) => folderOf(f.made.lesson.name)), ['fld_g2', 'fld_g2', winter.id]);
  assert.equal(plan.adds, 1, 'still one Undo step');
});

test('“Same as above” follows the folder chosen for all, even when that changes later', async () => {
  const { g, session } = await visit();
  await session.addFiles([unit]);
  const [a] = session.state.files;
  session.setFolder(a.uid, 'fld_g2');
  session.setFolder(a.uid, null);
  session.choose('templateFolder', 'fld_g2');
  assert.equal(session.folderFor(a).id, 'fld_g2');
  await session.makeAll();
  assert.deepEqual(g.get(a.made.lesson.fileId).parents, ['g2Folder']);
});

test('coming back after changing a template in Google draws its picture again', async () => {
  const { session } = await visit();
  await session.addFiles([unit]);
  await session.makeAll();
  await wait(10);
  const [a] = session.state.files;
  assert.match(a.picture, /^data:image/);
  a.picture = 'old picture';
  session.refreshPictures();
  await wait(10);
  assert.match(a.picture, /^data:image/, 'drawn again');
});
