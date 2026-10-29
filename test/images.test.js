// The Images library: pictures and folders come in from Google Drive (folders inside folders too,
// watched for new pictures), carry your own tags, and roll over to a new year with the holiday list.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { add, createYear, emptyState, find, inYear, normalize, remove } from '../public/js/model.js';
import {
  addImage, addTag, decksIn, DRIVE_FOLDER, editImage, folderPath, foldersIn, IMAGE_SHELF, importDriveItems,
  removeFolder, syncWatchedFolders, tagsByGroup,
} from '../public/js/library.js';
import { yearOnly } from '../public/js/workspaceFile.js';

const PNG = 'image/png';
const folder = (id, name, children) => ({ id, name, mimeType: DRIVE_FOLDER, children });
const file = (id, name, mimeType = PNG) => ({ id, name, mimeType });

function setup() {
  const s = emptyState();
  const year = createYear(s, { name: 'Year A', startDate: '2026-08-19', endDate: '2027-06-10' });
  return { s, year };
}

test('a Drive folder of pictures comes in with the folders inside it; other kinds of file are skipped', () => {
  const { s, year } = setup();
  const nodes = [folder('fakeTop', 'Pictures', [
    file('fakeA', 'Waving.png'),
    folder('fakeHol', 'Holidays', [file('fakeB', 'Pumpkin.jpg', 'image/jpeg')]),
    file('fakeDoc', 'Notes', 'application/vnd.google-apps.document'),
  ])];
  const result = importDriveItems(s, { yearId: year.id, nodes, shelf: IMAGE_SHELF });
  assert.deepEqual(result.added.map((i) => i.name).sort(), ['Pumpkin', 'Waving']);
  assert.deepEqual(result.skipped, ['Notes']);
  const [top] = foldersIn(s, year.id, null, IMAGE_SHELF);
  assert.equal(top.watch, true, 'the picked folder is watched');
  const pumpkin = result.added.find((i) => i.name === 'Pumpkin');
  assert.deepEqual(folderPath(s, pumpkin.folderId, IMAGE_SHELF).map((f) => f.name), ['Pictures', 'Holidays']);
  assert.equal(s.lessons.length + s.deckFolders.length, 0, 'pictures don’t end up among the lesson templates');
});

test('bringing the same pictures in again doesn’t add them twice', () => {
  const { s, year } = setup();
  const nodes = [folder('fakeTop', 'Pictures', [file('fakeA', 'Waving.png')])];
  importDriveItems(s, { yearId: year.id, nodes, shelf: IMAGE_SHELF });
  const again = importDriveItems(s, { yearId: year.id, nodes, shelf: IMAGE_SHELF });
  assert.equal(again.added.length, 0);
  assert.equal(s.images.length, 1);
});

test('new pictures in a watched Drive folder are pulled in and marked new; a removed one isn’t pulled back', () => {
  const { s, year } = setup();
  importDriveItems(s, { yearId: year.id, nodes: [folder('fakeTop', 'Pictures', [file('fakeA', 'Waving.png')])], shelf: IMAGE_SHELF });
  const [top] = foldersIn(s, year.id, null, IMAGE_SHELF);
  const trees = { [top.id]: [file('fakeA', 'Waving.png'), file('fakeC', 'Snow.png')] };
  const added = syncWatchedFolders(s, year.id, trees, undefined, IMAGE_SHELF);
  assert.deepEqual(added.map((i) => [i.name, i.isNew]), [['Snow', true]]);
  remove(s, 'images', added[0].id);
  assert.equal(syncWatchedFolders(s, year.id, trees, undefined, IMAGE_SHELF).length, 0);
});

test('removing a picture folder removes its pictures from the planner only', () => {
  const { s, year } = setup();
  importDriveItems(s, { yearId: year.id, nodes: [folder('fakeTop', 'Pictures', [file('fakeA', 'Waving.png')])], shelf: IMAGE_SHELF });
  const [top] = foldersIn(s, year.id, null, IMAGE_SHELF);
  assert.equal(removeFolder(s, top.id, IMAGE_SHELF).decks, 1);
  assert.equal(s.images.length, 0);
});

test('tags are your own: kinds of tag hold tags, and a picture can have several', () => {
  const { s, year } = setup();
  const image = addImage(s, { yearId: year.id, name: 'Snow' });
  const season = add(s, 'tagGroups', { yearId: year.id, name: 'Season' });
  const theme = add(s, 'tagGroups', { yearId: year.id, name: 'Theme' });
  const winter = addTag(s, { yearId: year.id, groupId: season.id, name: 'winter' });
  assert.equal(addTag(s, { yearId: year.id, groupId: season.id, name: 'Winter' }), winter, 'the same tag isn’t made twice');
  const snow = addTag(s, { yearId: year.id, groupId: theme.id, name: 'snow' });
  editImage(s, image.id, (i) => { i.tagIds.push(winter.id, snow.id); });
  assert.deepEqual(tagsByGroup(s, year.id).map((g) => [g.group.name, g.tags.map((t) => t.name)]), [['Season', ['winter']], ['Theme', ['snow']]]);
  remove(s, 'tags', winter.id);
  assert.deepEqual(find(s, 'images', image.id).tagIds, [snow.id], 'a removed tag leaves every picture');
  remove(s, 'tagGroups', theme.id);
  assert.deepEqual(find(s, 'images', image.id).tagIds, [], 'removing a kind of tag removes its tags');
});

test('changing a new picture’s details marks it as seen', () => {
  const { s, year } = setup();
  const image = addImage(s, { yearId: year.id, name: 'Snow', isNew: true });
  editImage(s, image.id, { description: 'Sledding' });
  assert.equal(find(s, 'images', image.id).isNew, false);
});

test('a new year keeps the pictures, folders and tags, and the holidays a year later', () => {
  const { s, year } = setup();
  const uke = add(s, 'instruments', { yearId: year.id, name: 'Ukulele', color: '#b5654a' });
  importDriveItems(s, { yearId: year.id, nodes: [folder('fakeTop', 'Pictures', [file('fakeA', 'Waving.png')])], shelf: IMAGE_SHELF });
  const group = add(s, 'tagGroups', { yearId: year.id, name: 'Season' });
  const tag = addTag(s, { yearId: year.id, groupId: group.id, name: 'winter' });
  editImage(s, s.images[0].id, (i) => { i.tagIds.push(tag.id); i.instrumentIds.push(uke.id); });
  add(s, 'holidays', { yearId: year.id, name: 'Winter Break', startDate: '2026-12-21', endDate: '2027-01-01' });
  const next = createYear(s, { name: 'Year B', startDate: '2027-08-18', endDate: '2028-06-09' }, year.id);
  const [image] = inYear(s, 'images', next.id);
  const [nextFolder] = foldersIn(s, next.id, null, IMAGE_SHELF);
  assert.equal(decksIn(s, next.id, nextFolder.id, IMAGE_SHELF)[0], image, 'the picture is in its copied folder');
  assert.equal(find(s, 'tags', image.tagIds[0]).name, 'winter');
  assert.equal(find(s, 'tags', image.tagIds[0]).groupId, inYear(s, 'tagGroups', next.id)[0].id);
  assert.equal(find(s, 'instruments', image.instrumentIds[0]).yearId, next.id);
  assert.deepEqual(inYear(s, 'holidays', next.id).map((h) => [h.name, h.startDate, h.endDate]), [['Winter Break', '2027-12-21', '2028-01-01']]);
});

test('a plan file for one year keeps that year’s pictures, tags and holidays', () => {
  const { s, year } = setup();
  addImage(s, { yearId: year.id, name: 'Snow' });
  add(s, 'holidays', { yearId: year.id, name: 'Halloween', startDate: '2026-10-31', endDate: '2026-10-31' });
  const other = createYear(s, { name: 'Year B', startDate: '2027-08-18', endDate: '2028-06-09' });
  addImage(s, { yearId: other.id, name: 'Elsewhere' });
  const one = yearOnly(s, year.id);
  assert.deepEqual(one.images.map((i) => i.name), ['Snow']);
  assert.equal(one.holidays.length, 1);
});

test('older plans without pictures still open, and pictures get sensible empty details', () => {
  const s = normalize({ years: [{ id: 'yr1', name: 'Y', startDate: '2026-08-19', endDate: '2027-06-10' }], images: [{ id: 'img1', yearId: 'yr1', name: 'Old' }] });
  assert.deepEqual(s.holidays, []);
  assert.deepEqual(s.images[0].when, { anytime: false, priority: 2, windows: [] });
  assert.deepEqual(s.images[0].tagIds, []);
});

test('Drive says whether a picture is shared with “anyone with the link”', async () => {
  const { fetchLinkSharing } = await import('../public/js/drive.js');
  const answer = (permissionIds) => async () => new Response(JSON.stringify({ permissionIds }));
  assert.equal(await fetchLinkSharing('fake-token', 'fakeA', { fetchFn: answer(['123', 'anyoneWithLink']) }), true);
  assert.equal(await fetchLinkSharing('fake-token', 'fakeA', { fetchFn: answer(['123']) }), false);
  assert.equal(await fetchLinkSharing('fake-token', 'fakeA', { fetchFn: answer(undefined) }), null);
});
