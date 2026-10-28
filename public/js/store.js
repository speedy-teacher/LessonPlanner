// Holds the planner data, saves it automatically, and remembers past
// versions so any change can be undone.

import { normalize } from './model.js';
import { seedState } from './seed.js';

const SAVE_DELAY_MS = 400;
const UNDO_LIMIT = 100;
const UI_KEY = 'lesson-planner-ui';

export const store = {
  state: null,
  ui: loadUi(),
  undoStack: [],
  redoStack: [],
  listeners: new Set(),
  saveStatus: 'saved',
};

let saveTimer = null;
let dirty = false;

export async function loadData() {
  const res = await fetch('/api/state');
  if (!res.ok) throw new Error('Could not load your planner data.');
  const { state } = await res.json();
  store.state = normalize(state || seedState());
  if (!state) queueSave();
  notify();
}

/** Change the data: `mutate(state)` edits it in place; the change is saved and can be undone. */
export function commit(mutate) {
  const before = JSON.stringify(store.state);
  const result = mutate(store.state);
  if (JSON.stringify(store.state) === before) return result;
  store.undoStack.push(before);
  if (store.undoStack.length > UNDO_LIMIT) store.undoStack.shift();
  store.redoStack = [];
  queueSave();
  notify();
  return result;
}

export function undo() {
  travel(store.undoStack, store.redoStack);
}

export function redo() {
  travel(store.redoStack, store.undoStack);
}

function travel(from, to) {
  if (!from.length) return;
  to.push(JSON.stringify(store.state));
  store.state = normalize(JSON.parse(from.pop()));
  queueSave();
  notify();
}

/** Remember view choices (tab, month, school, grade…) on this computer. */
export function setUi(patch) {
  Object.assign(store.ui, patch);
  try { localStorage.setItem(UI_KEY, JSON.stringify(store.ui)); } catch { /* storage unavailable */ }
  notify();
}

function loadUi() {
  try { return JSON.parse(localStorage.getItem(UI_KEY)) || {}; } catch { return {}; }
}

export function subscribe(fn) {
  store.listeners.add(fn);
}

/** Redraw the page without changing any data (e.g. after a Google sign-in). */
export function refresh() {
  notify();
}

function notify() {
  store.listeners.forEach((fn) => fn());
}

// ---------- autosave ----------

function queueSave() {
  dirty = true;
  setSaveStatus('saving');
  clearTimeout(saveTimer);
  saveTimer = setTimeout(save, SAVE_DELAY_MS);
}

async function save() {
  dirty = false;
  try {
    const res = await fetch('/api/state', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(store.state),
    });
    if (!res.ok) throw new Error(`Save failed (${res.status})`);
    if (!dirty) setSaveStatus('saved');
  } catch {
    dirty = true;
    setSaveStatus('error');
    clearTimeout(saveTimer);
    saveTimer = setTimeout(save, 3000);
  }
}

function setSaveStatus(status) {
  store.saveStatus = status;
  const el = document.getElementById('save-status');
  if (!el) return;
  const text = { saving: 'Saving…', saved: 'All changes saved', error: 'Can’t reach the planner — retrying…' };
  el.textContent = text[status];
  el.dataset.status = status;
}

// Save immediately if the page is closed with unsaved changes.
window.addEventListener('pagehide', () => {
  if (!dirty || !store.state) return;
  navigator.sendBeacon('/api/state', new Blob([JSON.stringify(store.state)], { type: 'application/json' }));
});
