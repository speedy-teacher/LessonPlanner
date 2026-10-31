// End-to-end browser tests: "new plans are born as pieces" (docs/plans/new-plans-as-pieces-e2e.md).
// Run in the real app, in the Browser pane, at http://127.0.0.1:5178 (never localhost). See README.md.
//
//   const t = await import('/e2e/newPlans.e2e.js'); await t.reset();      // then reload the page
//   const t = await import('/e2e/newPlans.e2e.js'); await t.run({ only: 'E1' });
//
// Made-up data only. Every case starts on a fresh computer (reset + reload).

import * as workspace from '/js/workspace.js';
import { flushSave, setUi, store } from '/js/store.js';
import { allPlans, deletePlan, getPlan } from '/js/localCache.js';
import { isNoticeShown } from '/js/notices.js';
import { offerSharing } from '/js/views/shareSetup.js';
import { emptyState, createYear, add } from '/js/model.js';
import { seedState } from '/js/seed.js';
import { toWorkspaceFile } from '/js/workspaceFile.js';

const YEAR1 = { name: 'Test Year 2030–31', start: '2030-08-26', end: '2031-06-13' };
const YEAR2 = { name: 'Test Year 2031–32', start: '2031-08-25', end: '2032-06-11' };

// ---------- tiny helpers ----------

function check(cond, message) {
  if (!cond) throw new Error(message);
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Wait until `fn()` is truthy (returns its value); fail with `what` after `ms`. */
async function waitFor(fn, ms = 6000, what = 'something to happen') {
  const end = Date.now() + ms;
  for (;;) {
    const value = await fn();
    if (value) return value;
    if (Date.now() > end) throw new Error(`Timed out waiting for ${what}`);
    await sleep(40);
  }
}

function guardHost() {
  if (location.hostname !== '127.0.0.1') {
    throw new Error(`Refusing to run at ${location.hostname}: use http://127.0.0.1:5178 (it has no real plans and can't reach Google Drive).`);
  }
}

const text = (el) => el.textContent.replace(/\s+/g, ' ').trim();
const modal = () => document.querySelector('#modal.show');
const scope = () => modal() ?? document;

/** An element by CSS selector, or (any other string) the button/link/label whose words match. */
function find(target, root = scope()) {
  if (/^[[.#]/.test(target)) return root.querySelector(target);
  const items = [...root.querySelectorAll('button, a, label, summary, [role="tab"]')];
  return items.find((el) => text(el) === target) ?? items.find((el) => text(el).includes(target));
}

async function click(target) {
  const el = await waitFor(() => find(target), 6000, `"${target}" to appear`);
  el.click();
  await sleep(30);
}

/** Fill the field whose label reads `label` (inside the open window, else the page). */
async function fill(label, value) {
  const field = await waitFor(() => [...scope().querySelectorAll('label.field')].find((l) => text(l.querySelector('span')) === label), 4000, `field "${label}"`);
  const input = field.querySelector('input');
  input.value = value;
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
}

function tick(box, on) {
  if (box.checked !== on) box.click();
}

/** Give a file input a file with `json` as its words, as if chosen. */
function chooseFile(input, json, name = 'plan.json') {
  const data = new DataTransfer();
  data.items.add(new File([typeof json === 'string' ? json : JSON.stringify(json)], name, { type: 'application/json' }));
  input.files = data.files;
  input.dispatchEvent(new Event('change', { bubbles: true }));
}

async function openPlansMenu() {
  await click('[data-tour="plan-button"]');
  await waitFor(modal, 4000, 'the plans menu');
}

/** Start a new school year through the buttons (the welcome screen, or the plans menu). */
async function startNewYear({ name, start, end, copy }) {
  if (!modal() && find('[data-tour="plan-button"]')) await openPlansMenu();
  await click('[data-tour="start-year"]');
  await waitFor(() => modal()?.querySelector('[aria-label="Start a new school year"]') ?? modal(), 4000, 'the new-year window');
  await fill('Name', name);
  await fill('First day', start);
  await fill('Last day', end);
  const box = [...modal().querySelectorAll('label.check input[type="checkbox"]')].find((b) => text(b.parentElement).startsWith('Copy schools'));
  if (box && copy !== undefined) tick(box, copy);
  await click('Create year');
  await waitFor(() => !modal() && yearOpen(name), 10000, `the year "${name}" to open`);
  await flushSave();
}

function yearOpen(name) {
  const state = store.state;
  return state && workspace.pieces && state.years.find((y) => y.id === state.activeYearId)?.name === name;
}

/** Run assistant commands (the real data-changing path); fail the case if any is refused. */
function commands(steps) {
  const results = window.lessonPlanner.run(steps);
  const bad = [].concat(results).find((r) => r?.error);
  check(!bad, `command refused: ${bad?.error}`);
  return results;
}

async function saved() {
  await flushSave();
  await sleep(50);
  return allPlans();
}

const counts = (s) => [s.schools.length, s.lessons.length, s.weekLessons.length].join();
const ofPiece = (records, piece) => records.filter((r) => r.piece === piece);
const only = (records, piece) => {
  const found = ofPiece(records, piece);
  check(found.length === 1, `expected exactly one ${piece} record, found ${found.length}`);
  return found[0];
};

// ---------- scenario builders ----------

async function firstYear() {
  check(find('[data-tour="start-year"]'), 'the welcome screen should be showing');
  await startNewYear({ ...YEAR1 });
}

/** E2's content: a school, grade, template, outcome + eval with the lesson, and one schedule entry. */
function addPlanContent() {
  commands([
    { command: 'addSetupItem', args: { list: 'schools', name: 'Maple School' } },
    { command: 'addSetupItem', args: { list: 'grades', name: 'Grade 3', short: '3', color: '#6b8f5e' } },
    { command: 'addLesson', args: { name: 'Steady Beat Game', category: 'Rhythm' } },
    { command: 'addOutcome', args: { title: 'Keep a steady beat', code: 'MU1' } },
    { command: 'addEval', args: { outcome: 'MU1', title: 'Claps a steady beat', grades: ['Grade 3'], lessons: ['Steady Beat Game'] } },
    { command: 'addLessonToWeek', args: { school: 'Maple School', grade: 'Grade 3', week: 1, lesson: 'Steady Beat Game' } },
    { command: 'placeEval', args: { school: 'Maple School', grade: 'Grade 3', eval: 'Claps a steady beat', startDate: '2030-09-09', endDate: '2030-09-13' } },
  ]);
}

async function planWithContent() {
  await firstYear();
  addPlanContent();
  return saved();
}

/** An older-format planner file with two years, a template carried over, and one only in year 1. */
function twoYearFile() {
  const state = emptyState();
  const y1 = createYear(state, { name: 'Test Year 2030–31', startDate: YEAR1.start, endDate: YEAR1.end });
  add(state, 'schools', { yearId: y1.id, name: 'Maple School' });
  add(state, 'lessons', { yearId: y1.id, name: 'Carried Over Lesson', category: '', autoFields: [], instrumentIds: [], folderId: null });
  createYear(state, { name: 'Test Year 2031–32', startDate: YEAR2.start, endDate: YEAR2.end }, y1.id);
  add(state, 'lessons', { yearId: y1.id, name: 'Only In Year One', category: '', autoFields: [], instrumentIds: [], folderId: null });
  state.activeYearId = state.years[1].id;
  return state;
}

// ---------- the cases ----------

const CASES = {
  async E1() {
    await firstYear();
    const records = await saved();
    check(workspace.pieces, 'the plan should be in pieces');
    check(workspace.current.kind === 'pieces', `current.kind should be 'pieces', was ${workspace.current.kind}`);
    const [year, schedule, resources] = ['schoolYear', 'schedule', 'resources'].map((p) => only(records, p));
    check(records.length === 3, `expected 3 records, found ${records.length}`);
    check(records.every((r) => !r.fileId && !('state' in r)), 'no record should have a fileId or be an older one-file plan');
    const links = schedule.data.meta.links;
    check(links.schoolYear.key === year.key && links.resources.key === resources.key, 'the schedule should link to the other two records');
    offerSharing();
    check(!isNoticeShown('share-offer'), 'no "share-offer" notice should show');
    await openPlansMenu();
    check(!find('Share with your department'), 'no "Share with your department…" button should be offered');
  },

  async E2a() {
    const records = await planWithContent();
    const year = only(records, 'schoolYear').data;
    check(year.schools.some((s) => s.name === 'Maple School') && year.grades.some((g) => g.name === 'Grade 3'), 'school and grade belong in the School Year');
    check(year.outcomes.some((o) => o.code === 'MU1') && year.criteria.length === 1, 'outcome and eval belong in the School Year');
    check(only(records, 'resources').data.lessons.some((l) => l.name === 'Steady Beat Game'), 'the template belongs in Teacher Resources');
    const schedule = only(records, 'schedule').data;
    check(schedule.weekLessons.length === 1 && schedule.criterionLessons.length === 1, 'the week entry and lesson order belong in the Schedule');
    check(!year.weekLessons?.length && !year.lessons?.length, 'the School Year must not hold schedule entries or templates');
  },

  async E2b() {
    const records = await allPlans();
    check(records.length === 3, `the three records should still be here after the reload, found ${records.length}`);
    await waitFor(() => workspace.pieces && store.state, 8000, 'the plan to open after the reload');
    const s = store.state;
    check(workspace.current.name && s.years[0].name === YEAR1.name, 'the same year should open');
    check(s.schools.some((x) => x.name === 'Maple School') && s.grades.length === 1, 'school and grade come back');
    check(s.lessons.some((x) => x.name === 'Steady Beat Game') && s.outcomes.length === 1 && s.criteria.length === 1, 'template, outcome and eval come back');
    check(s.weekLessons.length === 1 && s.criterionLessons.length === 1, 'schedule entry and lesson order come back');
  },

  async E3() {
    const before = await planWithContent();
    const lessonId = only(before, 'resources').data.lessons[0].id;
    const evalIds = only(before, 'schoolYear').data.criteria.map((c) => c.id);
    const yearOneId = store.state.activeYearId;
    commands([{ command: 'editSetupItem', args: { list: 'grades', item: 'Grade 3', color: '#aa5533' } }]);
    await startNewYear({ ...YEAR2, copy: true });
    const records = await saved();
    check(ofPiece(records, 'schoolYear').length === 2 && ofPiece(records, 'schedule').length === 2, 'expected 2 School Years and 2 Schedules');
    const resources = only(records, 'resources');
    const mine = records.find((r) => r.key === workspace.current.key);
    check(mine.data.meta.links.resources.key === resources.key, 'the new Schedule should link to the one Teacher Resources');
    const s = store.state;
    check(s.schools.length === 1 && s.grades.length === 1 && s.outcomes.length === 1, 'schools, grades and outcomes were copied');
    check(s.criteria.map((c) => c.id).join() === evalIds.join(), 'the eval keeps its id');
    check(s.criterionLessons.length === 1 && s.criterionLessons[0].lessonId === lessonId, 'the lesson order uses the same lesson id');
    check(s.lessons.length === 1 && resources.data.lessons.length === 1, 'the template is still the one in Resources');
    check(s.weekLessons.length === 0 && s.placements.length === 0, 'no schedule entries or calendar placements carry over');
    check(s.grades[0].color === '#aa5533', `the grade color should be kept, was ${s.grades[0].color}`);
    await switchTo(YEAR1.name);
    check(store.state.activeYearId === yearOneId && store.state.weekLessons.length === 1, 'year one still has its week entry');
  },

  async E4() {
    await planWithContent();
    await startNewYear({ ...YEAR2, copy: false });
    const records = await saved();
    const s = store.state;
    check(s.schools.length === 0 && s.outcomes.length === 0 && s.criteria.length === 0, 'the School Year starts empty');
    check(s.criterionLessons.length === 0, 'the lesson order starts empty');
    check(s.lessons.some((l) => l.name === 'Steady Beat Game'), 'the template is still listed');
    check(ofPiece(records, 'resources').length === 1, 'still exactly one Teacher Resources');
    setUi({ tab: 'lessons' });
    await waitFor(() => text(document.querySelector('main')).includes('Steady Beat Game'), 4000, 'the Lesson Templates page to list the template');
  },

  async E5() {
    const file = twoYearFile();
    await openPlansMenu().catch(() => {});
    await importFile(file);
    const records = await saved();
    check(ofPiece(records, 'schoolYear').length === 2 && ofPiece(records, 'schedule').length === 2, 'expected 2 School Years and 2 Schedules');
    const names = only(records, 'resources').data.lessons.map((l) => l.name).sort();
    check(names.join('|') === 'Carried Over Lesson|Only In Year One', `Resources should hold each template once, has: ${names.join('|')}`);
    check(yearOpen(YEAR2.name), 'the year that was open in the file should be open, in pieces');
    check(!isNoticeShown('share-offer'), 'no share-offer notice');
  },

  // E6a makes the plan and keeps its download text in window.name (which survives the reset and reload).
  async E6a() {
    await planWithContent();
    window.name = JSON.stringify({ copy: toWorkspaceFile(workspace.myPlanState()), counts: counts(store.state) });
  },

  async E6b() {
    const { copy, counts: original } = JSON.parse(window.name);
    check(copy.includes('"lesson-planner-workspace"'), 'the downloaded copy is a plan file');
    await importFile(copy);
    const records = await saved();
    check(workspace.pieces && ofPiece(records, 'schedule').length === 1 && ofPiece(records, 'resources').length === 1, 'the copy should open as a plan in pieces');
    check(counts(store.state) === original, `counts differ: ${counts(store.state)} vs ${original}`);
    window.name = '';
  },

  async E7() {
    const state = seedState();
    await workspace.createPlan({ name: 'Old Style Plan', state }, { open: true });
    await waitFor(() => store.state, 4000, 'the plan');
    check(workspace.pieces === null, 'an older plan is not in pieces');
    commands([{ command: 'addSetupItem', args: { list: 'schools', name: 'Elm School' } }]);
    await flushSave();
    const rec = await getPlan(workspace.current.key);
    check(rec.state?.schools.some((x) => x.name === 'Elm School'), 'the edit should be saved in the old record (its state)');
    await openPlansMenu();
    check(find('Share with your department'), 'the menu should offer "Share with your department…"');
    await click('Share with your department');
    await click('Start a new shared School Year');
    await waitFor(() => workspace.pieces, 10000, 'the plan to move to pieces');
    const records = await saved();
    check(['schoolYear', 'schedule', 'resources'].every((p) => ofPiece(records, p).length === 1), 'three piece records');
    const old = records.find((r) => r.state);
    check(old && old.name === `Old Style Plan${workspace.OLD_PLAN_SUFFIX}`, `the old record should be kept and renamed, found ${old?.name}`);
  },

  async E8() {
    await planWithContent();
    await startNewYear({ ...YEAR2, copy: true });
    await workspace.createPlan({ name: 'Old Style Plan', state: seedState() }, { open: false });
    await openPlansMenu();
    const rows = await waitFor(() => {
      const box = [...modal().querySelectorAll('.plans-section')].find((b) => text(b).includes('On this computer only'));
      return box && [...box.querySelectorAll('.plan-row')].map((r) => text(r));
    }, 4000, 'the list of plans on this computer');
    check(rows.length === 3, `expected 3 plans listed, found ${rows.length}: ${rows.join(' / ')}`);
    check(rows.every((r) => r.startsWith('Lesson Schedule') || r.startsWith('Old Style Plan')), `something other than a plan is listed: ${rows.join(' / ')}`);
    check(rows.filter((r) => r.startsWith('Lesson Schedule')).length === 2 && rows.some((r) => r.includes('Old Style Plan')), `expected two schedules and the older plan: ${rows.join(' / ')}`);
  },

  async E9() {
    const before = await planWithContent();
    const yearOne = only(before, 'schoolYear').key;
    await startNewYear({ ...YEAR2, copy: true });
    const yearTwoSchedule = workspace.current.key;
    await switchTo(YEAR1.name);
    await openPlansMenu();
    await click(`[aria-label="Remove Lesson Schedule ${YEAR2.name}"]`);
    await click('Remove');
    await waitFor(async () => !(await getPlan(yearTwoSchedule)), 4000, 'the schedule to be removed');
    const records = await saved();
    check(ofPiece(records, 'schoolYear').length === 1 && ofPiece(records, 'schedule').length === 1, 'one School Year and one Schedule remain');
    check(ofPiece(records, 'schoolYear')[0].key === yearOne && ofPiece(records, 'resources').length === 1, 'the other year and the Resources remain');
    check(workspace.pieces && store.state.weekLessons.length === 1, 'the other year still has its data');
  },

  async E10() {
    await firstYear();
    await openPlansMenu();
    check(!find('Share the School Year in Drive'), 'no "Share the School Year in Drive" link');
    check(!find('Use a colleague'), 'no "Use a colleague’s School Year…" button');
    check(!find('Save to Google Drive'), 'no "Save to Google Drive" button without Drive');
    await click('[data-tour="start-year"]');
    await waitFor(modal, 3000, 'the new-year window');
    check(!find('Use one a colleague already made'), 'no colleague choice in the new-year window');
  },
};

// ---------- the pieces of E3/E5/E6/E9 that need the page ----------

/** Switch to another year's plan through the plans menu. */
async function switchTo(yearName) {
  await openPlansMenu();
  const rows = [...modal().querySelectorAll('.plan-open')];
  const row = rows.find((r) => text(r).includes(yearName));
  check(row, `no plan named for ${yearName}`);
  row.click();
  await waitFor(() => !modal() && yearOpen(yearName), 8000, `${yearName} to open`);
}

async function importFile(json) {
  if (!modal()) {
    if (find('[data-tour="plan-button"]')) await openPlansMenu();
  }
  const input = await waitFor(() => find('Open a plan file from this computer', document)?.querySelector('input[type="file"]'), 4000, 'the file chooser');
  chooseFile(input, json);
  await waitFor(() => workspace.pieces && store.state, 10000, 'the imported plan to open');
}

// ---------- running ----------

/** Watch for errors while a case runs. */
function watchErrors() {
  const errors = [];
  const onError = (e) => errors.push(`error: ${e.message}`);
  const onReject = (e) => errors.push(`unhandled rejection: ${e.reason?.message ?? e.reason}`);
  const original = console.error;
  console.error = (...args) => { errors.push(`console.error: ${args.map(String).join(' ')}`); original.apply(console, args); };
  window.addEventListener('error', onError);
  window.addEventListener('unhandledrejection', onReject);
  return () => {
    window.removeEventListener('error', onError);
    window.removeEventListener('unhandledrejection', onReject);
    console.error = original;
    return errors;
  };
}

async function runCase(name) {
  const stop = watchErrors();
  let error = null;
  try {
    await CASES[name]();
  } catch (err) {
    error = err?.message ?? String(err);
  }
  await sleep(150);
  const problems = stop();
  if (!error && problems.length) error = `errors while running: ${problems.join('; ')}`;
  return { name, ok: !error, error };
}

/** The cache is empty and nothing is open: a fresh computer. */
async function requireFresh(name) {
  if (name === 'E2b') return;  // continues E2a after a reload
  const records = await allPlans();
  check(records.length === 0 && !workspace.current, 'This is not a fresh computer: call reset(), reload the page, then run one case.');
}

/** Run cases: `only` = 'E1', or a list. Always run one case per page load (see README.md). */
export async function run({ only: wanted } = {}) {
  guardHost();
  const names = wanted ? [].concat(wanted) : Object.keys(CASES);
  const results = [];
  for (const name of names) {
    check(CASES[name], `No case named ${name}`);
    try { await requireFresh(name); } catch (err) { results.push({ name, ok: false, error: err.message }); continue; }
    results.push(await runCase(name));
  }
  const passed = results.filter((r) => r.ok).length;
  return { passed, failed: results.length - passed, results };
}

/** Make this a fresh computer: forget every cached plan and setting. Then reload the page. */
export async function reset() {
  guardHost();
  await flushSave();
  for (const rec of await allPlans()) await deletePlan(rec.key);
  for (const { name } of (await indexedDB.databases?.()) ?? []) indexedDB.deleteDatabase(name); // finishes when the page closes its copy
  localStorage.clear();
  sessionStorage.clear();
  // The app keeps a quick copy of unsaved work as the page closes; clear that too, after it has run.
  window.addEventListener('pagehide', () => { localStorage.clear(); });
  return 'Fresh. Reload the page now.';
}
