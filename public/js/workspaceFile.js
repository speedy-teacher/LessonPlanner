// Plan files ("workspaces"): one school year's plans in one file, so a year
// can be kept in Google Drive, shared, or downloaded as a single file.
//
// A plan file is the usual planner data holding exactly one year, plus a
// `kind` marker so the planner can tell its files apart from other JSON.
// The Google codes older planner files kept inside them are left out — the
// website has them built in (see deviceSettings.js).
//
// Pure logic, shared by the browser app and the Node tests.

import { COLLECTIONS, createYear, emptyState, normalize } from './model.js';

export const WORKSPACE_KIND = 'lesson-planner-workspace';
export const WORKSPACE_MIME = 'application/json';
/** Extra label on Drive files, so the planner can find its own plan files. */
export const WORKSPACE_PROPERTY = { key: 'lessonPlanner', value: 'workspace' };
/** Settings older planner files kept that never go into a plan file. */
export const DEVICE_SETTINGS = ['googleClientId', 'googleApiKey'];

// Collections without a yearId belong to the year of the record they hang off.
const PARENTS = { criteria: ['outcomeId', 'outcomes'], criterionLessons: ['criterionId', 'criteria'] };

/** Only the given year (and everything that belongs to it), as its own planner data. */
export function yearOnly(state, yearId) {
  const out = emptyState();
  out.settings = withoutDeviceSettings(state.settings);
  const kept = {};
  for (const name of Object.keys(COLLECTIONS)) {
    out[name] = structuredClone(state[name].filter(belongsTo(name, yearId, kept)));
    kept[name] = new Set(out[name].map((r) => r.id));
  }
  out.activeYearId = yearId;
  return out;
}

function belongsTo(name, yearId, kept) {
  if (name === 'years') return (r) => r.id === yearId;
  if (PARENTS[name]) {
    const [field, parent] = PARENTS[name];
    return (r) => kept[parent].has(r[field]);
  }
  if (COLLECTIONS[name].includes('yearId')) return (r) => r.yearId === yearId;
  return () => true; // shared across years (e.g. computer folders)
}

/** Planner data with several years → one plan per year: [{ name, state }]. */
export function splitYears(state) {
  return state.years.map((y) => ({ name: planName(y), state: yearOnly(state, y.id) }));
}

/** The file name a year's plan gets, e.g. "Music Plans 2026–27". */
export function planName(year) {
  return `Music Plans ${year?.name || ''}`.trim();
}

/**
 * The plan for a new school year. With `copy`, instruments, schools, grades, lesson decks and
 * outcomes (with evals and lesson order) come along from `state`'s year; calendars start empty.
 */
export function newYearPlan(state, fields, { copy = true } = {}) {
  const base = copy && state ? structuredClone(state) : emptyState();
  const fromId = copy && state ? state.activeYearId : null;
  const year = createYear(base, fields, fromId);
  return { name: planName(year), state: yearOnly(base, year.id) };
}

/** The text saved in a plan file. */
export function toWorkspaceFile(state) {
  const { settings, ...rest } = state;
  return JSON.stringify({ kind: WORKSPACE_KIND, ...rest, settings: withoutDeviceSettings(settings) });
}

/** Read a plan file (or an older whole-planner file). Throws Error('not_a_plan') for other files. */
export function fromWorkspaceFile(text) {
  let raw;
  try { raw = JSON.parse(text); } catch { throw new Error('not_a_plan'); }
  if (!looksLikePlannerData(raw)) throw new Error('not_a_plan');
  const { kind: _kind, ...state } = raw;
  return normalize(state);
}

export function looksLikePlannerData(raw) {
  return Boolean(raw) && typeof raw === 'object' && !Array.isArray(raw)
    && Number.isInteger(raw.schemaVersion) && Array.isArray(raw.years);
}

function withoutDeviceSettings(settings = {}) {
  const out = { ...settings };
  for (const key of DEVICE_SETTINGS) delete out[key];
  return out;
}

// ---------- recent plans ----------

const RECENT_LIMIT = 12;

/** Put a plan at the top of the recent list (one entry per plan). */
export function rememberPlan(list, entry, now = new Date().toISOString()) {
  const others = (list || []).filter((p) => p.key !== entry.key);
  return [{ ...entry, openedAt: now }, ...others].slice(0, RECENT_LIMIT);
}

export function forgetPlan(list, key) {
  return (list || []).filter((p) => p.key !== key);
}

// ---------- keeping this computer and Google Drive in step ----------

/**
 * What to do when the plan is compared with its Drive file:
 *   'none'     both the same
 *   'upload'   only this computer has changes → save them to Drive
 *   'download' only Drive has changes (made on another computer) → load them
 *   'conflict' both changed → ask which to keep
 * `knownRev` = the Drive revision this computer last loaded or saved.
 */
export function syncAction({ localChanges, knownRev, remoteRev }) {
  const remoteChanged = Boolean(remoteRev) && remoteRev !== knownRev;
  if (remoteChanged) return localChanges ? 'conflict' : 'download';
  return localChanges ? 'upload' : 'none';
}

/** Drive keeps one version of each day forever, so any day can be gone back to. */
export function shouldKeepRevision(lastKeptDay, today = new Date().toISOString().slice(0, 10)) {
  return lastKeptDay !== today;
}
