// Background news (lesson copies being made, pictures' sharing checked) redraws the page at a quiet
// moment, so clicks on the page (e.g. opening a folder of lesson templates) aren't swallowed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { quietRedraw, watchHands } from '../public/js/quietRefresh.js';

const wait = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });

test('several background updates in a row make a single redraw, a moment later', async () => {
  let redraws = 0;
  const soon = quietRedraw(() => { redraws += 1; }, { delay: 30 });
  soon(); soon(); soon();
  assert.equal(redraws, 0, 'not straight away');
  await wait(60);
  assert.equal(redraws, 1);
  soon();
  await wait(60);
  assert.equal(redraws, 2, 'later news redraws again');
});

test('no redraw while a mouse button is held or something is dragged', async () => {
  const doc = new EventTarget();
  const busy = watchHands(doc);
  let redraws = 0;
  const soon = quietRedraw(() => { redraws += 1; }, { delay: 20, retry: 10, isBusy: busy });
  doc.dispatchEvent(new Event('pointerdown'));
  soon();
  await wait(80);
  assert.equal(redraws, 0, 'waits while the button is held');
  doc.dispatchEvent(new Event('pointerup'));
  await wait(40);
  assert.equal(redraws, 1);
  doc.dispatchEvent(new Event('dragstart'));
  soon();
  await wait(60);
  assert.equal(redraws, 1, 'waits during a drag');
  doc.dispatchEvent(new Event('drop'));
  await wait(40);
  assert.equal(redraws, 2);
});
