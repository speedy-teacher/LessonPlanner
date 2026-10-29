// Lesson copies in Google Drive and in a folder on the computer: copies are made from the template
// (never changing it), details are filled in through Google's Slides/Docs/Sheets services,
// copies move to their week folder, and removed lessons' copies go to the trash.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { downloadTemplate, driveCopies, COPY_LABEL } from '../public/js/exportDrive.js';
import { localCopies, LIST_FILE } from '../public/js/exportLocal.js';

const SLIDES = 'application/vnd.google-apps.presentation';
const PPTX = 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
const json = (body, status = 200) => new Response(JSON.stringify(body), { status });

/** A pretend Google Drive (folders, copies, trash) that records every request. */
function fakeDrive({ fillStatus = 200 } = {}) {
  const files = new Map([['tmplSlides', { id: 'tmplSlides', name: 'Beat', mimeType: SLIDES, parents: ['lib'] }],
    ['tmplPptx', { id: 'tmplPptx', name: 'Song.pptx', mimeType: PPTX, parents: ['lib'] }],
    ['tmplPdf', { id: 'tmplPdf', name: 'Sheet.pdf', mimeType: 'application/pdf', parents: ['lib'] }]]);
  const calls = [];
  let n = 0;
  const make = (record) => { n += 1; const f = { id: `f${n}`, ...record }; files.set(f.id, f); return f; };
  const fillAnswer = () => (fillStatus === 200 ? json({}) : json({ error: { status: 'PERMISSION_DENIED', details: [{ reason: 'SERVICE_DISABLED' }] } }, fillStatus));
  const patch = (u, id, body) => {
    const f = files.get(id);
    if (!f) return json({}, 404);
    if (u.searchParams.get('addParents')) f.parents = [u.searchParams.get('addParents')];
    Object.assign(f, { ...body, appProperties: { ...f.appProperties, ...body.appProperties } });
    return json(f);
  };
  const search = (u) => {
    const q = u.searchParams.get('q') ?? '';
    const name = q.match(/name = '([^']*)'/)?.[1];
    const parent = q.match(/^'([^']*)' in parents/)?.[1];
    const all = [...files.values()].filter((f) => !f.trashed);
    if (name) return json({ files: all.filter((f) => f.name === name && f.parents?.includes(parent)) });
    return json({ files: all.filter((f) => f.appProperties?.[COPY_LABEL] === 'yr1') });
  };
  const fetchFn = async (url, init = {}) => {
    const u = new URL(url);
    const method = init.method || 'GET';
    const body = init.body ? JSON.parse(init.body) : null;
    calls.push({ method, url: u, body });
    if (u.host !== 'www.googleapis.com') return fillAnswer();
    const [, id, action] = u.pathname.match(/\/files\/([^/]+)\/?(\w*)/) ?? [];
    if (action === 'copy') return json(make({ ...body, mimeType: body.mimeType ?? files.get(id).mimeType }));
    if (method === 'POST') return json(make(body));
    return method === 'PATCH' ? patch(u, id, body) : search(u);
  };
  return { files, calls, fetchFn };
}

const want = (over = {}) => ({
  key: 'wk1', entryId: 'wk1', lessonId: 'les1', template: 'tmplSlides', path: ['Music', 'School A', 'Grade 1', 'Week 3'],
  name: '1 - Beat', values: { '{{school}}': 'School A', '{{week_number}}': '3' }, hash: 'h1', place: 'p1', ...over,
});

const copies = (drive) => driveCopies({ token: 'fake-token', rootId: 'root', yearId: 'yr1', fetchFn: drive.fetchFn });

test('a copy is made in School › Grade › Week folders inside the output folder, labelled so it can be found again', async () => {
  const drive = fakeDrive();
  const have = await copies(drive).create(want(), { fileId: 'tmplSlides', mimeType: SLIDES });
  const folders = [...drive.files.values()].filter((f) => f.mimeType?.endsWith('folder'));
  assert.deepEqual(folders.map((f) => f.name), ['Music', 'School A', 'Grade 1', 'Week 3']);
  assert.equal(folders[0].parents[0], 'root');
  assert.equal(have.parentId, folders[3].id);
  assert.equal(have.name, '1 - Beat');
  const [found] = await copies(drive).list();
  assert.deepEqual({ entryId: found.entryId, lessonId: found.lessonId, hash: found.hash, place: found.place }, { entryId: 'wk1', lessonId: 'les1', hash: 'h1', place: 'p1' });
});

test('existing folders are reused, not made again', async () => {
  const drive = fakeDrive();
  await copies(drive).create(want(), { fileId: 'tmplSlides', mimeType: SLIDES });
  await copies(drive).create(want({ entryId: 'wk2', name: '2 - Beat' }), { fileId: 'tmplSlides', mimeType: SLIDES });
  assert.equal([...drive.files.values()].filter((f) => f.mimeType?.endsWith('folder')).length, 4);
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
