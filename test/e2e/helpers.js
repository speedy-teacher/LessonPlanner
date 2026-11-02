// Helpers shared by the browser test files (newPlans.e2e.js, lookingAt.e2e.js). See README.md.
// Run in the real app at http://127.0.0.1:5178 only. Made-up data only.

import * as workspace from '/js/workspace.js';
import { flushSave, store } from '/js/store.js';
import { allPlans, deletePlan } from '/js/localCache.js';

// ---------- tiny helpers ----------

export function check(cond, message) {
  if (!cond) throw new Error(message);
}

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Wait until `fn()` is truthy (returns its value); fail with `what` after `ms`. */
export async function waitFor(fn, ms = 6000, what = 'something to happen') {
  const end = Date.now() + ms;
  for (;;) {
    const value = await fn();
    if (value) return value;
    if (Date.now() > end) throw new Error(`Timed out waiting for ${what}`);
    await sleep(40);
  }
}

export function guardHost() {
  if (location.hostname !== '127.0.0.1') {
    throw new Error(`Refusing to run at ${location.hostname}: use http://127.0.0.1:5178 (it has no real plans and can't reach Google Drive).`);
  }
}

export const text = (el) => el.textContent.replace(/\s+/g, ' ').trim();
export const modal = () => document.querySelector('#modal.show');
export const scope = () => modal() ?? document;

/** An element by CSS selector, or (any other string) the button/link/label whose words match. */
export function find(target, root = scope()) {
  if (/^[[.#]/.test(target)) return root.querySelector(target);
  const items = [...root.querySelectorAll('button, a, label, summary, [role="tab"]')];
  return items.find((el) => text(el) === target) ?? items.find((el) => text(el).includes(target));
}

export async function click(target) {
  const el = await waitFor(() => find(target), 6000, `"${target}" to appear`);
  el.click();
  await sleep(30);
}

/** Fill the field whose label reads `label` (inside the open window, else the page). */
export async function fill(label, value) {
  const field = await waitFor(() => [...scope().querySelectorAll('label.field')].find((l) => text(l.querySelector('span')) === label), 4000, `field "${label}"`);
  const input = field.querySelector('input');
  input.value = value;
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
}

export function tick(box, on) {
  if (box.checked !== on) box.click();
}

/** Give a file input a file with `json` as its words, as if chosen. */
export function chooseFile(input, json, name = 'plan.json') {
  const data = new DataTransfer();
  data.items.add(new File([typeof json === 'string' ? json : JSON.stringify(json)], name, { type: 'application/json' }));
  input.files = data.files;
  input.dispatchEvent(new Event('change', { bubbles: true }));
}

export async function openPlansMenu() {
  await click('[data-tour="plan-button"]');
  await waitFor(modal, 4000, 'the plans menu');
}

/** Start a new school year through the buttons (the welcome screen, or the plans menu). */
export async function startNewYear({ name, start, end, copy, weeks }) {
  if (!modal() && find('[data-tour="plan-button"]')) await openPlansMenu();
  await click('[data-tour="start-year"]');
  await waitFor(() => modal()?.querySelector('[aria-label="Start a new school year"]') ?? modal(), 4000, 'the new-year window');
  await fill('Name', name);
  await fill('First day', start);
  await fill('Last day', end);
  const box = [...modal().querySelectorAll('label.check input[type="checkbox"]')].find((b) => text(b.parentElement).startsWith('Copy schools'));
  if (box && copy !== undefined) tick(box, copy);
  const weeksBox = modal().querySelector('[data-tour="new-year-weeks"]');
  if (weeksBox && weeks !== undefined) tick(weeksBox, weeks);
  await click('Create year');
  await waitFor(() => !modal() && yearOpen(name), 10000, `the year "${name}" to open`);
  await flushSave();
}

export function yearOpen(name) {
  const state = store.state;
  return state && workspace.pieces && state.years.find((y) => y.id === state.activeYearId)?.name === name;
}

/** Run assistant commands (the real data-changing path); fail the case if any is refused. */
export function commands(steps) {
  const results = window.lessonPlanner.run(steps);
  const bad = [].concat(results).find((r) => r?.error);
  check(!bad, `command refused: ${bad?.error}`);
  return results;
}

export async function saved() {
  await flushSave();
  await sleep(50);
  return allPlans();
}

/** Watch for errors while a case runs. */
export function watchErrors() {
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
