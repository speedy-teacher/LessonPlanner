// Behavior tests for the lesson deck library: folders, importing from the
// computer and Google Drive, watched Drive folders, week and lesson numbers.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  add, addStep, autoFill, createYear, editLesson, emptyState, find, inYear, normalize, placeCriterion, remove, weekNumber,
} from '../public/js/model.js';
import {
  addDeck, addFolder, decksByFolder, decksIn, DRIVE_FOLDER, folderPath, foldersIn, hasNewInside, importDriveItems,
  importLocalFiles, moveDeck, moveFolder, removeFolder, syncWatchedFolders, watchedFolders,
} from '../public/js/library.js';
import { listFolderTree, projectNumber } from '../public/js/drive.js';
import { addLocation, driveLocation, findLocation } from '../public/js/locations.js';

const SLIDES = 'application/vnd.google-apps.presentation';
const NOW = '2026-10-28T15:00:00.000Z';
const PDF = 'application/pdf';

function library() {
  const s = emptyState();
  const year = createYear(s, { name: 'Year A', startDate: '2026-08-26', endDate: '2027-06-11' });
  return { s, year, yearId: year.id };
}

const names = (list) => list.map((r) => r.name);
const driveFile = (id, name, mimeType = SLIDES) => ({ id, name, mimeType });
const driveFolder = (id, name, children) => ({ id, name, mimeType: DRIVE_FOLDER, children });

// ---------- folders ----------

test('folders nest, open in name order, and decks can be moved into them', () => {
  const { s, yearId } = library();
  const rhythm = addFolder(s, { yearId, name: 'Rhythm' });
  const week = addFolder(s, { yearId, name: 'Week 10', parentId: rhythm.id });
  addFolder(s, { yearId, name: 'Week 2', parentId: rhythm.id });
  const deck = addDeck(s, { yearId, name: 'Ta and ti-ti' });
  moveDeck(s, deck.id, week.id);
  assert.deepEqual(names(foldersIn(s, yearId, rhythm.id)), ['Week 2', 'Week 10']);
  assert.deepEqual(names(decksIn(s, yearId, week.id)), ['Ta and ti-ti']);
  assert.deepEqual(names(folderPath(s, week.id)), ['Rhythm', 'Week 10']);
  assert.deepEqual(decksByFolder(s, yearId).map((g) => g.label), ['Rhythm › Week 10']);
});

test('a folder can move into another folder, but never inside itself', () => {
  const { s, yearId } = library();
  const outer = addFolder(s, { yearId, name: 'Outer' });
  const inner = addFolder(s, { yearId, name: 'Inner', parentId: outer.id });
  assert.equal(moveFolder(s, outer.id, inner.id), null);
  assert.equal(find(s, 'deckFolders', outer.id).parentId, null);
  const other = addFolder(s, { yearId, name: 'Other' });
  moveFolder(s, inner.id, other.id);
  assert.equal(find(s, 'deckFolders', inner.id).parentId, other.id);
});

test('deleting a folder keeps its decks and folders: they move up one level', () => {
  const { s, yearId } = library();
  const top = addFolder(s, { yearId, name: 'Top' });
  const middle = addFolder(s, { yearId, name: 'Middle', parentId: top.id });
  const bottom = addFolder(s, { yearId, name: 'Bottom', parentId: middle.id });
  const deck = addDeck(s, { yearId, name: 'Deck', folderId: middle.id });
  removeFolder(s, middle.id);
  assert.equal(find(s, 'lessons', deck.id).folderId, top.id);
  assert.equal(find(s, 'deckFolders', bottom.id).parentId, top.id);
  assert.equal(find(s, 'deckFolders', middle.id), null);
});

test('folders and the decks in them are copied into a new year', () => {
  const { s, year, yearId } = library();
  const folder = addFolder(s, { yearId, name: 'Rhythm' });
  addFolder(s, { yearId, name: 'Inner', parentId: folder.id });
  addDeck(s, { yearId, name: 'Deck', folderId: folder.id });
  const next = createYear(s, { name: 'Year B', startDate: '2027-08-25', endDate: '2028-06-09' }, year.id);
  const [newTop] = foldersIn(s, next.id, null);
  assert.notEqual(newTop.id, folder.id);
  assert.deepEqual(names(foldersIn(s, next.id, newTop.id)), ['Inner']);
  assert.deepEqual(names(decksIn(s, next.id, newTop.id)), ['Deck']);
});

test('saved data from before folders still loads: decks sit at the top level', () => {
  const { s, yearId } = library();
  const old = { ...structuredClone(s), schemaVersion: 3, lessons: [{ id: 'les_old', yearId, name: 'Old deck', category: '', autoFields: [], instrumentIds: [] }] };
  delete old.deckFolders;
  const loaded = normalize(old);
  assert.deepEqual(loaded.deckFolders, []);
  assert.deepEqual([loaded.lessons[0].folderId, loaded.lessons[0].locations, loaded.lessons[0].isNew], [null, [], false]);
});

test('deleting a year deletes its folders', () => {
  const { s, year, yearId } = library();
  addFolder(s, { yearId, name: 'Rhythm' });
  remove(s, 'years', year.id);
  assert.equal(s.deckFolders.length, 0);
});

// ---------- from the computer ----------

test('picking slide files from the computer adds one deck each, named without the file ending', () => {
  const { s, yearId } = library();
  const target = addFolder(s, { yearId, name: 'Target' });
  const result = importLocalFiles(s, { yearId, parentId: target.id, seenAt: NOW, files: [{ path: 'Beat Hunt.pptx', size: 10 }, { path: 'Song.pdf' }, { path: 'notes.docx' }] });
  assert.deepEqual(names(result.added), ['Beat Hunt', 'Song']);
  assert.deepEqual(result.skipped, ['notes.docx']);
  assert.deepEqual(names(decksIn(s, yearId, target.id)), ['Beat Hunt', 'Song']);
  assert.deepEqual(result.added[0].locations, [{
    kind: 'local', uri: 'local:/Beat%20Hunt.pptx', rootId: null, path: 'Beat Hunt.pptx', size: 10, modifiedTime: null, lastSeenAt: NOW,
  }], 'a file picked on its own has no computer folder');
  assert.deepEqual(result.added[0].autoFields, ['school', 'grade', 'date']);
});

test('picking a folder from the computer makes matching folders, including folders inside folders', () => {
  const { s, yearId } = library();
  const files = [
    { path: 'Rhythm/Intro.pptx' },
    { path: 'Rhythm/Week 1/Ta.pptx' },
    { path: 'Rhythm/Week 1/Deeper/Ti-ti.key' },
    { path: 'Rhythm/Week 1/photo.jpg' },
  ];
  const result = importLocalFiles(s, { yearId, files });
  assert.equal(result.added.length, 3);
  assert.deepEqual(names(result.folders), ['Rhythm', 'Week 1', 'Deeper']);
  const [rhythm] = foldersIn(s, yearId, null);
  const [week] = foldersIn(s, yearId, rhythm.id);
  assert.deepEqual(names(decksIn(s, yearId, rhythm.id)), ['Intro']);
  assert.deepEqual(names(decksIn(s, yearId, week.id)), ['Ta']);
  assert.deepEqual(names(decksIn(s, yearId, foldersIn(s, yearId, week.id)[0].id)), ['Ti-ti']);
});

test('picking the same computer folder again adds only the new decks', () => {
  const { s, yearId } = library();
  importLocalFiles(s, { yearId, files: [{ path: 'Rhythm/Ta.pptx' }] });
  const again = importLocalFiles(s, { yearId, files: [{ path: 'Rhythm/Ta.pptx' }, { path: 'Rhythm/Ti.pptx' }] });
  assert.deepEqual(names(again.added), ['Ti']);
  assert.equal(again.folders.length, 0);
  assert.equal(s.deckFolders.length, 1);
});

// ---------- from Google Drive ----------

test('picking Drive decks adds them; picking a Drive folder adds a watched folder with everything inside', () => {
  const { s, yearId } = library();
  const nodes = [
    driveFile('d1', 'Loose deck'),
    driveFolder('f1', 'Unit 1', [driveFile('d2', 'Lesson A.pptx', 'application/vnd.openxmlformats-officedocument.presentationml.presentation'),
      driveFolder('f2', 'Extras', [driveFile('d3', 'Lesson B', PDF), driveFile('d4', 'Sheet', 'application/vnd.google-apps.spreadsheet')])]),
  ];
  const result = importDriveItems(s, { yearId, nodes });
  assert.deepEqual(names(result.added), ['Loose deck', 'Lesson A', 'Lesson B']);
  assert.deepEqual(result.skipped, ['Sheet']);
  assert.ok(result.added.every((l) => !l.isNew), 'decks you pick yourself are not marked new');
  const [unit] = foldersIn(s, yearId, null);
  assert.equal(unit.name, 'Unit 1');
  assert.deepEqual(watchedFolders(s, yearId).map((f) => f.name), ['Unit 1'], 'only the picked folder is watched');
  assert.deepEqual(result.added[0].locations.map((l) => l.uri), ['https://drive.google.com/open?id=d1']);
  assert.equal(unit.locations[0].uri, 'https://drive.google.com/open?id=f1');
  assert.equal(importDriveItems(s, { yearId, nodes }).added.length, 0, 'picking again adds nothing twice');
});

function watchedUnit() {
  const ctx = library();
  const tree = [driveFile('d1', 'Old deck'), driveFolder('f2', 'Week 1', [driveFile('d2', 'Older deck')])];
  importDriveItems(ctx.s, { yearId: ctx.yearId, nodes: [driveFolder('f1', 'Unit 1', tree)] });
  const [unit] = watchedFolders(ctx.s, ctx.yearId);
  return { ...ctx, unit, tree };
}

test('new decks added to a watched Drive folder are pulled in and marked new — the mark shows on every folder above', () => {
  const { s, yearId, unit, tree } = watchedUnit();
  const week = foldersIn(s, yearId, unit.id)[0];
  const later = [...tree.slice(0, 1), driveFolder('f2', 'Week 1', [driveFile('d2', 'Older deck'), driveFile('d5', 'Brand new')])];
  const added = syncWatchedFolders(s, yearId, { [unit.id]: later });
  assert.deepEqual(names(added), ['Brand new']);
  assert.ok(added[0].isNew);
  assert.equal(added[0].folderId, week.id);
  assert.ok(hasNewInside(s, week.id));
  assert.ok(hasNewInside(s, unit.id), 'the mark leads up the folder tree');
  assert.equal(syncWatchedFolders(s, yearId, { [unit.id]: later }).length, 0, 'checking again adds nothing');
});

test('a new deck stops being new as soon as any of its details is changed', () => {
  const { s, yearId, unit } = watchedUnit();
  const [deck] = syncWatchedFolders(s, yearId, { [unit.id]: [driveFile('d9', 'Fresh')] });
  editLesson(s, deck.id, { category: 'Openers' });
  assert.equal(find(s, 'lessons', deck.id).isNew, false);
  assert.ok(!hasNewInside(s, unit.id));
});

test('new folders in a watched Drive folder are added too', () => {
  const { s, yearId, unit } = watchedUnit();
  const added = syncWatchedFolders(s, yearId, { [unit.id]: [driveFolder('f7', 'Week 2', [driveFile('d7', 'Second week')])] });
  assert.deepEqual(names(added), ['Second week']);
  assert.deepEqual(names(folderPath(s, added[0].folderId)), ['Unit 1', 'Week 2']);
});

test('a deck you delete is not pulled in again from its watched folder', () => {
  const { s, yearId, unit, tree } = watchedUnit();
  const old = inYear(s, 'lessons', yearId).find((l) => l.name === 'Old deck');
  remove(s, 'lessons', old.id);
  assert.equal(syncWatchedFolders(s, yearId, { [unit.id]: tree }).length, 0);
});

test('a folder that is no longer watched is not checked', () => {
  const { s, yearId, unit } = watchedUnit();
  unit.watch = false;
  assert.equal(syncWatchedFolders(s, yearId, { [unit.id]: [driveFile('d9', 'Fresh')] }).length, 0);
});

test('reading a Drive folder follows folders inside folders and every page of results', async () => {
  const drive = {
    root: [[driveFile('a', 'Deck A'), { id: 'x', name: 'Doc', mimeType: 'application/vnd.google-apps.document' }], [driveFolder('sub', 'Sub')]],
    sub: [[driveFile('b', 'Deck B', PDF)]],
  };
  const calls = [];
  const fetchFn = async (url, { headers }) => {
    const params = new URL(url).searchParams;
    calls.push(headers.Authorization);
    const folderId = /'(.+)' in parents/.exec(params.get('q'))[1];
    const page = Number(params.get('pageToken') || 0);
    const pages = drive[folderId];
    return { ok: true, status: 200, json: async () => ({ files: pages[page].map(({ children: _c, ...f }) => f), nextPageToken: page + 1 < pages.length ? String(page + 1) : undefined }) };
  };
  const tree = await listFolderTree('fake-token', 'root', { fetchFn });
  assert.deepEqual(tree.map((n) => n.name), ['Deck A', 'Sub'], 'non-deck files are left out');
  assert.deepEqual(tree[1].children.map((n) => n.name), ['Deck B']);
  assert.ok(calls.every((c) => c === 'Bearer fake-token'));
});

test('the Google picker is told the project number from the start of the Client ID', () => {
  assert.equal(projectNumber('123456-abcdef.apps.googleusercontent.com'), '123456');
});

// ---------- week and lesson numbers ----------

function classYear() {
  const { s, year, yearId } = library(); // starts Wednesday 2026-08-26
  const school = add(s, 'schools', { yearId, name: 'Test School' });
  const grade = add(s, 'grades', { yearId, name: 'Grade 2', short: '2' });
  const outcome = add(s, 'outcomes', { yearId, code: 'MU1', title: 'Beat' });
  const deck = (name) => addDeck(s, { yearId, name, isNew: false });
  const critA = add(s, 'criteria', { outcomeId: outcome.id, title: 'A', gradeIds: [grade.id] });
  const critB = add(s, 'criteria', { outcomeId: outcome.id, title: 'B', gradeIds: [grade.id] });
  [deck('A1'), deck('A2')].forEach((l) => addStep(s, critA.id, l.id));
  const b1 = addStep(s, critB.id, deck('B1').id);
  find(s, 'lessons', b1.lessonId).autoFields = ['week', 'lessonNumber'];
  const place = (crit, startDate, endDate = startDate) => placeCriterion(s, { yearId, schoolId: school.id, gradeId: grade.id, criterionId: crit.id, startDate, endDate });
  return { s, year, critA, critB, b1, place };
}

test('week number counts school weeks from the start of the year (week 1 = the first week)', () => {
  assert.equal(weekNumber('2026-08-26', '2026-08-26'), 1);
  assert.equal(weekNumber('2026-08-26', '2026-08-28'), 1);
  assert.equal(weekNumber('2026-08-26', '2026-08-31'), 2);
  assert.equal(weekNumber('2026-08-26', '2026-10-26'), 10);
});

test('decks fill in the week number and the class’s running lesson number', () => {
  const { s, critA, critB, b1, place } = classYear();
  place(critA, '2026-09-08');
  const p = place(critB, '2026-09-21', '2026-09-29');
  const values = Object.fromEntries(autoFill(s, b1, p).map((f) => [f.key, f.value]));
  assert.deepEqual(values, { week: '5–6', lessonNumber: '3' }, 'after the two lessons of the earlier eval');
});

test('lesson numbers follow the calendar order, not the order evals were placed in', () => {
  const { s, critA, critB, b1, place } = classYear();
  const p = place(critB, '2026-09-01');
  place(critA, '2026-09-21');
  assert.equal(autoFill(s, b1, p).find((f) => f.key === 'lessonNumber').value, '1');
});

// ---------- where files live (workspace-ready) ----------

test('a picked computer folder is remembered once, and its decks point at it with their path inside it', () => {
  const { s, yearId } = library();
  importLocalFiles(s, { yearId, files: [{ path: 'Rhythm/Week 1/Ta.pptx' }] });
  importLocalFiles(s, { yearId, files: [{ path: 'Rhythm/Ti.pptx' }] });
  assert.deepEqual(s.localRoots.map((r) => r.name), ['Rhythm']);
  const rootId = s.localRoots[0].id;
  const ta = inYear(s, 'lessons', yearId).find((l) => l.name === 'Ta');
  assert.deepEqual([findLocation(ta, 'local').rootId, findLocation(ta, 'local').path], [rootId, 'Week 1/Ta.pptx']);
  assert.equal(findLocation(ta, 'local').uri, `local:${rootId}/Week%201/Ta.pptx`);
  const [rhythm] = foldersIn(s, yearId, null);
  assert.deepEqual([findLocation(rhythm, 'local').rootId, findLocation(rhythm, 'local').path], [rootId, '']);
});

test('a deck can live in several places, and adding the same place again just refreshes it', () => {
  const { s, yearId } = library();
  const [deck] = importDriveItems(s, { yearId, nodes: [driveFile('d1', 'Beat')] }).added;
  importLocalFiles(s, { yearId, files: [{ path: 'Beat.pptx' }] }); // a different file, so a second deck
  addLocation(deck, driveLocation({ fileId: 'd1', mimeType: SLIDES, modifiedTime: '2026-10-01' }));
  assert.equal(deck.locations.length, 1);
  assert.equal(deck.locations[0].modifiedTime, '2026-10-01');
});

test('decks that disappear from a watched Drive folder stay in the library, and decks still there are marked seen', () => {
  const { s, yearId, unit } = watchedUnit();
  const nextDay = '2099-01-02T08:00:00.000Z';
  syncWatchedFolders(s, yearId, { [unit.id]: [driveFile('d1', 'Old deck')] }, nextDay);
  assert.deepEqual(names(inYear(s, 'lessons', yearId)).sort(), ['Old deck', 'Older deck']);
  const old = inYear(s, 'lessons', yearId).find((l) => l.name === 'Old deck');
  assert.equal(findLocation(old, 'drive').lastSeenAt, nextDay);
});

test('saved data with one file per deck is upgraded to a list of places, keeping computer folders', () => {
  const { s, yearId } = library();
  const v4 = {
    ...structuredClone(s), schemaVersion: 4,
    deckFolders: [
      { id: 'fld_r', yearId, name: 'Rhythm', parentId: null, source: { kind: 'local' }, watch: false },
      { id: 'fld_w', yearId, name: 'Week 1', parentId: 'fld_r', source: { kind: 'local' }, watch: false },
      { id: 'fld_d', yearId, name: 'Drive Unit', parentId: null, source: { kind: 'drive', fileId: 'f1', seenIds: ['d1'] }, watch: true },
    ],
    lessons: [
      { id: 'les_l', yearId, name: 'Ta', category: '', autoFields: [], instrumentIds: [], folderId: 'fld_w', source: { kind: 'local', path: 'Rhythm/Week 1/Ta.pptx', size: 5, modifiedTime: null }, isNew: false },
      { id: 'les_d', yearId, name: 'Beat', category: '', autoFields: [], instrumentIds: [], folderId: 'fld_d', source: { kind: 'drive', fileId: 'd1', mimeType: SLIDES, url: 'x', modifiedTime: null }, isNew: true },
    ],
  };
  delete v4.localRoots;
  const up = normalize(v4);
  const rootId = up.localRoots[0].id;
  assert.deepEqual(up.localRoots.map((r) => r.name), ['Rhythm']);
  const byId = (c, id) => up[c].find((r) => r.id === id);
  assert.deepEqual([findLocation(byId('lessons', 'les_l'), 'local').rootId, findLocation(byId('lessons', 'les_l'), 'local').path], [rootId, 'Week 1/Ta.pptx']);
  assert.equal(findLocation(byId('deckFolders', 'fld_w'), 'local').path, 'Week 1');
  assert.equal(findLocation(byId('deckFolders', 'fld_r'), 'local').path, '');
  assert.equal(findLocation(byId('lessons', 'les_d'), 'drive').uri, 'https://drive.google.com/open?id=d1');
  assert.deepEqual(byId('deckFolders', 'fld_d').seenDriveIds, ['d1']);
  assert.ok([...up.lessons, ...up.deckFolders].every((r) => !('source' in r)));
  assert.ok(byId('lessons', 'les_d').isNew);
});
