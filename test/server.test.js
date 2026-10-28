// The local server only serves the planner's files, plus (read-only) the data the
// older planner saved on this computer, so it can be moved to Google Drive.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../server.js';
import { seedState } from '../public/js/seed.js';

async function withServer(dataDir, fn) {
  const server = createApp({ dataDir });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try { return await fn(base); } finally { server.close(); }
}

test('the older planner’s saved data can be read (to move it to Drive), but never changed', async () => {
  const dataDir = await mkdtemp(join(tmpdir(), 'planner-'));
  try {
    await withServer(dataDir, async (base) => {
      assert.deepEqual(await (await fetch(`${base}/api/state`)).json(), { state: null });
    });
    const state = seedState();
    await writeFile(join(dataDir, 'lesson-planner.json'), JSON.stringify(state));
    await withServer(dataDir, async (base) => {
      assert.deepEqual((await (await fetch(`${base}/api/state`)).json()).state, state);
      const res = await fetch(`${base}/api/state`, { method: 'PUT', body: JSON.stringify({ hello: 1 }) });
      assert.equal(res.status, 405);
    });
    assert.deepEqual(JSON.parse(await readFile(join(dataDir, 'lesson-planner.json'), 'utf8')), state);
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});

test('the app page is served, with addresses that also work from a web host’s sub-folder', async () => {
  await withServer(await mkdtemp(join(tmpdir(), 'planner-')), async (base) => {
    const res = await fetch(base);
    assert.equal(res.status, 200);
    const page = await res.text();
    assert.match(page, /Lesson Planner/);
    assert.doesNotMatch(page, /(src|href)="\/[^/]/, 'no addresses starting at the site root');
    assert.equal((await fetch(`${base}/js/app.js`)).status, 200);
    assert.equal((await fetch(`${base}/../server.js`)).status, 404);
  });
});
