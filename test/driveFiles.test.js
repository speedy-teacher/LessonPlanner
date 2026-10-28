// Plan files in Google Drive: made in a "Lesson Planner" folder, found again (with ones shared
// with you), read, and saved — and problems come back as plain reasons.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createPlanFile, folderName, keepRevision, listPlanFiles, movePlanFile, planFileInfo, readPlanFile, savePlanFile,
} from '../public/js/driveFiles.js';

const json = (body, status = 200) => new Response(JSON.stringify(body), { status });
const asListed = (f) => ({ id: f.id, name: f.name, parents: f.parents, headRevisionId: f.rev, ownedByMe: true, capabilities: { canEdit: true } });

/** A pretend Google Drive that remembers files and the requests it was sent. */
function fakeDrive() {
  const files = new Map();
  const calls = [];
  let n = 0;
  const make = (record) => { n += 1; const id = `f${n}`; files.set(id, { ...record, id }); return files.get(id); };
  const routes = [
    [(r) => r.method === 'POST' && !r.url.pathname.includes('upload'), (r) => json({ id: make(JSON.parse(r.init.body)).id })],
    [(r) => r.method === 'POST', (r) => {
      const parts = r.init.body.split('\r\n');
      return json(asListed(make({ ...JSON.parse(parts[3]), content: parts[7], rev: 'rev1' })));
    }],
    [(r) => r.method === 'PATCH' && r.url.pathname.includes('/revisions/'), () => json({ keepForever: true })],
    [(r) => r.method === 'PATCH' && r.url.searchParams.has('addParents'), (r) => {
      const f = files.get(r.id);
      const remove = r.url.searchParams.get('removeParents');
      f.parents = [...(f.parents || []).filter((p) => p !== remove), r.url.searchParams.get('addParents')];
      return json({ parents: f.parents });
    }],
    [(r) => r.method === 'PATCH', (r) => {
      const f = files.get(r.id);
      if (!f) return json({}, 404);
      Object.assign(f, { content: r.init.body, rev: `rev${Number(f.rev.slice(3)) + 1}` });
      return json({ headRevisionId: f.rev });
    }],
    [(r) => r.id && r.url.searchParams.get('alt') === 'media', (r) => new Response(files.get(r.id).content)],
    [(r) => r.id, (r) => (files.has(r.id) ? json(asListed(files.get(r.id))) : json({}, 404))],
    [(r) => r.url.searchParams.get('q').includes("value='folder'"), () => json({ files: [...files.values()].filter((f) => f.mimeType?.includes('folder')) })],
    [() => true, () => json({ files: [...files.values()].filter((f) => f.properties?.lessonPlanner === 'workspace').map(asListed) })],
  ];
  const fetchFn = async (url, init = {}) => {
    const u = new URL(url);
    const r = { method: init.method || 'GET', url: u, init, id: u.pathname.split('/files/')[1]?.split('/')[0] };
    calls.push(r);
    return routes.find(([match]) => match(r))[1](r);
  };
  return { files, calls, fetchFn, make };
}

test('a new plan is saved into one "Lesson Planner" folder and can be found and read again', async () => {
  const drive = fakeDrive();
  const a = await createPlanFile('tok', { name: 'Music Plans A', text: '{"a":1}' }, drive);
  const b = await createPlanFile('tok', { name: 'Music Plans B', text: '{"b":2}' }, drive);
  const folders = [...drive.files.values()].filter((f) => f.mimeType?.includes('folder'));
  assert.equal(folders.length, 1, 'the folder is made only once');
  assert.equal(folders[0].name, 'Lesson Planner');
  assert.deepEqual(drive.files.get(a.fileId).parents, [folders[0].id]);
  assert.deepEqual((await listPlanFiles('tok', drive)).map((f) => f.name).sort(), ['Music Plans A', 'Music Plans B']);
  const read = await readPlanFile('tok', b.fileId, drive);
  assert.equal(read.text, '{"b":2}');
  assert.equal(read.rev, 'rev1');
  assert.ok(drive.calls.every((c) => c.init.headers.Authorization === 'Bearer tok'));
});

test('saving replaces the contents and gives the new version, which Drive can keep forever', async () => {
  const drive = fakeDrive();
  const { fileId } = await createPlanFile('tok', { name: 'P', text: 'one' }, drive);
  assert.equal(await savePlanFile('tok', fileId, 'two', drive), 'rev2');
  assert.equal((await readPlanFile('tok', fileId, drive)).text, 'two');
  await keepRevision('tok', fileId, 'rev2', drive);
  const keep = drive.calls.at(-1);
  assert.match(keep.url.pathname, /\/revisions\/rev2$/);
  assert.deepEqual(JSON.parse(keep.init.body), { keepForever: true });
});

test('problems with Drive come back as plain reasons', async () => {
  const status = (code) => ({ fetchFn: async () => new Response('{}', { status: code }) });
  await assert.rejects(savePlanFile('tok', 'x', '', status(401)), /signed_out/);
  await assert.rejects(savePlanFile('tok', 'x', '', status(403)), /no_access/);
  await assert.rejects(savePlanFile('tok', 'x', '', status(404)), /not_found/);
  await assert.rejects(savePlanFile('tok', 'x', '', status(500)), /drive_failed/);
  await assert.rejects(savePlanFile('tok', 'x', '', { fetchFn: async () => { throw new TypeError('network'); } }), /offline/);
});

test('a plan can be saved in a folder you pick, and moved to another folder later', async () => {
  const drive = fakeDrive();
  const term = drive.make({ name: 'Plans by year', mimeType: 'application/vnd.google-apps.folder', parents: ['root'] });
  const other = drive.make({ name: 'Archive', mimeType: 'application/vnd.google-apps.folder', parents: ['root'] });
  const plan = await createPlanFile('tok', { name: 'Music Plans A', text: '{}', folderId: term.id }, drive);
  assert.equal(plan.folderId, term.id);
  assert.ok(![...drive.files.values()].some((f) => f.name === 'Lesson Planner'), 'no extra folder is made');
  assert.equal(await folderName('tok', term.id, drive), 'Plans by year');

  assert.equal(await movePlanFile('tok', plan.fileId, other.id, drive), other.id);
  assert.deepEqual(drive.files.get(plan.fileId).parents, [other.id], 'it leaves the old folder');
  assert.equal((await planFileInfo('tok', plan.fileId, drive)).folderId, other.id);
});
