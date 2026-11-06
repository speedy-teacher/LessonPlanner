// Dragging a lesson (or eval/instrument) near the top or bottom of the page scrolls it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { edgeStep, EDGE_PX, MAX_STEP, MIN_STEP } from '../public/js/edgeScroll.js';

const TOP = 100;
const BOTTOM = 900;

test('the middle of the page does not scroll', () => {
  assert.equal(edgeStep(500, TOP, BOTTOM), 0);
  assert.equal(edgeStep(TOP + EDGE_PX + 1, TOP, BOTTOM), 0);
  assert.equal(edgeStep(BOTTOM - EDGE_PX - 1, TOP, BOTTOM), 0);
});

test('near the top scrolls up, near the bottom scrolls down', () => {
  assert.ok(edgeStep(TOP + 10, TOP, BOTTOM) < 0);
  assert.ok(edgeStep(BOTTOM - 10, TOP, BOTTOM) > 0);
});

test('closer to the edge scrolls faster', () => {
  const slow = Math.abs(edgeStep(TOP + EDGE_PX - 5, TOP, BOTTOM));
  const fast = Math.abs(edgeStep(TOP + 5, TOP, BOTTOM));
  assert.ok(slow >= MIN_STEP && fast > slow);
});

test('past the edge (over the tabs or below the page) scrolls at full speed', () => {
  assert.equal(edgeStep(20, TOP, BOTTOM), -MAX_STEP);
  assert.equal(edgeStep(BOTTOM + 30, TOP, BOTTOM), MAX_STEP);
});

test('a short window still has a middle that stays still', () => {
  assert.equal(edgeStep(250, 100, 400), 0);
  assert.ok(edgeStep(110, 100, 400) < 0);
});
