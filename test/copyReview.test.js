// "+ Add" → "Files or folders…" on Lesson Templates: the teacher looks at every copy before it's added.
// Each picked file — and each lesson inside a picked folder — gets a picture, a link to open it, a name she can
// change and "Add this one". Only kept copies are added; the copies made for the look that she doesn't keep go to
// the trash. Until she decides, watched folders don't bring the copies in.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { copyPicked, keepCopies, reviewList, staleReviews, watchingFolder } from '../public/js/templateCopies.js';
import { createCopyReview, openLink } from '../public/js/copyReview.js';
import { importDriveItems, isDriveLessonFile, syncWatchedFolders } from '../public/js/library.js';
import { listFolderTree } from '../public/js/drive.js';
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
  g.add({ id: 'herDoc', name: 'Song sheet', mimeType: KINDS.docs.google, ownedByMe: false, parents: ['hers'], content: deck([{ texts: ['La la'] }]) });
  return drive;
}

const pick = (g, id) => ({ id, name: g.get(id).name, mimeType: g.get(id).mimeType });
const copyForLook = (drive, ids) => copyPicked(drive.calls, ids.map((id) => pick(drive.g, id)), { folderDriveId: 'tplFolder', wanted: isDriveLessonFile, review: true });

/** A look at the copies, adding the kept ones to a planner state like the page does. */
function look(drive, nodes) {
  const state = plannerState();
  const add = (kept) => importDriveItems(state, { yearId: 'yr_1', parentId: 'fld_top', nodes: kept, seenBy: watchingFolder(state, 'fld_top') });
  return { state, review: createCopyReview({ calls: drive.calls, nodes, add, pictureRetries: [] }) };
}

/** What a watched templates folder would bring in right now (the planner re-lists it every 10 minutes). */
async function watchedNow(drive, state) {
  const tree = await listFolderTree('pass', 'tplFolder', { fetchFn: drive.g.fetch });
  return syncWatchedFolders(state, 'yr_1', { fld_top: tree });
}

test('every picked file, and every lesson inside a picked folder, is there to look at — several at once', async () => {
  const drive = colleagueDrive();
  const { nodes } = await copyForLook(drive, ['herFolder', 'herDoc']);
  const files = reviewList(nodes);
  assert.deepEqual(files.map((f) => [f.name, f.path]).sort(), [['Beat Lesson 1', 'Fall Unit'], ['Rest Lesson', 'Fall Unit › Week 3'], ['Song sheet', '']]);
  assert.ok(files.every((f) => f.review), 'all made for this look');
  assert.ok(files.every((f) => !['herDeck', 'herDeck2', 'herDoc'].includes(f.id)), 'copies, never her files');

  const { review } = look(drive, nodes);
  await review.loadPictures();
  assert.equal(review.state.files.length, 3);
  for (const f of review.state.files) {
    assert.equal(f.pictureState, 'ready', `${f.name} has a picture`);
    assert.ok(f.picture.startsWith('data:image'), 'Drive’s picture of the copy');
    assert.equal(f.keep, true, 'ticked to start with');
    assert.equal(openLink(f.id), `https://drive.google.com/open?id=${f.id}`);
  }
});

test('nothing is added while she is looking — not even by the watched templates folder', async () => {
  const drive = colleagueDrive();
  const { nodes } = await copyForLook(drive, ['herFolder', 'herDoc']);
  const { state } = look(drive, nodes);
  const before = state.lessons.length;
  const folders = state.deckFolders.length;
  assert.deepEqual(await watchedNow(drive, state), []);
  assert.equal(state.lessons.length, before);
  assert.equal(state.deckFolders.length, folders, 'the copied folder isn’t brought in either');
});

test('only the ticked copies are added, with the names she typed; the rest go to the trash', async () => {
  const drive = colleagueDrive();
  const { nodes } = await copyForLook(drive, ['herFolder', 'herDoc']);
  const { state, review } = look(drive, nodes);
  const byName = (name) => review.state.files.find((f) => f.name === name);
  const rest = byName('Rest Lesson');
  const song = byName('Song sheet');
  const beat = byName('Beat Lesson 1');
  review.setKeep(song.id, false);
  review.rename(rest.id, 'Rests – quarter rest');
  const result = await review.addKept();

  assert.deepEqual(result.added.map((l) => l.name).sort(), ['Beat Lesson 1', 'Rests – quarter rest']);
  assert.deepEqual(result.added.map(driveIdOf).sort(), [beat.id, rest.id].sort());
  assert.equal(drive.g.get(rest.id).name, 'Rests – quarter rest', 'renamed in Drive too');
  assert.equal(drive.g.get(song.id).trashed, true, 'unticked copy thrown away');
  assert.equal(drive.g.get('herDoc').trashed, false, 'her file is untouched');
  for (const f of [rest, beat]) assert.equal(drive.g.get(f.id).properties.lessonPlanner, undefined, 'kept: no longer waiting');
  const top = nodes.find((n) => n.children);
  assert.equal(drive.g.get(top.id).properties.lessonPlanner, undefined, 'its folder is kept too');
  assert.equal(review.state.phase, 'done');
  assert.deepEqual(await watchedNow(drive, state), [], 'the watched folder doesn’t add them a second time');
});

test('a copied folder with nothing kept inside goes to the trash; “Throw them all away” adds nothing', async () => {
  const drive = colleagueDrive();
  const { nodes } = await copyForLook(drive, ['herFolder']);
  const { state, review } = look(drive, nodes);
  const lessons = state.lessons.length;
  const result = await review.throwAll();
  assert.deepEqual(result.added, []);
  assert.equal(state.lessons.length, lessons);
  const ids = reviewList(nodes).map((f) => f.id);
  assert.ok(ids.every((id) => drive.g.get(id).trashed));
  assert.equal(drive.g.get(nodes[0].id).trashed, true, 'the copied Fall Unit folder too');
});

test('unticking one copy in a folder keeps the folder for the others', async () => {
  const drive = colleagueDrive();
  const { nodes } = await copyForLook(drive, ['herFolder']);
  const { review } = look(drive, nodes);
  const rest = review.state.files.find((f) => f.name === 'Rest Lesson');
  review.setKeep(rest.id, false);
  const result = await review.addKept();
  assert.deepEqual(result.added.map((l) => l.name), ['Beat Lesson 1']);
  assert.equal(drive.g.get(nodes[0].id).trashed, false);
  const week = nodes[0].children.find((c) => c.name === 'Week 3');
  assert.equal(drive.g.get(week.id).trashed, true, 'Week 3 had nothing kept');
});

test('a file already in the templates folder is shown too, and is never trashed when unticked', async () => {
  const drive = colleagueDrive();
  drive.g.add({ id: 'mineAlready', name: 'My warm-up', mimeType: KINDS.slides.google, parents: ['tplFolder'], content: deck([{ texts: ['Hi'] }]) });
  const { nodes } = await copyForLook(drive, ['mineAlready']);
  assert.deepEqual(reviewList(nodes).map((f) => [f.id, f.review]), [['mineAlready', false]]);
  const kept = await keepCopies(drive.calls, nodes, { keep: new Set() });
  assert.deepEqual(kept.nodes, []);
  assert.equal(drive.g.get('mineAlready').trashed, false);
});

test('a picture Drive hasn’t made yet is asked for again', async () => {
  const drive = colleagueDrive();
  const { nodes } = await copyForLook(drive, ['herDoc']);
  const [file] = reviewList(nodes);
  drive.g.get(file.id).noThumbnail = true;
  const review = createCopyReview({ calls: drive.calls, nodes, add: () => ({ added: [], folders: [], skipped: [] }), pictureRetries: [5] });
  await review.loadPictures();
  assert.equal(review.state.files[0].pictureState, 'loading');
  delete drive.g.get(file.id).noThumbnail;
  await new Promise((r) => { setTimeout(r, 30); });
  assert.equal(review.state.files[0].pictureState, 'ready');
});

test('copies nobody finished looking at are tidied away after a day', () => {
  const now = Date.parse('2026-11-16T12:00:00Z');
  const files = [
    { id: 'old', properties: { lessonPlanner: 'copy-review' }, modifiedTime: '2026-11-14T12:00:00Z' },
    { id: 'today', properties: { lessonPlanner: 'copy-review' }, modifiedTime: '2026-11-16T09:00:00Z' },
    { id: 'kept', properties: {}, modifiedTime: '2026-11-01T09:00:00Z' },
  ];
  assert.deepEqual(staleReviews(files, now).map((f) => f.id), ['old']);
});
