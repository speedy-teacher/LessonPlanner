// Data is saved and loaded automatically through the local server.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
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

test('saved data is loaded again after the planner restarts', async () => {
  const dataDir = await mkdtemp(join(tmpdir(), 'planner-'));
  const state = seedState();
  try {
    await withServer(dataDir, async (base) => {
      assert.deepEqual(await (await fetch(`${base}/api/state`)).json(), { state: null });
      const res = await fetch(`${base}/api/state`, { method: 'PUT', body: JSON.stringify(state) });
      assert.equal(res.status, 200);
    });
    await withServer(dataDir, async (base) => {
      const { state: loaded } = await (await fetch(`${base}/api/state`)).json();
      assert.deepEqual(loaded, state);
    });
    assert.equal((await readdir(join(dataDir, 'backups'))).length, 1);
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});

test('nonsense data is refused instead of overwriting the planner', async () => {
  const dataDir = await mkdtemp(join(tmpdir(), 'planner-'));
  try {
    await withServer(dataDir, async (base) => {
      const res = await fetch(`${base}/api/state`, { method: 'PUT', body: JSON.stringify({ hello: 1 }) });
      assert.equal(res.status, 400);
    });
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});

test('the app page is served', async () => {
  await withServer(await mkdtemp(join(tmpdir(), 'planner-')), async (base) => {
    const res = await fetch(base);
    assert.equal(res.status, 200);
    assert.match(await res.text(), /Lesson Planner/);
    assert.equal((await fetch(`${base}/../server.js`)).status, 404);
  });
});
