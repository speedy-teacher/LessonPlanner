// Dragging a lesson (or eval/instrument) near the top or bottom of the page scrolls it:
// fast at the very edge, slow just outside the middle half, never inside the middle half.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { edgeSpeed, edgeStep, MAX_SPEED, MIN_SPEED } from '../public/js/edgeScroll.js';

const TOP = 100;
const BOTTOM = 900; // 800 tall: middle half = 300…700

test('the middle half of the page does not scroll', () => {
  for (const y of [300, 400, 500, 600, 700]) assert.equal(edgeSpeed(y, TOP, BOTTOM), 0, `at ${y}`);
});

test('the top quarter scrolls up, the bottom quarter scrolls down', () => {
  assert.ok(edgeSpeed(250, TOP, BOTTOM) < 0);
  assert.ok(edgeSpeed(750, TOP, BOTTOM) > 0);
});

test('just outside the middle half it is slow', () => {
  const speed = Math.abs(edgeSpeed(295, TOP, BOTTOM));
  assert.ok(speed >= MIN_SPEED && speed < 100, `speed ${speed}`);
});

test('it speeds up steadily toward the very edge', () => {
  const speeds = [280, 240, 200, 160, 120, 105].map((y) => Math.abs(edgeSpeed(y, TOP, BOTTOM)));
  speeds.slice(1).forEach((s, i) => assert.ok(s > speeds[i], `${s} > ${speeds[i]}`));
  assert.ok(Math.abs(edgeSpeed(200, TOP, BOTTOM)) < MAX_SPEED / 4, 'halfway into the zone is still gentle');
});

test('at or past the edge (over the tabs, below the page) it is fastest', () => {
  assert.equal(edgeSpeed(TOP, TOP, BOTTOM), -MAX_SPEED);
  assert.equal(edgeSpeed(20, TOP, BOTTOM), -MAX_SPEED);
  assert.equal(edgeSpeed(BOTTOM + 30, TOP, BOTTOM), MAX_SPEED);
});

test('the distance depends on time, not on how often the mouse moves', () => {
  assert.equal(edgeStep(120, TOP, BOTTOM, 1000), edgeSpeed(120, TOP, BOTTOM));
  assert.equal(edgeStep(120, TOP, BOTTOM, 500) * 2, edgeStep(120, TOP, BOTTOM, 1000));
});
