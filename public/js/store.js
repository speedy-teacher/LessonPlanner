// Holds the open plan's data, saves it automatically, and remembers past
// versions so any change can be undone. Where it's saved (this computer and
// Google Drive) is up to workspace.js, which hands in `persist`.

import { normalize } from './model.js';

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
  // When the data was last changed here (a change, undo or redo) — not when a plan was opened or loaded.
  editedAt: 0,
};

let saveTimer = null;
let dirty = false;
let persister = { save: async () => {}, closing: () => {} };

/** `save(state)` keeps the data (may throw to retry later); `closing(state)` runs if the page closes unsaved. */
export function setPersist(next) {
  persister = next;
}

/** Show a plan (a different one starts with a fresh undo history). */
export function useState(state, { sameDocument = false } = {}) {
  clearTimeout(saveTimer);
  dirty = false;
  store.state = normalize(state);
  if (!sameDocument) {
    store.undoStack = [];
    store.redoStack = [];
  }
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
  store.editedAt = Date.now();
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
  store.editedAt = Date.now();
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
    await persister.save(store.state);
  } catch {
    dirty = true;
    setSaveStatus('error');
    clearTimeout(saveTimer);
    saveTimer = setTimeout(save, 3000);
  }
}

const STATUS_TEXT = {
  saving: 'Saving…',
  saved: 'All changes saved',
  local: 'Saved on this computer',
  error: 'Couldn’t save — retrying…',
};

/** The words next to undo/redo. `text` overrides the usual words for `status`. */
export function setSaveStatus(status, text = STATUS_TEXT[status]) {
  store.saveStatus = status;
  const el = document.getElementById('save-status');
  if (!el) return;
  el.textContent = text;
  el.dataset.status = status;
}

/** Changes are waiting for the short save delay. */
export function hasPendingSave() {
  return dirty;
}

// Keep a quick copy if the page is closed with unsaved changes.
window.addEventListener('pagehide', () => {
  if (dirty && store.state) persister.closing(store.state);
});
