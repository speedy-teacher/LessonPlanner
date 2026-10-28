// This computer's copy of each plan, kept in the browser (IndexedDB), so the
// planner opens instantly, works without internet, and never loses a change
// that hasn't reached Google Drive yet.
//
// Record: { key, name, fileId, state, rev, changed, keptDay, canEdit }
//   rev     = the Drive revision this copy matches (null for plans on this computer only)
//   changed = has changes Google Drive doesn't have yet

const DB_NAME = 'lesson-planner';
const STORE = 'plans';
const RESCUE_KEY = 'lesson-planner-rescue';

let dbPromise = null;
function db() {
  dbPromise ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'key' });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

async function run(mode, action) {
  const store = (await db()).transaction(STORE, mode).objectStore(STORE);
  return new Promise((resolve, reject) => {
    const req = action(store);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function getPlan(key) {
  const saved = await run('readonly', (s) => s.get(key));
  return newest(saved, takeRescue(key));
}

export function putPlan(record) {
  return run('readwrite', (s) => s.put(record));
}

export function deletePlan(key) {
  return run('readwrite', (s) => s.delete(key));
}

export function allPlans() {
  return run('readonly', (s) => s.getAll());
}

// If the page closes before the browser finishes saving, a quick copy is kept here instead.

/** Keep a copy right now (used while the page is closing). */
export function rescue(record) {
  try { localStorage.setItem(RESCUE_KEY, JSON.stringify({ ...record, rescuedAt: Date.now() })); } catch { /* too big or unavailable */ }
}

function takeRescue(key) {
  try {
    const saved = JSON.parse(localStorage.getItem(RESCUE_KEY));
    if (saved?.key !== key) return null;
    localStorage.removeItem(RESCUE_KEY);
    return saved;
  } catch { return null; }
}

function newest(saved, rescued) {
  if (!rescued) return saved;
  if (!saved || (rescued.rescuedAt || 0) > (saved.savedAt || 0)) {
    const { rescuedAt: _r, ...record } = rescued;
    return record;
  }
  return saved;
}
