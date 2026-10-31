// Tutorials (the 🎓 menu): every tutorial is well formed and points at parts that exist in the page,
// they cover every page in the order a teacher learns them, and a tutorial waits for the teacher's
// clicks and typing, skips what's already done, and offers the next tutorial at the end.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  createRunner, hasNews, isNew, markDone, markSeen, mergeBoxes, nextTutorial, readProgress, targetNames, tutorialProblems,
} from '../public/js/tutorialPlan.js';
import { goTo, TUTORIALS } from '../public/js/tutorials.js';
import { TAB_INFO } from '../public/js/tabInfo.js';

const JS = join(import.meta.dirname, '..', 'public', 'js');

/** Every data-tour name the page code gives out. */
function tourNames() {
  const files = [...readdirSync(JS).map((f) => join(JS, f)), ...readdirSync(join(JS, 'views')).map((f) => join(JS, 'views', f))]
    .filter((f) => f.endsWith('.js'));
  const html = readFileSync(join(JS, '..', 'index.html'), 'utf8');
  const code = files.map((f) => readFileSync(f, 'utf8')).join('\n');
  const names = new Set([...html.matchAll(/data-tour="([\w-]+)"/g)].map((m) => m[1]));
  for (const re of [/'data-tour': '([\w-]+)'/g, /tour: '([\w-]+)'/g, /tour\('([\w-]+)'/g]) {
    for (const m of code.matchAll(re)) names.add(m[1]);
  }
  for (const t of TAB_INFO) names.add(t.menu ? `menu-${t.id}` : `tab-${t.id}`);
  return names;
}

test('every tutorial is well formed', () => {
  assert.deepEqual(tutorialProblems(TUTORIALS), []);
});

test('every part a tutorial lights up exists in the page code', () => {
  const names = tourNames();
  const missing = TUTORIALS.flatMap((t) => t.steps.flatMap((s) => targetNames(s).filter((n) => !names.has(n)).map((n) => `${t.id}: ${n}`)));
  assert.deepEqual(missing, []);
});

test('tutorials go in the order a teacher sets up a year, and cover every page', () => {
  const ids = TUTORIALS.map((t) => t.id);
  assert.equal(ids[0], 'welcome');
  const before = (a, b) => assert.ok(ids.indexOf(a) < ids.indexOf(b), `${a} comes before ${b}`);
  before('school-year', 'lesson-templates');
  before('lesson-templates', 'outcomes');
  before('outcomes', 'eval-calendar');
  before('instrument-schedule', 'eval-calendar');
  before('eval-calendar', 'lesson-schedule');
  before('lesson-schedule', 'lesson-copies');
  before('lesson-copies', 'reports');
  const visited = new Set(TUTORIALS.flatMap((t) => t.steps.flatMap(targetNames)));
  for (const tab of TAB_INFO) {
    assert.ok(visited.has(tab.menu ? `menu-${tab.id}` : `tab-${tab.id}`), `a tutorial visits ${tab.label}`);
  }
});

test('each tutorial offers the next one; the last offers none', () => {
  assert.equal(nextTutorial(TUTORIALS, 'welcome').id, TUTORIALS[1].id);
  assert.equal(nextTutorial(TUTORIALS, TUTORIALS.at(-1).id), null);
});

test('the 🎓 shows a dot until its menu is opened, and again for a new tutorial', () => {
  let progress = readProgress(null);
  assert.equal(hasNews(progress, TUTORIALS), true);
  progress = markSeen(progress, TUTORIALS);
  assert.equal(hasNews(progress, TUTORIALS), false);
  const more = [...TUTORIALS, { id: 'brand-new', title: 'New', about: 'x', steps: [{ text: 'x' }] }];
  assert.equal(hasNews(progress, more), true);
  assert.equal(isNew(progress, 'brand-new'), true);
  progress = markDone(progress, 'welcome');
  assert.deepEqual(readProgress(JSON.stringify(progress)).done, ['welcome']);
  assert.deepEqual(readProgress('not json'), { seen: [], done: [] });
});

// ---------- running a tutorial ----------

const AN_EVAL = { criteria: [{ id: 'crit_1', gradeIds: ['gr_1'] }] };

function fakePage(start = {}) {
  const ctx = { hasPlan: true, tab: 'plan', ui: {}, modal: null, counts: {}, open: {}, ...start };
  ctx.count = (c) => ctx.counts[c] ?? 0;
  ctx.isOpen = (n) => Boolean(ctx.open[n]);
  ctx.exists = () => true;
  return ctx;
}

function runnerFor(tutorials, ctx) {
  const finished = [];
  const runner = createRunner({ tutorials, context: () => ctx, onFinish: (id) => finished.push(id) });
  return { runner, finished };
}

test('"Set up your school year" walks to the page, then waits for each list to get an entry', () => {
  const ctx = fakePage();
  const { runner, finished } = runnerFor(TUTORIALS, ctx);
  runner.start('school-year');
  let view = runner.view();
  assert.deepEqual(view.step.target, ['setup-menu', 'menu-setup'], 'first: open Setup › School Year');
  assert.equal(view.canNext, false, 'must actually go there');
  ctx.tab = 'setup';
  runner.check();
  assert.equal(runner.view().step.target, 'year-card');
  runner.next();
  view = runner.view();
  assert.equal(view.step.target, 'list-schools');
  assert.equal(view.canNext, false, 'waits for a school');
  ctx.counts.schools = 1;
  runner.check();
  view = runner.view();
  assert.equal(view.step.target, 'list-schools', 'stays, so more schools can be added');
  assert.equal(view.canNext, true);
  assert.match(view.text, /1 school so far/);
  ctx.counts.schools = 3;
  runner.next();
  view = runner.view();
  assert.equal(view.step.target, 'list-grades');
  assert.match(view.text, /grade/);
  ctx.counts.grades = 2;
  runner.next();
  ctx.counts.instruments = 1;
  runner.next();
  assert.equal(runner.view().step.target, 'events-card');
  runner.next();
  assert.equal(runner.view().phase, 'finished');
  assert.deepEqual(finished, ['school-year']);
  assert.equal(runner.view().next.id, nextTutorial(TUTORIALS, 'school-year').id);
});

test('placing an eval: click days until "Done", then the tutorial goes on', () => {
  const ctx = fakePage({ tab: 'plan', state: AN_EVAL, counts: { placements: 0 } });
  const { runner } = runnerFor(TUTORIALS, ctx);
  runner.start('eval-calendar');
  runner.next();
  assert.equal(runner.view().step.target, 'eval-palette');
  ctx.ui.armedCriterionId = 'crit_1';
  runner.check();
  assert.equal(runner.view().step.target, 'calendar');
  ctx.counts.placements = 2;
  runner.check();
  assert.equal(runner.view().step.target, 'calendar', 'still clicking days');
  assert.match(runner.view().text, /Done/);
  ctx.ui.armedCriterionId = null;
  runner.check();
  assert.match(runner.view().text, /Click a bar/);
});

test('stopping placing with no days goes back to picking an eval', () => {
  const ctx = fakePage({ tab: 'plan', state: AN_EVAL, ui: { armedCriterionId: 'crit_1' } });
  const { runner } = runnerFor(TUTORIALS, ctx);
  runner.start('eval-calendar');
  runner.next();
  runner.check();
  assert.equal(runner.view().step.target, 'calendar');
  ctx.ui.armedCriterionId = null;
  runner.check();
  assert.equal(runner.view().step.target, 'eval-palette');
});

test('a teacher who already has schools can go on with Next instead of adding more', () => {
  const ctx = fakePage({ tab: 'setup', counts: { schools: 3 } });
  const { runner } = runnerFor(TUTORIALS, ctx);
  runner.start('school-year');
  runner.next();
  const view = runner.view();
  assert.equal(view.step.target, 'list-schools');
  assert.equal(view.canNext, true);
  assert.match(view.text, /3 schools so far/);
});

test('steps already done are skipped (already on the right page)', () => {
  const ctx = fakePage({ tab: 'lessons' });
  const { runner } = runnerFor(TUTORIALS, ctx);
  runner.start('lesson-templates');
  assert.equal(runner.view().step.target, 'deck-add');
  assert.equal(runner.view().number, 2);
});

test('a click step goes on when the lit-up part is clicked', () => {
  const tutorials = [{ id: 't', title: 'T', about: 'a', steps: [{ target: 'x', text: 'Click it', click: true }, { text: 'Done' }] }];
  const ctx = fakePage();
  const { runner } = runnerFor(tutorials, ctx);
  runner.start('t');
  assert.equal(runner.view().waits, true);
  runner.next();
  assert.equal(runner.view().number, 1, 'Next does nothing while waiting for the click');
  runner.clicked();
  assert.equal(runner.view().number, 2);
});

test('closing a menu a step needs goes back to the step that opens it', () => {
  const tutorials = [{
    id: 't', title: 'T', about: 'a', steps: [
      { target: 'menu', text: 'Open', until: (c) => c.isOpen('menu') },
      { target: 'item', text: 'Pick', until: (c) => c.tab === 'done', backIf: (c) => !c.isOpen('menu') },
    ],
  }];
  const ctx = fakePage();
  const { runner } = runnerFor(tutorials, ctx);
  runner.start('t');
  ctx.open.menu = true;
  runner.check();
  assert.equal(runner.view().number, 2);
  ctx.open.menu = false;
  runner.check();
  assert.equal(runner.view().number, 1);
  runner.skip();
  runner.check();
  assert.equal(runner.view().number, 2, 'skipping the opening step doesn’t bounce back to it');
});

test('a tutorial that needs an earlier one says so instead of starting', () => {
  const ctx = fakePage({ counts: { schools: 0 } });
  const { runner } = runnerFor(TUTORIALS, ctx);
  runner.start('instrument-schedule');
  const view = runner.view();
  assert.equal(view.phase, 'blocked');
  assert.match(view.reason, /Set up your school year/);
});

test('with no plan open, Welcome starts by making one', () => {
  const ctx = fakePage({ hasPlan: false, google: 'connected' });
  const { runner } = runnerFor(TUTORIALS, ctx);
  runner.start('welcome');
  assert.equal(runner.view().step.target, 'start-year');
  ctx.modal = 'Start a new school year';
  runner.check();
  assert.match(runner.view().text, /Create year/);
  ctx.hasPlan = true;
  ctx.modal = null;
  runner.check();
  assert.equal(runner.view().step.target, 'plan-button');
});

test('stopping a tutorial leaves nothing running', () => {
  const { runner } = runnerFor(TUTORIALS, fakePage());
  runner.start('welcome');
  runner.exit();
  assert.equal(runner.running, false);
  assert.equal(runner.view().phase, 'idle');
});

test('lit-up parts on top of each other stay lit (one hole around both)', () => {
  const dialog = { x: 100, y: 100, w: 300, h: 200 };
  const inside = { x: 120, y: 120, w: 50, h: 20 };
  const apart = { x: 600, y: 10, w: 40, h: 40 };
  assert.deepEqual(mergeBoxes([dialog, dialog, apart]), [dialog, apart]);
  assert.deepEqual(mergeBoxes([inside, apart, dialog]), [apart, dialog]);
  assert.deepEqual(mergeBoxes([{ x: 0, y: 0, w: 10, h: 10 }, { x: 5, y: 5, w: 10, h: 10 }]), [{ x: 0, y: 0, w: 15, h: 15 }]);
});

test('goTo uses the tab, or Setup ▾ for Setup pages', () => {
  assert.equal(goTo('reports')[0].target, 'tab-reports');
  assert.deepEqual(goTo('outcomes')[0].target, ['setup-menu', 'menu-outcomes']);
});
