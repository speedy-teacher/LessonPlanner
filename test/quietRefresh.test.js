// Background news (lesson copies being made, pictures' sharing checked) redraws the page at a quiet
// moment, so clicks on the page (e.g. opening a folder of lesson templates) aren't swallowed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MENU_HOLD_MS, quietRedraw, watchHands, watchMenus } from '../public/js/quietRefresh.js';

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

// An open dropdown list (e.g. "Choose an eval…" on Lesson Templates) must stay open while the teacher
// scrolls it, even if background news would redraw the page.
const dropdown = () => ({ tagName: 'SELECT', multiple: false, size: 0 });
function fire(doc, type, target, extra = {}) {
  const e = new Event(type);
  Object.defineProperty(e, 'target', { value: target });
  Object.assign(e, extra);
  doc.dispatchEvent(e);
}

test('a dropdown list counts as open from its click until a pick, a click elsewhere or leaving it', () => {
  const doc = new EventTarget();
  let closes = 0;
  const isOpen = watchMenus(doc, () => { closes += 1; });
  const list = dropdown();
  assert.equal(isOpen(), false);
  fire(doc, 'pointerdown', list);
  assert.equal(isOpen(), true, 'clicking the list opens it');
  fire(doc, 'pointerup', list);
  fire(doc, 'wheel', list);
  assert.equal(isOpen(), true, 'letting go of the mouse and scrolling keep it open');
  fire(doc, 'change', list);
  assert.equal(isOpen(), false, 'picking an eval closes it');
  assert.equal(closes, 1);
  fire(doc, 'pointerdown', list);
  fire(doc, 'pointerdown', { tagName: 'DIV' });
  assert.equal(isOpen(), false, 'a click elsewhere closes it');
  fire(doc, 'pointerdown', list);
  fire(doc, 'focusout', list);
  assert.equal(isOpen(), false, 'leaving it closes it');
  assert.equal(closes, 3);
});

test('keyboard: Space or Alt+Down opens a dropdown list, Escape / Enter / Tab close it', () => {
  const doc = new EventTarget();
  const isOpen = watchMenus(doc);
  const list = dropdown();
  fire(doc, 'keydown', list, { key: 'ArrowDown' });
  assert.equal(isOpen(), false, 'plain arrows just change the choice');
  fire(doc, 'keydown', list, { key: ' ' });
  assert.equal(isOpen(), true);
  fire(doc, 'keydown', list, { key: 'Escape' });
  assert.equal(isOpen(), false);
  fire(doc, 'keydown', list, { key: 'ArrowDown', altKey: true });
  assert.equal(isOpen(), true);
  fire(doc, 'keydown', list, { key: 'Enter' });
  assert.equal(isOpen(), false);
});

test('only dropdown lists count — not buttons, boxes or lists that show many rows', () => {
  const doc = new EventTarget();
  const isOpen = watchMenus(doc);
  fire(doc, 'pointerdown', { tagName: 'BUTTON' });
  fire(doc, 'pointerdown', { tagName: 'INPUT' });
  fire(doc, 'pointerdown', { tagName: 'SELECT', multiple: true });
  fire(doc, 'pointerdown', { tagName: 'SELECT', size: 6 });
  assert.equal(isOpen(), false);
});

test('a list left alone for a long time stops holding redraws back', () => {
  const doc = new EventTarget();
  let clock = 0;
  const isOpen = watchMenus(doc, () => {}, { now: () => clock });
  fire(doc, 'pointerdown', dropdown());
  clock = MENU_HOLD_MS - 1;
  assert.equal(isOpen(), true, 'a long scroll is still fine');
  clock = MENU_HOLD_MS + 1;
  assert.equal(isOpen(), false);
});
