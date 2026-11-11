// The Template Maker window, start to finish, against a pretend Google Drive: check the folders, add files,
// untick, make — the templates and pictures land in the open plan (❗ new), in one Undo step.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSession } from '../public/js/templateMaker/session.js';
import { addTemplates } from '../public/js/templateMaker/addToPlan.js';
import { copyPace } from '../public/js/copyPace.js';
import { plannerState, teacherDrive } from './e2e/templateMaker/samples.js';

function memoryStorage() {
  const m = new Map();
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, v), removeItem: (k) => m.delete(k), m };
}

/** The open plan: `adds` counts the changes (each one = one Undo step in the planner). */
function openPlan(state = plannerState()) {
  const plan = { now: state, adds: 0 };
  plan.api = {
    state: () => plan.now,
    yearId: () => 'yr_1',
    add: (made) => { plan.adds += 1; return addTemplates(plan.now, made, { yearId: 'yr_1', now: '2026-11-07T10:00:00Z' }); },
  };
  return plan;
}

async function visit(opts) {
  const drive = teacherDrive(opts);
  const storage = memoryStorage();
  const plan = openPlan(plannerState(opts));
  const session = createSession({ calls: drive.calls, pace: copyPace(), storage, plan: plan.api });
  await session.checkSetup();
  return { ...drive, storage, session, plan };
}

test('pick several files, untick one number, make them all: the templates are in Lesson Templates, marked new', async () => {
  const { g, session, files, plan } = await visit();
  assert.equal(session.state.setup.status, 'ready');
  await session.addFiles([files.slides, files.office, files.spreadsheet]);
  assert.deepEqual(session.state.files.map((f) => f.status), ['ready', 'ready', 'ready']);
  const sheet = session.state.files[2];
  session.tickMatch(sheet.uid, sheet.prepared.scan.matches[0].key, false);
  session.rename(sheet.uid, 'Checklist');
  await session.makeAll();
  assert.equal(session.state.phase, 'review', 'the teacher looks before anything is added');
  assert.equal(plan.adds, 0);
  await session.addKept();
  assert.equal(session.state.phase, 'done');
  assert.equal(session.state.save.status, 'saved');
  assert.equal(session.state.save.count, 3);
  assert.equal(plan.adds, 1, 'one change, so one Undo takes them all back out');
  assert.deepEqual(plan.now.lessons.map((l) => l.name), ['Old Song', 'Rhythm Tree', 'Beat Buddies', 'Checklist']);
  const rhythm = plan.now.lessons.find((l) => l.name === 'Rhythm Tree');
  assert.equal(session.state.save.firstLessonId, rhythm.id, '“Show me” opens the first one');
  assert.equal(rhythm.isNew, true);
  assert.equal(rhythm.yearId, 'yr_1');
  assert.equal(rhythm.folderId, 'fld_top');
  assert.deepEqual(rhythm.autoFields, ['school', 'grade', 'date', 'lessonNumber', 'week', 'image']);
  assert.ok(plan.now.deckFolders[0].seenDriveIds.includes(rhythm.locations[0].fileId), 'the watched folder won’t bring it in again');
  assert.equal(plan.now.images.length, 1, 'the same picture in two files is saved once');
  assert.equal(plan.now.images[0].folderId, 'ifld_pics');
  assert.equal(g.get(sheet.made.lesson.fileId).content.sheets[0].data[0].rowData[0].values[0].userEnteredValue.stringValue, 'Week 4', 'unticked stays');
});

test('looking first: an unticked template is thrown away (with its picture), only the kept one is added', async () => {
  const { g, session, files, plan } = await visit();
  await session.addFiles([files.slides, files.spreadsheet]);
  await session.makeAll();
  const [deck, sheet] = session.state.files;
  await new Promise((r) => { setTimeout(r, 10); });
  assert.match(deck.picture, /^data:image/, 'a picture of the first slide to look at');
  session.setKeep(deck.uid, false);
  await session.addKept();
  assert.deepEqual(plan.now.lessons.map((l) => l.name), ['Old Song', sheet.made.lesson.name]);
  assert.equal(g.get(deck.made.lesson.fileId).trashed, true);
  assert.equal(g.get(deck.made.images[0].fileId).trashed, true, 'its picture was only for it');
  assert.equal(plan.now.images.length, 0);
  assert.equal(g.get(sheet.made.lesson.fileId).properties.lessonPlanner, undefined, 'the kept one is a normal file now');
});

test('while looking, the templates folder can still be changed: the templates are moved there when added', async () => {
  const { g, session, files, plan } = await visit();
  await session.addFiles([files.slides, files.office]);
  assert.equal(session.canChoose('templateFolder'), true, 'after files are read');
  assert.equal(session.canChoose('imageFolder'), false, 'pictures folder: only before files are read');
  await session.makeAll();
  assert.equal(session.state.phase, 'review');
  session.choose('templateFolder', 'fld_g2');
  await session.addKept();
  for (const f of session.state.files) assert.deepEqual(g.get(f.made.lesson.fileId).parents, ['g2Folder']);
  assert.ok(plan.now.lessons.filter((l) => l.isNew).every((l) => l.folderId === 'fld_g2'));
});

test('a folder changed after an Office file was read: its template is still made in the new folder', async () => {
  const { g, session, files } = await visit();
  await session.addFiles([files.office]);
  session.choose('templateFolder', 'fld_g2');
  await session.makeAll();
  assert.deepEqual(g.get(session.state.files[0].made.lesson.fileId).parents, ['g2Folder']);
});

test('“Another folder in Drive…”: a folder not in the planner yet becomes a Lesson Templates folder when added', async () => {
  const { g, session, files, plan } = await visit();
  g.add({ id: 'newFolder', name: 'Fall Templates', mimeType: 'application/vnd.google-apps.folder' });
  await session.addFiles([files.slides]);
  await session.makeAll();
  session.pickFolder({ id: 'newFolder', name: 'Fall Templates' });
  assert.equal(session.state.setup.chosen.templateFolder.driveId, 'newFolder');
  await session.addKept();
  assert.deepEqual(g.get(session.state.files[0].made.lesson.fileId).parents, ['newFolder']);
  const folder = plan.now.deckFolders.find((f) => f.name === 'Fall Templates');
  assert.ok(folder, 'a Lesson Templates folder for it');
  assert.equal(folder.yearId, 'yr_1');
  assert.equal(plan.now.lessons.find((l) => l.name === 'Rhythm Tree').folderId, folder.id);
  session.startOver();
  session.pickFolder({ id: 'tplFolder', name: 'Lessons' });
  assert.equal(session.state.setup.chosen.templateFolder.id, 'fld_top', 'a folder already in the planner is used as it is');
});

test('“Throw them all away” while looking leaves nothing behind', async () => {
  const { g, session, files, plan } = await visit();
  await session.addFiles([files.slides]);
  await session.makeAll();
  const { made } = session.state.files[0];
  session.startOver();
  await new Promise((r) => { setTimeout(r, 20); });
  assert.equal(g.get(made.lesson.fileId).trashed, true);
  assert.equal(plan.adds, 0);
  assert.equal(session.state.phase, 'choose');
});

test('a template already in the plan is updated, never doubled', () => {
  const state = plannerState();
  const lesson = { fileId: 'oldFile', mimeType: 'application/vnd.google-apps.presentation', name: 'Old Song again', folderId: 'fld_top', fields: ['week'] };
  addTemplates(state, { lessons: [lesson] }, { yearId: 'yr_1' });
  addTemplates(state, { lessons: [lesson] }, { yearId: 'yr_1' });
  assert.equal(state.lessons.length, 1);
  assert.equal(state.lessons[0].name, 'Old Song again');
  assert.deepEqual(state.lessons[0].autoFields, ['school', 'week']);
});

test('the same file picked twice is listed once; a file taken out leaves no draft', async () => {
  const { g, session, files } = await visit();
  await session.addFiles([files.office]);
  await session.addFiles([files.office]);
  assert.equal(session.state.files.length, 1);
  const { draft } = session.state.files[0].prepared;
  await session.removeFile(session.state.files[0].uid);
  assert.equal(g.get(draft.id).trashed, true);
  assert.equal(session.state.files.length, 0);
});

test('a file that can’t be read shows a problem; the others are still made', async () => {
  const { g, session, files } = await visit();
  g.failNext('/documents/doc1', { status: 403, reason: 'forbidden' });
  await session.addFiles([files.doc, files.slides]);
  assert.deepEqual(session.state.files.map((f) => f.status), ['problem', 'ready']);
  assert.match(session.state.files[0].error, /can’t change|Editor/);
  await session.makeAll();
  await session.addKept();
  assert.equal(session.state.save.count, 1);
});

test('if the plan can’t take them, the teacher is told they will come in from the folder', async () => {
  const drive = teacherDrive();
  const plan = openPlan();
  plan.api.add = () => { throw new Error('view only'); };
  const session = createSession({ calls: drive.calls, pace: copyPace(), storage: memoryStorage(), plan: plan.api });
  await session.checkSetup();
  await session.addFiles([drive.files.slides]);
  await session.makeAll();
  await session.addKept();
  assert.equal(session.state.save.status, 'failed');
  assert.match(session.state.save.message, /show up by themselves/);
});

test('the teacher’s folder picks are remembered for next time', async () => {
  const { session, storage, calls } = await visit();
  session.choose('templateFolder', 'fld_g2');
  session.choose('imageFolder', 'none');
  assert.equal(session.state.setup.chosen.templateFolder.path, 'Lessons › Grade 2');
  const next = createSession({ calls, pace: copyPace(), storage, plan: openPlan().api });
  await next.checkSetup();
  assert.equal(next.state.setup.chosen.templateFolder.path, 'Lessons › Grade 2');
  assert.equal(next.state.setup.chosen.imageFolder, null);
});

test('“Make more” starts again; files read but not made leave no drafts', async () => {
  const { g, session, files } = await visit();
  await session.addFiles([files.office]);
  const { draft } = session.state.files[0].prepared;
  session.startOver();
  await new Promise((r) => { setTimeout(r, 20); });
  assert.equal(session.state.files.length, 0);
  assert.equal(g.get(draft.id).trashed, true);
});

test('old drafts from a closed tab are tidied away when the window opens', async () => {
  const drive = teacherDrive();
  const old = drive.g.add({ name: 'x', mimeType: 'application/vnd.google-apps.presentation', appProperties: { templateMaker: 'draft' }, modifiedTime: '2026-01-01T00:00:00Z' });
  const session = createSession({ calls: drive.calls, pace: copyPace(), storage: memoryStorage(), plan: openPlan().api });
  await session.checkSetup();
  await new Promise((r) => { setTimeout(r, 20); });
  assert.equal(drive.g.get(old.id).trashed, true);
});
