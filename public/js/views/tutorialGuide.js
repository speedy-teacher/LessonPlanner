// Draws a running tutorial: the page dims except the parts the step lights up (those stay clickable),
// with a speech bubble next to them. Which step comes next is worked out in tutorialPlan.js.
//
// The dimming is one SVG shape with holes cut out (even-odd fill), so clicks and drags in a hole
// reach the page underneath, while clicks on the dim part don't. The page redraws itself after
// every change, so the lit-up parts are looked up again on every animation frame.

import { h } from '../dom.js';
import { createRunner, mergeBoxes, targetNames } from '../tutorialPlan.js';
import { store } from '../store.js';
import { google } from '../google.js';
import { driveAvailable } from '../deviceSettings.js';
import { inYear } from '../model.js';

const PAD = 6;
const GAP = 14;
const CHECK_EVERY_MS = 300;
const MISSING_AFTER_MS = 1200;
// Always usable during a tutorial: a dialog that opened, bottom-left notices, the Undo toast.
const ALWAYS_OPEN = ['#modal.show .modal-card', '.notices .notice', '#toast.show'];

let runner = null;
let layer = null;
let bubble = null;
let frame = 0;
let shownKey = '';
let scrolledKey = '';
let missingSince = 0;
let holes = [];
let lit = []; // the step's own parts and their open menus (holes also has open dialogs and notices)

const byTour = (name) => `[data-tour="${CSS.escape(name)}"]`;

/** What the tutorial steps can look at (see tutorials.js). */
export function tutorialContext() {
  const state = store.state;
  const year = state?.years.find((y) => y.id === state.activeYearId) ?? null;
  return {
    hasPlan: Boolean(state),
    tab: store.ui.tab || 'plan',
    ui: store.ui,
    state: state ?? { criteria: [] },
    year,
    google: google.status,
    driveAvailable: driveAvailable(),
    count: (collection) => countOf(state, year, collection),
    isOpen: (name) => [...document.querySelectorAll(byTour(name))].some((el) => el.open),
    exists: (name) => Boolean(document.querySelector(byTour(name))),
    modal: document.querySelector('#modal.show .modal-card')?.getAttribute('aria-label') ?? null,
  };
}

function countOf(state, year, collection) {
  const list = state?.[collection];
  if (!list || !year) return 0;
  return list.some((r) => 'yearId' in r) ? inYear(state, collection, year.id).length : list.length;
}

/** Get ready to run tutorials. `onFinish(id)` is told when one is finished. */
export function setUpTutorials({ tutorials, onFinish }) {
  runner = createRunner({ tutorials, context: tutorialContext, onChange: () => { shownKey = ''; }, onFinish });
  document.addEventListener('click', noticeClick, true);
  setInterval(() => runner.running && runner.check(), CHECK_EVERY_MS);
}

/** Start a tutorial by id (from the 🎓 menu, or the "next tutorial" button). */
export function startTutorial(id) {
  if (!runner) return;
  build();
  runner.start(id);
  cancelAnimationFrame(frame);
  frame = requestAnimationFrame(tick);
}

export function stopTutorial() {
  runner?.exit();
  cancelAnimationFrame(frame);
  layer?.remove();
  bubble?.remove();
  layer = null;
  bubble = null;
}

/** For the store's redraws: look at the step again right away. */
export function checkTutorial() {
  if (runner?.running) runner.check();
}

// ---------- every frame ----------

function tick() {
  if (!runner?.running) { stopTutorial(); return; }
  const view = runner.view();
  const targets = view.phase === 'step' ? findTargets(view.step) : [];
  const missing = Boolean(view.phase === 'step' && (view.step.target || view.step.selector) && !targets.length);
  const lost = missingFor(missing) > MISSING_AFTER_MS;
  lit = [...targets, ...openMenus(targets)];
  holes = targets.length ? [...lit, ...alwaysOpen()] : [];
  drawDim(holes, lit.length, missing);
  drawBubble(view, lost);
  placeBubble(lit);
  scrollIntoViewOnce(view, targets);
  frame = requestAnimationFrame(tick);
}

/** How long (ms) the step's part has been missing from the screen. */
function missingFor(missing) {
  if (!missing) { missingSince = 0; return 0; }
  if (!missingSince) missingSince = Date.now();
  return Date.now() - missingSince;
}

function findTargets(step) {
  const selectors = [...targetNames(step).map(byTour), ...(step.selector ? [step.selector] : [])];
  return selectors.flatMap((sel) => {
    const found = [...document.querySelectorAll(sel)].filter(isShown);
    if (step.pick === 'all') return found;
    return found.length ? [step.pick === 'last' ? found.at(-1) : found[0]] : [];
  });
}

function isShown(el) {
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.height > 0;
}

/** An open menu floats outside its button, so it's lit up too. */
function openMenus(targets) {
  return targets.flatMap((el) => [el, ...el.querySelectorAll('details')])
    .filter((el) => el.matches('details[open]'))
    .map((el) => el.querySelector('.menu-card'))
    .filter(Boolean);
}

function alwaysOpen() {
  return ALWAYS_OPEN.flatMap((sel) => [...document.querySelectorAll(sel)]).filter(isShown);
}

// ---------- the dim layer ----------

function build() {
  if (layer) return;
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.classList.add('tutorial-dim');
  svg.innerHTML = '<path fill-rule="evenodd" />';
  // Scrolling over the dim part still scrolls the page underneath.
  svg.addEventListener('wheel', passScroll, { passive: false });
  layer = h('div', { class: 'tutorial-layer', 'aria-hidden': 'true' }, svg, h('div', { class: 'tutorial-rings' }));
  bubble = h('div', { class: 'tutorial-bubble', role: 'dialog', 'aria-live': 'polite', 'aria-label': 'Tutorial' });
  document.body.append(layer, bubble);
}

/** Dims the page except `rects`; the first `ringed` of them (the step's own parts) also get a glowing ring. */
function drawDim(rects, ringed, missing) {
  const svg = layer.querySelector('svg');
  const { innerWidth: w, innerHeight: hgt } = window;
  svg.setAttribute('viewBox', `0 0 ${w} ${hgt}`);
  // A step whose part isn't on screen doesn't dim anything, so the teacher can go and find it.
  layer.classList.toggle('clear', missing);
  const boxes = rects.map(box);
  svg.firstChild.setAttribute('d', `M0 0H${w}V${hgt}H0Z ${mergeBoxes(boxes).map(roundRect).join(' ')}`);
  const rings = layer.querySelector('.tutorial-rings');
  const shown = boxes.slice(0, ringed);
  while (rings.children.length > shown.length) rings.lastChild.remove();
  while (rings.children.length < shown.length) rings.append(h('div', { class: 'tutorial-ring' }));
  shown.forEach((b, i) => Object.assign(rings.children[i].style, {
    left: `${b.x}px`, top: `${b.y}px`, width: `${b.w}px`, height: `${b.h}px`,
  }));
}

function box(el) {
  const r = el.getBoundingClientRect();
  const x = Math.max(0, r.left - PAD);
  const y = Math.max(0, r.top - PAD);
  return { x, y, w: Math.min(window.innerWidth, r.right + PAD) - x, h: Math.min(window.innerHeight, r.bottom + PAD) - y };
}

function roundRect({ x, y, w, h: hgt }) {
  const r = Math.min(12, w / 2, hgt / 2);
  return `M${x + r} ${y}H${x + w - r}A${r} ${r} 0 0 1 ${x + w} ${y + r}V${y + hgt - r}A${r} ${r} 0 0 1 ${x + w - r} ${y + hgt}`
    + `H${x + r}A${r} ${r} 0 0 1 ${x} ${y + hgt - r}V${y + r}A${r} ${r} 0 0 1 ${x + r} ${y}Z`;
}

function passScroll(e) {
  const svg = e.currentTarget;
  svg.style.pointerEvents = 'none';
  const below = document.elementFromPoint(e.clientX, e.clientY);
  svg.style.pointerEvents = '';
  let el = below;
  while (el && el !== document.body && !(el.scrollHeight > el.clientHeight && /auto|scroll/.test(getComputedStyle(el).overflowY))) el = el.parentElement;
  (el && el !== document.body ? el : document.getElementById('main'))?.scrollBy(e.deltaX, e.deltaY);
  e.preventDefault();
}

function scrollIntoViewOnce(view, targets) {
  const key = `${view.tutorial?.id}/${view.number}`;
  if (!targets.length || scrolledKey === key) return;
  scrolledKey = key;
  const r = targets[0].getBoundingClientRect();
  // A small part low on the screen is brought up too, so the bottom-left notices don't cover it.
  const low = r.height < window.innerHeight * 0.4 && r.bottom > window.innerHeight * 0.7;
  if (r.top < 0 || r.bottom > window.innerHeight || low) targets[0].scrollIntoView({ block: 'center', behavior: 'smooth' });
}

/** Clicking a lit-up part finishes a "click" step (after the page has handled the click). */
function noticeClick(e) {
  if (!runner?.running || runner.view().phase !== 'step') return;
  if (lit.some((el) => el.contains(e.target))) setTimeout(() => runner.clicked(), 0);
}

// ---------- the bubble ----------

function drawBubble(view, lost) {
  const key = JSON.stringify([view.phase, view.tutorial?.id, view.number, view.text, view.canNext, lost]);
  if (key === shownKey) return;
  shownKey = key;
  bubble.classList.toggle('centered', view.phase !== 'step' || !holes.length);
  bubble.replaceChildren(...bubbleBody(view, lost).filter(Boolean));
}

function bubbleBody(view, lost) {
  if (view.phase === 'finished') return finishedBody(view);
  if (view.phase === 'blocked') return blockedBody(view);
  return [
    bubbleHead(view.tutorial, `Step ${view.number} of ${view.total}`),
    view.title ? h('strong', { class: 'tutorial-title' }, view.title) : null,
    String(view.text).split('\n\n').map((p) => h('p', {}, p)),
    view.waits ? h('p', { class: 'tutorial-do' }, doLine(view)) : null,
    lost ? h('p', { class: 'tutorial-lost' }, 'I can’t see that part on the screen right now. Try scrolling, or skip this step.') : null,
    h('div', { class: 'tutorial-actions' },
      view.waits ? h('button', { class: 'link-btn', onclick: () => runner.skip() }, 'Skip this step') : null,
      view.canNext ? h('button', { class: 'btn small', onclick: () => runner.next() }, view.number === view.total ? 'Finish ✓' : 'Next →') : null),
  ].flat();
}

function doLine({ step, auto }) {
  if (step.click) return '👆 Click the glowing part.';
  return auto ? '✋ Your turn! The tutorial goes on by itself when it’s done.' : '✋ Your turn! Click Next when you’re done.';
}

function bubbleHead(tutorial, count) {
  return h('div', { class: 'tutorial-head' },
    h('span', { class: 'tutorial-icon', 'aria-hidden': 'true' }, tutorial.icon || '🎓'),
    h('span', { class: 'tutorial-name' }, tutorial.title),
    count ? h('span', { class: 'tutorial-count' }, count) : null,
    h('button', { class: 'icon-btn', title: 'Stop this tutorial', 'aria-label': 'Stop this tutorial', onclick: stopTutorial }, '×'));
}

function finishedBody({ tutorial, next }) {
  return [
    bubbleHead(tutorial),
    h('p', { class: 'tutorial-cheer' }, `🎉 You finished “${tutorial.title}”!`),
    next
      ? h('p', {}, 'Next up: ', h('strong', {}, `${next.icon} ${next.title}`), ` — ${next.about}`)
      : h('p', {}, 'That was the last one — you’ve seen the whole planner. The 🎓 menu is there whenever you want a refresher.'),
    h('div', { class: 'tutorial-actions' },
      h('button', { class: 'btn small light', onclick: stopTutorial }, next ? 'Not now' : 'Close'),
      next ? h('button', { class: 'btn small', onclick: () => startTutorial(next.id) }, `Start “${next.title}” →`) : null),
  ];
}

function blockedBody({ tutorial, reason }) {
  return [
    bubbleHead(tutorial),
    h('p', {}, reason),
    h('div', { class: 'tutorial-actions' }, h('button', { class: 'btn small', onclick: stopTutorial }, 'OK')),
  ];
}

/** Next to the lit-up parts (all of them, so an open menu isn't covered): below, above, right or left — wherever it fits. */
function placeBubble(targets) {
  if (!targets.length || bubble.classList.contains('centered')) { bubble.style.left = ''; bubble.style.top = ''; return; }
  const r = targets.map(box).reduce((a, b) => {
    const x = Math.min(a.x, b.x);
    const y = Math.min(a.y, b.y);
    return { x, y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y };
  });
  const bw = bubble.offsetWidth;
  const bh = bubble.offsetHeight;
  const { innerWidth: w, innerHeight: hgt } = window;
  const spots = [
    { left: r.x, top: r.y + r.h + GAP, fits: r.y + r.h + GAP + bh < hgt },
    { left: r.x, top: r.y - GAP - bh, fits: r.y - GAP - bh > 0 },
    { left: r.x + r.w + GAP, top: r.y, fits: r.x + r.w + GAP + bw < w },
    { left: r.x - GAP - bw, top: r.y, fits: r.x - GAP - bw > 0 },
  ];
  const spot = spots.find((s) => s.fits) ?? { left: w - bw - 20, top: hgt - bh - 20 };
  bubble.style.left = `${Math.max(12, Math.min(spot.left, w - bw - 12))}px`;
  bubble.style.top = `${Math.max(12, Math.min(spot.top, hgt - bh - 12))}px`;
}
