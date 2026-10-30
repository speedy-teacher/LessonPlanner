// The planner open on two computers (or in two tabs) as the same teacher: only one updates the
// lesson copies at a time, the other waits, and a computer that was closed mid-update is taken over from.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CLAIM_MS, claimState, copyLock } from '../public/js/copyLock.js';

/** A pretend Drive folder's hidden labels and a pretend clock, shared by both computers. */
function shared() {
  const world = { labels: {}, time: 1_000_000 };
  const computer = (me, { onWait } = {}) => copyLock({
    me,
    read: async () => ({ ...world.labels }),
    write: async (labels) => {
      world.labels = Object.fromEntries(Object.entries({ ...world.labels, ...labels }).filter(([, v]) => v !== null));
    },
    now: () => world.time,
    wait: async (ms) => { world.time += ms; await onWait?.(); },
  });
  return { world, computer };
}

test('the first computer to look claims the copies; the other one is told to wait', async () => {
  const { computer } = shared();
  const school = computer('school-laptop');
  const home = computer('home-laptop');
  assert.equal(await school.claim(), 'new');
  assert.equal(await home.claim(), 'taken');
  assert.equal(await school.claim(), 'kept', 'renewing while working keeps it');
});

test('when it’s done, the other computer may take over', async () => {
  const { computer } = shared();
  const school = computer('school-laptop');
  const home = computer('home-laptop');
  await school.claim();
  await school.release();
  assert.equal(await home.claim(), 'new');
});

test('a computer closed in the middle of updating is taken over from once its note runs out', async () => {
  const { world, computer } = shared();
  await computer('school-laptop').claim();
  const home = computer('home-laptop');
  world.time += CLAIM_MS - 10_000;
  assert.equal(await home.claim(), 'taken');
  world.time += 20_000;
  assert.equal(await home.claim(), 'new');
});

test('two computers claiming at the very same moment: only one gets it', async () => {
  const { computer } = shared();
  let other;
  const school = computer('school-laptop', { onWait: async () => { if (other) { const o = other; other = null; await o(); } } });
  const home = computer('home-laptop');
  const results = {};
  // The home laptop writes its claim while the school laptop is waiting to read its own back.
  other = async () => { results.home = await home.claim(); };
  results.school = await school.claim();
  assert.deepEqual(Object.values(results).sort(), ['new', 'taken']);
});

test('a computer that lost its claim finds out the next time it renews', async () => {
  const { world, computer } = shared();
  const school = computer('school-laptop');
  await school.claim();
  world.labels = { lpWorker: 'home-laptop', lpWorkerUntil: String(world.time + CLAIM_MS) };
  assert.equal(await school.claim(), 'taken');
  await school.release();
  assert.equal(claimState(world.labels, 'home-laptop', world.time), 'mine', 'releasing never clears someone else’s note');
});
