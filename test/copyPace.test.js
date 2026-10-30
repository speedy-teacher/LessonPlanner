// Lesson copies are made a few at a time; when Google says "slow down" the planner drops to one at
// a time, then speeds back up step by step.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { copyPace, MOST_JOBS, STEP_MS } from '../public/js/copyPace.js';

function clock() {
  const c = { time: 5_000_000 };
  c.now = () => c.time;
  return c;
}

test('normally a few copies are worked on at once', () => {
  assert.equal(copyPace().jobs(), MOST_JOBS);
  assert.equal(MOST_JOBS, 4);
});

test('after Google says “slow down” it’s one at a time, then speeds back up one step every half minute', () => {
  const c = clock();
  const pace = copyPace({ now: c.now });
  pace.slowDown();
  const seen = [];
  for (let i = 0; i < 5; i += 1) { seen.push(pace.jobs()); c.time += STEP_MS; }
  assert.deepEqual(seen, [1, 2, 3, 4, 4]);
});

test('another “slow down” while speeding back up starts over at one', () => {
  const c = clock();
  const pace = copyPace({ now: c.now });
  pace.slowDown();
  c.time += 2 * STEP_MS;
  assert.equal(pace.jobs(), 3);
  pace.slowDown();
  assert.equal(pace.jobs(), 1);
});
