// Talking to Google: "slow down" answers are retried after 1, 3 and 8 s and slow the tool down; other
// problems get plain names; several files are worked on at once, as many as the pace allows.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { googleClient, isSlowDown, problemText, RETRY_WAITS, runPool } from '../public/js/templateMaker/googleApi.js';
import { copyPace } from '../public/js/copyPace.js';

const answer = (status, body = {}) => new Response(JSON.stringify(body), { status });

test('“slow down” answers are waited out (1, 3, 8 seconds), reported, then given up on', async () => {
  const waits = [];
  let slowed = 0;
  let calls = 0;
  const client = googleClient({ token: () => 't', fetchFn: async () => { calls += 1; return answer(503); }, sleep: async (ms) => { waits.push(ms); }, onSlowDown: () => { slowed += 1; } });
  await assert.rejects(client.json('https://x.test'), { message: 'slow_down' });
  assert.deepEqual(waits, RETRY_WAITS);
  assert.equal(calls, 4);
  assert.equal(slowed, 4);
});

test('which answers mean “slow down”', () => {
  assert.equal(isSlowDown(429), true);
  assert.equal(isSlowDown(500), true);
  assert.equal(isSlowDown(403, ['rateLimitExceeded']), true);
  assert.equal(isSlowDown(403, ['insufficientPermissions']), false);
  assert.equal(isSlowDown(404), false);
});

test('problems get plain names, and a switched-off API is named', async () => {
  const fail = (status, body) => googleClient({ token: () => 't', fetchFn: async () => answer(status, body) }).json('https://x.test');
  await assert.rejects(fail(401), { message: 'signed_out' });
  await assert.rejects(fail(404), { message: 'not_found' });
  await assert.rejects(fail(403, { error: { errors: [{ reason: 'forbidden' }] } }), { message: 'no_access' });
  const off = await fail(403, { error: { message: 'Google Slides API has not been used in project 123 before or it is disabled.', errors: [{ reason: 'accessNotConfigured' }] } }).catch((e) => e);
  assert.equal(off.message, 'api_disabled');
  assert.match(problemText(off), /Google Slides API isn’t turned on/);
  const offline = googleClient({ token: () => 't', fetchFn: async () => { throw new TypeError('network'); } });
  await assert.rejects(offline.json('https://x.test'), { message: 'offline' });
});

test('the sign-in pass goes with every call', async () => {
  let seen;
  await googleClient({ token: () => 'pass-1', fetchFn: async (_u, init) => { seen = init.headers.Authorization; return answer(200, {}); } }).json('https://x.test');
  assert.equal(seen, 'Bearer pass-1');
});

test('several files at once: never more than the pace allows, results in order, one failure doesn’t stop the rest', async () => {
  let active = 0;
  let most = 0;
  const pace = copyPace({ most: 3 });
  const results = await runPool([1, 2, 3, 4, 5, 6, 7], async (n) => {
    active += 1;
    most = Math.max(most, active);
    await new Promise((r) => { setTimeout(r, 5); });
    active -= 1;
    if (n === 4) throw new Error('nope');
    return n * 10;
  }, { pace });
  assert.equal(most, 3);
  assert.deepEqual(results.map((r) => (r.ok ? r.value : r.error.message)), [10, 20, 30, 'nope', 50, 60, 70]);
  assert.deepEqual(await runPool([], async () => 1, { pace }), []);
});

test('after a “slow down”, one file at a time', async () => {
  let active = 0;
  let most = 0;
  const pace = copyPace();
  pace.slowDown();
  await runPool([1, 2, 3], async () => { active += 1; most = Math.max(most, active); await new Promise((r) => { setTimeout(r, 2); }); active -= 1; }, { pace });
  assert.equal(most, 1);
});
