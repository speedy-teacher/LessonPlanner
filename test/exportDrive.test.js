// Lesson copies in Google Drive and in a folder on the computer: copies are made from the template
// (never changing it), details are filled in through Google's Slides/Docs/Sheets services,
// copies move to their week folder, and removed lessons' copies go to the trash.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { downloadTemplate, driveCopies, COPY_LABEL } from '../public/js/exportDrive.js';
import { copyHash } from '../public/js/exportPlan.js';
import { localCopies, LIST_FILE } from '../public/js/exportLocal.js';

const SLIDES = 'application/vnd.google-apps.presentation';
const PPTX = 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
const json = (body, status = 200) => new Response(JSON.stringify(body), { status });

/** A pretend Google Drive (folders, copies, trash) that records every request. */
function fakeDrive({ fillStatus = 200, slowDowns = 0 } = {}) {
  const files = new Map([['tmplSlides', { id: 'tmplSlides', name: 'Beat', mimeType: SLIDES, parents: ['lib'] }],
    ['tmplPptx', { id: 'tmplPptx', name: 'Song.pptx', mimeType: PPTX, parents: ['lib'] }],
    ['tmplPdf', { id: 'tmplPdf', name: 'Sheet.pdf', mimeType: 'application/pdf', parents: ['lib'] }]]);
  const calls = [];
  let n = 0;
  let busy = slowDowns; // "too many requests" answers still to give
  const make = (record) => { n += 1; const f = { id: `f${n}`, ...record }; files.set(f.id, f); return f; };
  const fillAnswer = () => (fillStatus === 200 ? json({}) : json({ error: { status: 'PERMISSION_DENIED', details: [{ reason: 'SERVICE_DISABLED' }] } }, fillStatus));
  const patch = (u, id, body) => {
    const f = files.get(id);
    if (!f) return json({}, 404);
    if (u.searchParams.get('addParents')) f.parents = [u.searchParams.get('addParents')];
    const labels = Object.entries({ ...f.appProperties, ...body.appProperties }).filter(([, v]) => v !== null); // null clears a label
    Object.assign(f, { ...body, appProperties: Object.fromEntries(labels) });
    return json(f);
  };
  const search = (u) => {
    const q = u.searchParams.get('q') ?? '';
    const name = q.match(/name = '([^']*)'/)?.[1];
    const parent = q.match(/^'([^']*)' in parents/)?.[1];
    const all = [...files.values()].filter((f) => !f.trashed);
    if (name) return json({ files: all.filter((f) => f.name === name && f.parents?.includes(parent)) });
    if (parent) return json({ files: all.filter((f) => f.parents?.includes(parent)) });
    return json({ files: all.filter((f) => f.appProperties?.[COPY_LABEL] === 'yr1') });
  };
  const fetchFn = async (url, init = {}) => {
    const u = new URL(url);
    const method = init.method || 'GET';
    const body = init.body ? JSON.parse(init.body) : null;
    calls.push({ method, url: u, body });
    if (u.host !== 'www.googleapis.com') return fillAnswer();
    const [, id, action] = u.pathname.match(/\/files\/([^/]+)\/?(\w*)/) ?? [];
    if (action === 'copy') return copy(id, body);
    if (method === 'POST') return json(make(body));
    return method === 'PATCH' ? patch(u, id, body) : get(u, id);
  };
  const get = (u, id) => (id ? json(files.get(id)) : search(u));
  const copy = (id, body) => {
    if (busy > 0) { busy -= 1; return json({ error: { code: 429 } }, 429); }
    return json(make({ ...body, mimeType: body.mimeType ?? files.get(id).mimeType }));
  };
  return { files, calls, fetchFn };
}

const want = (over = {}) => ({
  key: 'wk1', entryId: 'wk1', lessonId: 'les1', template: 'tmplSlides', path: ['Music', 'School A', 'Grade 1', 'Week 3'],
  name: '1 - Beat', values: { '{{school}}': 'School A', '{{week_number}}': '3' }, hash: 'h1', place: 'p1', ...over,
});

const copies = (drive) => driveCopies({ token: 'fake-token', rootId: 'root', yearId: 'yr1', fetchFn: drive.fetchFn, wait: async () => {} });

test('a copy is made in School › Grade › Week folders inside the output folder, labelled so it can be found again', async () => {
  const drive = fakeDrive();
  const have = await copies(drive).create(want(), { fileId: 'tmplSlides', mimeType: SLIDES });
  const folders = [...drive.files.values()].filter((f) => f.mimeType?.endsWith('folder'));
  assert.deepEqual(folders.map((f) => f.name), ['Music', 'School A', 'Grade 1', 'Week 3']);
  assert.equal(folders[0].parents[0], 'root');
  assert.equal(have.parentId, folders[3].id);
  assert.equal(have.name, '1 - Beat');
  const [found] = await copies(drive).list();
  assert.deepEqual({ entryId: found.entryId, lessonId: found.lessonId, place: found.place }, { entryId: 'wk1', lessonId: 'les1', place: 'p1' });
  assert.equal(found.hash, copyHash('tmplSlides', want().values));
  assert.deepEqual(found.values, want().values, 'what was typed in is remembered, to update it in place later');
});

test('existing folders are reused, not made again', async () => {
  const drive = fakeDrive();
  await copies(drive).create(want(), { fileId: 'tmplSlides', mimeType: SLIDES });
  await copies(drive).create(want({ entryId: 'wk2', name: '2 - Beat' }), { fileId: 'tmplSlides', mimeType: SLIDES });
  assert.equal([...drive.files.values()].filter((f) => f.mimeType?.endsWith('folder')).length, 4);
});

test('several copies made at once into the same new week folder make that folder only once', async () => {
  const drive = fakeDrive();
  const c = copies(drive);
  await Promise.all([1, 2, 3, 4].map((i) => c.create(want({ entryId: `wk${i}`, name: `${i} - Beat` }), { fileId: 'tmplSlides', mimeType: SLIDES })));
  const folders = [...drive.files.values()].filter((f) => f.mimeType?.endsWith('folder'));
  assert.deepEqual(folders.map((f) => f.name), ['Music', 'School A', 'Grade 1', 'Week 3']);
  assert.equal((await c.list()).length, 4);
});

test('two same-name week folders (made by two computers at once) are combined into the oldest', async () => {
  const drive = fakeDrive();
  const first = copies(drive);
  const one = await first.create(want(), { fileId: 'tmplSlides', mimeType: SLIDES });
  const grade = drive.files.get(one.parentId).parents[0];
  // The other computer made its own "Week 3" next to it, with a copy and a file of the teacher's inside.
  drive.files.set('twin', { id: 'twin', name: 'Week 3', mimeType: 'application/vnd.google-apps.folder', parents: [grade] });
  drive.files.set('theirs', { id: 'theirs', name: '2 - Beat', mimeType: SLIDES, parents: ['twin'], appProperties: { [COPY_LABEL]: 'yr1', entryId: 'wk2' } });
  drive.files.set('notes', { id: 'notes', name: 'My notes', mimeType: 'application/vnd.google-apps.document', parents: ['twin'] });
  const later = copies(drive); // the next visit looks the folders up again
  const three = await later.create(want({ entryId: 'wk3', name: '3 - Beat' }), { fileId: 'tmplSlides', mimeType: SLIDES });
  assert.equal(three.parentId, one.parentId, 'the oldest Week 3 is used');
  assert.equal(drive.files.get('twin').trashed, true, 'the empty twin goes to the trash');
  assert.deepEqual(['theirs', 'notes'].map((id) => drive.files.get(id).parents[0]), [one.parentId, one.parentId], 'nothing inside it is lost');
  const moved = await later.move({ ...(await later.list()).find((h) => h.id === 'theirs') }, want({ entryId: 'wk2', name: '2 - Beat', path: ['Music', 'School A', 'Grade 1', 'Week 4'] }));
  const call = drive.calls.filter((x) => x.method === 'PATCH' && x.url.pathname.endsWith('/theirs')).at(-1);
  assert.equal(call.url.searchParams.get('removeParents'), one.parentId, 'a later move starts from where it was moved to');
  assert.equal(drive.files.get(moved.parentId).name, 'Week 4');
});

test('when Google asks the planner to slow down, it waits a moment, tries again, and says so (to make fewer at once)', async () => {
  const drive = fakeDrive({ slowDowns: 2 });
  let told = 0;
  const c = driveCopies({ token: 'fake-token', rootId: 'root', yearId: 'yr1', fetchFn: drive.fetchFn, wait: async () => {}, onSlowDown: () => { told += 1; } });
  const have = await c.create(want(), { fileId: 'tmplSlides', mimeType: SLIDES });
  assert.equal(have.name, '1 - Beat');
  assert.equal(drive.calls.filter((x) => x.url.pathname.endsWith('/copy')).length, 3);
  assert.equal(told, 2);
});

test('a folder’s hidden labels can be read and changed (for the “who’s updating the copies” note)', async () => {
  const drive = fakeDrive();
  const labels = copies(drive).folderLabels(['Music']);
  await labels.write({ lpWorker: 'tab-a', lpWorkerUntil: '100' });
  assert.deepEqual(await labels.read(), { lpWorker: 'tab-a', lpWorkerUntil: '100' });
  await labels.write({ lpWorker: null, lpWorkerUntil: null });
  assert.deepEqual(await labels.read(), {});
});

test('details are filled in through Google Slides, in the copy only — the template is never changed', async () => {
  const drive = fakeDrive();
  const have = await copies(drive).create(want(), { fileId: 'tmplSlides', mimeType: SLIDES });
  const fill = drive.calls.find((c) => c.url.host === 'slides.googleapis.com');
  assert.ok(fill.url.pathname.includes(have.id));
  assert.deepEqual(fill.body.requests[0], { replaceAllText: { containsText: { text: '{{school}}', matchCase: true }, replaceText: 'School A' } });
  const touchingTemplate = drive.calls.filter((c) => c.url.pathname.includes('tmplSlides'));
  assert.deepEqual(touchingTemplate.map((c) => c.url.pathname.split('/').at(-1)), ['copy'], 'the template is only copied');
});

test('a PowerPoint template becomes Google Slides in its copy so details can be filled in', async () => {
  const drive = fakeDrive();
  const have = await copies(drive).create(want(), { fileId: 'tmplPptx', mimeType: PPTX });
  assert.equal(have.mimeType, SLIDES);
});

test('files that can’t be filled in are copied as they are', async () => {
  const drive = fakeDrive();
  const have = await copies(drive).create(want({ values: {} }), { fileId: 'tmplPdf', mimeType: 'application/pdf' });
  assert.equal(have.mimeType, 'application/pdf');
  assert.ok(!drive.calls.some((c) => c.url.host !== 'www.googleapis.com'));
});

test('if the Slides service is switched off, the half-made copy is put in the trash and the reason is given', async () => {
  const drive = fakeDrive({ fillStatus: 403 });
  await assert.rejects(copies(drive).create(want(), { fileId: 'tmplSlides', mimeType: SLIDES }),
    (err) => err.message === 'api_off' && err.api === 'Google Slides API');
  assert.equal((await copies(drive).list()).length, 0);
});

test('a copy moves to its new week folder with its new name', async () => {
  const drive = fakeDrive();
  const c = copies(drive);
  const have = await c.create(want(), { fileId: 'tmplSlides', mimeType: SLIDES });
  const moved = await c.move(have, want({ path: ['Music', 'School A', 'Grade 1', 'Week 4'], name: '2 - Beat', place: 'p2' }));
  const week4 = [...drive.files.values()].find((f) => f.name === 'Week 4');
  assert.equal(moved.parentId, week4.id);
  assert.equal(moved.name, '2 - Beat');
  assert.equal(moved.place, 'p2');
  const patch = drive.calls.at(-1);
  assert.equal(patch.url.searchParams.get('removeParents'), have.parentId);
});

test('a removed lesson’s copy goes to the trash (it can be brought back from there)', async () => {
  const drive = fakeDrive();
  const c = copies(drive);
  const have = await c.create(want(), { fileId: 'tmplSlides', mimeType: SLIDES });
  await c.remove(have);
  assert.equal(drive.files.get(have.id).trashed, true);
  assert.equal((await c.list()).length, 0);
  await c.remove(have); // already gone: no problem
});

test('a Google Slides template is saved as a PowerPoint file for a folder on the computer', async () => {
  const fetchFn = async (url) => (url.includes('/export') ? new Response('pptx-bytes') : json({ name: 'Beat', mimeType: SLIDES }));
  const { blob, ext } = await downloadTemplate('fake-token', 'tmplSlides', { fetchFn });
  assert.equal(ext, '.pptx');
  assert.equal(await blob.text(), 'pptx-bytes');
});

// ---------- a folder on the computer ----------

/** A pretend folder on the computer (what the browser hands the planner). */
function fakeFolder(name = 'root') {
  const entries = new Map();
  const fileHandle = (fname) => ({
    getFile: async () => new Blob([entries.get(fname).data]),
    createWritable: async () => ({ write: async (d) => { entries.get(fname).data = d instanceof Blob ? await d.text() : d; }, close: async () => {} }),
  });
  return {
    name, entries,
    getDirectoryHandle: async (n, { create } = {}) => {
      if (!entries.has(n)) { if (!create) throw new Error('NotFound'); entries.set(n, { dir: fakeFolder(n) }); }
      return entries.get(n).dir;
    },
    getFileHandle: async (n, { create } = {}) => {
      if (!entries.has(n)) { if (!create) throw new Error('NotFound'); entries.set(n, { data: '' }); }
      return fileHandle(n);
    },
    removeEntry: async (n) => { if (!entries.delete(n)) throw new Error('NotFound'); },
  };
}

const readTemplate = async () => ({ blob: new Blob(['deck']), ext: '.pptx' });
const walk = async (dir, path) => path.reduce(async (d, n) => (await d).getDirectoryHandle(n), Promise.resolve(dir));

test('on the computer: copies go into the same folders, are listed in the folder, move and are removed', async () => {
  const dir = fakeFolder();
  const c = localCopies({ dir, yearId: 'yr1', readTemplate });
  const have = await c.create(want(), { fileId: 'tmplSlides' });
  const week3 = await walk(dir, want().path);
  assert.ok(week3.entries.has('1 - Beat.pptx'));
  assert.ok(dir.entries.has(LIST_FILE));
  assert.equal((await localCopies({ dir, yearId: 'yr1', readTemplate }).list()).length, 1, 'found again after reopening');
  const moved = await c.move(have, want({ path: ['Music', 'School A', 'Grade 1', 'Week 4'], name: '2 - Beat', place: 'p2' }));
  assert.ok(!week3.entries.has('1 - Beat.pptx'));
  assert.ok((await walk(dir, moved.path)).entries.has('2 - Beat.pptx'));
  await c.remove(moved);
  assert.equal((await c.list()).length, 0);
});

test('on the computer: a name already taken in the week folder gets a number', async () => {
  const dir = fakeFolder();
  const c = localCopies({ dir, yearId: 'yr1', readTemplate });
  await c.create(want(), {});
  const second = await c.create(want({ entryId: 'wk2' }), {});
  assert.equal(second.fileName, '1 - Beat (2).pptx');
});

// ---------- updating in place, and pictures ----------

const run = (content) => ({ textRun: { content } });
const box = (objectId, text, more = {}) => ({ objectId, ...more, shape: { text: { textElements: [run(text)] } } });
const deck = (...pageElements) => ({ slides: [{ objectId: 's1', pageElements }] });

/**
 * A pretend Drive plus Google Slides: copies get the template's slides, Slides requests are recorded,
 * and pictures can be shared ("anyone with the link") — or sharing can be refused.
 */
function fakeGoogle({ template, refuseSharing = false, alreadyShared = false } = {}) {
  const drive = fakeDrive();
  const decks = new Map([['tmplSlides', template]]);
  const slideRequests = [];
  const permissions = new Map(); // picture id → permission ids
  const sharing = (u, method) => {
    const [, fileId, permissionId] = u.pathname.match(/\/files\/([^/]+)\/permissions\/?([^/]*)/);
    if (method === 'POST') {
      if (refuseSharing) return json({}, 403);
      permissions.set(fileId, ['perm1']);
      return json({ id: 'perm1' });
    }
    permissions.set(fileId, (permissions.get(fileId) ?? []).filter((p) => p !== permissionId));
    return new Response(null, { status: 204 });
  };
  const fetchFn = async (url, init = {}) => {
    const u = new URL(url);
    const method = init.method || 'GET';
    if (u.host === 'slides.googleapis.com') {
      drive.calls.push({ method, url: u, body: init.body ? JSON.parse(init.body) : null });
      const id = u.pathname.split('/presentations/')[1].split(':')[0];
      if (method === 'POST') { slideRequests.push({ id, requests: JSON.parse(init.body).requests, sharedNow: [...permissions.values()].flat().length > 0 }); return json({}); }
      return json(decks.get(id));
    }
    if (u.pathname.includes('/permissions')) return sharing(u, method);
    if (u.searchParams.get('fields') === 'permissionIds') return json({ permissionIds: alreadyShared ? ['anyoneWithLink'] : [] });
    const res = await drive.fetchFn(url, init);
    if (u.pathname.endsWith('/copy')) { const made = await res.clone().json(); decks.set(made.id, structuredClone(decks.get(u.pathname.split('/')[4]))); }
    return res;
  };
  return { ...drive, fetchFn, decks, slideRequests, permissions };
}

const SOURCE = { fileId: 'tmplSlides', mimeType: SLIDES };
const ANCHOR = { title: 'IMAGE_ANCHOR', size: { width: { magnitude: 1 } }, transform: { scaleX: 1 } };

test('changed details are swapped in the same file — no new copy, nothing in the trash', async () => {
  const google = fakeGoogle({ template: deck(box('week', 'Week {{week_number}}')) });
  const c = copies(google);
  const have = await c.create(want(), SOURCE);
  google.decks.set(have.id, deck(box('week', 'Week 3'))); // what the copy reads after filling in
  const before = google.files.size;
  const updated = await c.update(have, want({ values: { '{{school}}': 'School A', '{{week_number}}': '4' } }), SOURCE);
  assert.equal(updated.id, have.id, 'the same file, so its link stays the same');
  assert.equal(google.files.size, before, 'no new copy');
  assert.ok(![...google.files.values()].some((f) => f.trashed));
  assert.deepEqual(google.slideRequests.at(-1).requests, [
    { deleteText: { objectId: 'week', textRange: { type: 'FIXED_RANGE', startIndex: 5, endIndex: 6 } } },
    { insertText: { objectId: 'week', insertionIndex: 5, text: '4' } },
  ]);
  assert.equal(updated.values['{{week_number}}'], '4', 'the new details are remembered for next time');
});

test('a copy that was edited where a detail goes says it can’t be updated in place', async () => {
  const google = fakeGoogle({ template: deck(box('week', 'Week {{week_number}}')) });
  const c = copies(google);
  const have = await c.create(want(), SOURCE);
  google.decks.set(have.id, deck(box('week', 'Week three, my edit')));
  await assert.rejects(c.update(have, want({ values: { '{{school}}': 'School A', '{{week_number}}': '4' } }), SOURCE), { message: 'not_in_place' });
});

test('a reused copy moves to its new week and belongs to its new schedule entry', async () => {
  const google = fakeGoogle({ template: deck(box('week', 'Week {{week_number}}')) });
  const c = copies(google);
  const have = await c.create(want(), SOURCE);
  const moved = await c.update(have, want({ entryId: 'wk9', path: ['Music', 'School A', 'Grade 1', 'Week 5'], place: 'p5' }), SOURCE);
  assert.equal(moved.id, have.id);
  assert.equal(moved.entryId, 'wk9');
  assert.equal(google.files.get(moved.parentId).name, 'Week 5');
});

test('a picture is placed on its spot while shared for a moment — then sharing is turned off again', async () => {
  const google = fakeGoogle({ template: deck({ objectId: 'spot', ...ANCHOR }) });
  const made = await copies(google).create(want({ picture: 'fakePic' }), SOURCE);
  const placing = google.slideRequests.find((r) => r.requests.some((q) => q.createImage));
  assert.ok(placing.sharedNow, 'shared while Google fetched it');
  assert.match(placing.requests[0].createImage.url, /fakePic/);
  assert.deepEqual(placing.requests[1], { deleteObject: { objectId: 'spot' } });
  assert.deepEqual(google.permissions.get('fakePic'), [], 'not shared any more');
  assert.equal(made.picture, 'fakePic');
  assert.equal(made.pictureProblem, null);
});

test('a picture that’s already shared with anyone with the link is placed without touching its sharing', async () => {
  const google = fakeGoogle({ template: deck({ objectId: 'spot', ...ANCHOR }), alreadyShared: true });
  await copies(google).create(want({ picture: 'fakePic' }), SOURCE);
  assert.ok(!google.calls.some((call) => call.url.pathname.includes('/permissions')));
});

test('when Google won’t let the planner share a picture, the copy is still made and the problem is reported', async () => {
  const google = fakeGoogle({ template: deck({ objectId: 'spot', ...ANCHOR }), refuseSharing: true });
  const made = await copies(google).create(want({ picture: 'fakePic' }), SOURCE);
  assert.equal(made.pictureProblem.message, 'cant_share');
  assert.equal(made.picture, '');
  assert.notEqual(made.hash, copyHash('tmplSlides', want().values, 'fakePic'), 'it’s tried again after the next change');
  assert.ok(!google.files.get(made.id).trashed);
});

test('a new picture for the week replaces the old one where it is', async () => {
  const google = fakeGoogle({ template: deck({ objectId: 'spot', ...ANCHOR }) });
  const c = copies(google);
  const have = await c.create(want({ picture: 'fakePic' }), SOURCE);
  google.decks.set(have.id, deck({ objectId: 'lpPicture0_spot' }));
  await c.update(have, want({ picture: 'otherPic' }), SOURCE);
  const swap = google.slideRequests.at(-1).requests[0];
  assert.equal(swap.replaceImage.imageObjectId, 'lpPicture0_spot');
  assert.match(swap.replaceImage.url, /otherPic/);
});
