// Combining two computers' changes to the same plan file (a "three-way merge").
//
// Both computers started from the same version of the plan (`base`: the version this computer last
// saved to or loaded from Google Drive). Every record (lesson, eval, calendar bar, schedule entry…)
// has its own id, so each change can be traced to one side:
//   - changed on one side only            → that change is kept
//   - changed the same way on both         → kept
//   - changed differently on both          → a conflict: this computer's version is kept for now,
//     and the teacher can switch to the other computer's with one click (useTheirs)
//   - deleted on one side, changed on the other → also a conflict, same rule
// Lists of ids (an eval's grades, a picture's tags…) are combined item by item, so both sides'
// additions stay; a file's locations are combined by address. Afterwards, links to records that are
// gone are tidied up the way deleting them would, and teaching orders are renumbered.
//
// Pure logic, shared by the browser app and the Node tests.

import { COLLECTIONS, RELATIONS, remove } from './model.js';

/** Fields where the newest value simply wins (when a file was last seen or changed). */
const NEWEST = new Set(['lastSeenAt', 'modifiedTime']);
/** Fields never worth asking about: list positions (renumbered afterwards) and the "new" badge. */
const QUIET = new Set(['position', 'isNew']);

/**
 * Combine this computer's plan (`mine`) with the Drive version (`theirs`), both started from `base`.
 * Returns { state, conflicts: [{ collection, id, kind: 'changed'|'removedThere'|'removedHere', fields? }] }.
 * `fields` = the other computer's values of the fields both changed. Nothing passed in is changed.
 */
export function mergePlans(base, mine, theirs) {
  const state = structuredClone(mine);
  const conflicts = [];
  state.settings = mergeValue(base.settings ?? {}, mine.settings ?? {}, theirs.settings ?? {}).value;
  for (const name of Object.keys(COLLECTIONS)) {
    state[name] = mergeCollection(name, base[name] ?? [], mine[name] ?? [], theirs[name] ?? [], conflicts);
  }
  tidyLinks(state);
  renumber(state);
  return { state, conflicts };
}

function mergeCollection(collection, base, mine, theirs, conflicts) {
  const b = byId(base);
  const m = byId(mine);
  const t = byId(theirs);
  const out = [];
  for (const id of new Set([...m.keys(), ...t.keys()])) {
    const record = mergeRecord(collection, b.get(id), m.get(id), t.get(id), conflicts);
    if (record) out.push(record);
  }
  return out;
}

function mergeRecord(collection, base, mine, theirs, conflicts) {
  if (mine && theirs) return mergeFields(collection, base ?? {}, mine, theirs, conflicts);
  const kept = mine ?? theirs;
  if (!base) return structuredClone(kept); // added on one side
  if (same(base, kept)) return null; // deleted on the other side, untouched on this one
  conflicts.push({ collection, id: kept.id, kind: mine ? 'removedThere' : 'removedHere' });
  return mine ? structuredClone(mine) : null; // this computer's choice, for now
}

function mergeFields(collection, base, mine, theirs, conflicts) {
  const out = {};
  const fields = {};
  for (const key of new Set([...Object.keys(mine), ...Object.keys(theirs)])) {
    const merged = mergeValue(base[key], mine[key], theirs[key], key);
    if (merged.value !== undefined) out[key] = merged.value;
    if (merged.conflict) fields[key] = copy(theirs[key]);
  }
  if (Object.keys(fields).length) conflicts.push({ collection, id: mine.id, kind: 'changed', fields });
  return out;
}

/** One value, three ways: { value, conflict }. */
function mergeValue(base, mine, theirs, key) {
  if (same(mine, theirs) || same(base, theirs)) return { value: copy(mine) };
  if (same(base, mine)) return { value: copy(theirs) };
  if (NEWEST.has(key)) return { value: [mine, theirs].filter((v) => v != null).sort().at(-1) };
  if (QUIET.has(key)) return { value: copy(mine) };
  return mergeBothChanged(base, mine, theirs);
}

/** Both sides changed a value: combine lists and objects piece by piece, anything else is a conflict. */
function mergeBothChanged(base, mine, theirs) {
  if (idLists(base, mine, theirs)) return { value: mergeList(base ?? [], mine, theirs) };
  if (locationLists(mine, theirs)) return { value: mergeLocations(Array.isArray(base) ? base : [], mine, theirs) };
  if (plain(mine) && plain(theirs)) return mergeObject(plain(base) ? base : {}, mine, theirs);
  return { value: copy(mine), conflict: true };
}

function mergeObject(base, mine, theirs) {
  const value = {};
  let conflict = false;
  for (const key of new Set([...Object.keys(mine), ...Object.keys(theirs)])) {
    const merged = mergeValue(base[key], mine[key], theirs[key], key);
    if (merged.value !== undefined) value[key] = merged.value;
    conflict ||= Boolean(merged.conflict);
  }
  return { value, conflict };
}

/** Lists of ids: what either side added stays, what either side took out goes. */
function mergeList(base, mine, theirs) {
  const gone = new Set(base.filter((x) => !mine.includes(x) || !theirs.includes(x)));
  return [...new Set([...mine, ...theirs])].filter((x) => !gone.has(x));
}

/** A file's locations, matched by address. Neither side's locations are ever lost by combining. */
function mergeLocations(base, mine, theirs) {
  const b = byKey(base, 'uri');
  const t = byKey(theirs, 'uri');
  const out = mine.map((loc) => (t.has(loc.uri) ? mergeObject(b.get(loc.uri) ?? {}, loc, t.get(loc.uri)).value : copy(loc)));
  const mineUris = new Set(mine.map((loc) => loc.uri));
  // Theirs that this computer doesn't have: new ones are added; ones this computer took out stay out.
  return out.concat(theirs.filter((loc) => !mineUris.has(loc.uri) && !b.has(loc.uri)).map(copy));
}

const isId = (x) => typeof x === 'string' || typeof x === 'number';
const idList = (v) => Array.isArray(v) && v.every(isId);
const idLists = (base, mine, theirs) => idList(mine) && idList(theirs) && (base === undefined || idList(base));
const located = (v) => Array.isArray(v) && v.every((x) => plain(x) && typeof x.uri === 'string');
const locationLists = (mine, theirs) => located(mine) && located(theirs);
const plain = (v) => Boolean(v) && typeof v === 'object' && !Array.isArray(v);
const copy = (v) => (v === undefined ? undefined : structuredClone(v));
const byId = (list) => byKey(list, 'id');
const byKey = (list, key) => new Map(list.map((r) => [r[key], r]));

/** Deep equality that ignores the order of object keys (missing and undefined count as the same). */
export function same(a, b) {
  if (a === b) return true;
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const keysA = Object.keys(a).filter((k) => a[k] !== undefined);
  const keysB = Object.keys(b).filter((k) => b[k] !== undefined);
  return keysA.length === keysB.length && keysA.every((k) => same(a[k], b[k]));
}

// ---------- tidying up after combining ----------

/** Links to records that no longer exist are handled the way deleting those records would (model.js RELATIONS). */
export function tidyLinks(state) {
  for (const [parent, links] of Object.entries(RELATIONS)) {
    for (const [other, field, action] of links) {
      const ids = new Set(state[parent].map((r) => r.id)); // fresh each time: removing cascades
      tidyLink(state, other, field, action, (id) => id != null && !ids.has(id));
    }
  }
}

function tidyLink(state, other, field, action, gone) {
  if (action === 'pull') {
    state[other].forEach((r) => { if (Array.isArray(r[field])) r[field] = r[field].filter((x) => !gone(x)); });
  } else if (action === 'null') {
    state[other].forEach((r) => { if (gone(r[field])) r[field] = null; });
  } else {
    state[other].filter((r) => gone(r[field])).forEach((r) => remove(state, other, r.id));
  }
}

/** Ordered lists and what makes one list: each eval grade's lesson order, each class's week. */
const ORDERS = { criterionLessons: ['criterionId', 'gradeId'], weekLessons: ['yearId', 'schoolId', 'gradeId', 'weekStart'] };

function renumber(state) {
  for (const [name, keys] of Object.entries(ORDERS)) {
    const lists = new Map();
    for (const r of state[name]) {
      const key = keys.map((f) => r[f]).join('|');
      lists.set(key, [...(lists.get(key) ?? []), r]);
    }
    for (const list of lists.values()) list.sort(byPosition).forEach((r, i) => { r.position = i; });
  }
}

const byPosition = (a, b) => (a.position - b.position) || (a.id < b.id ? -1 : 1);

// ---------- choosing the other computer's version ----------

/** Switch the conflicting records to the other computer's version (`state` is changed in place). */
export function useTheirs(state, conflicts, theirs) {
  for (const c of conflicts) {
    if (c.kind === 'changed') {
      const record = state[c.collection].find((r) => r.id === c.id);
      if (record) Object.assign(record, structuredClone(c.fields));
    } else if (c.kind === 'removedThere') {
      remove(state, c.collection, c.id);
    } else {
      restore(state, theirs, c.collection, c.id);
    }
  }
  tidyLinks(state);
  renumber(state);
}

/** Bring a record back from the other computer's version, with what was deleted along with it. */
function restore(state, theirs, collection, id) {
  const record = theirs[collection].find((r) => r.id === id);
  if (!record || state[collection].some((r) => r.id === id)) return;
  state[collection].push(structuredClone(record));
  for (const [other, field, action] of RELATIONS[collection] || []) {
    if (action !== 'delete') continue;
    theirs[other].filter((r) => r[field] === id).forEach((r) => restore(state, theirs, other, r.id));
  }
}

// ---------- telling the teacher ----------

const KINDS = {
  years: 'School year', instruments: 'Instrument', schools: 'School', grades: 'Grade', outcomes: 'Outcome',
  localRoots: 'Computer folder', deckFolders: 'Lesson folder', lessons: 'Lesson', criteria: 'Eval',
  criterionLessons: 'Lesson order of eval', placements: 'Calendar bar for', instrumentBlocks: 'Instrument Schedule bar for',
  weekLessons: 'Lesson Schedule entry', imageFolders: 'Picture folder', images: 'Picture', tagGroups: 'Tag group',
  tags: 'Tag', holidays: 'Event',
};
// Records without a name of their own are named after what they point at.
const NAMED_BY = {
  criterionLessons: ['criterionId', 'criteria'], placements: ['criterionId', 'criteria'],
  instrumentBlocks: ['instrumentId', 'instruments'], weekLessons: ['lessonId', 'lessons'],
};
const WHY = {
  changed: 'changed on both computers',
  removedThere: 'deleted on the other computer, changed here',
  removedHere: 'deleted here, changed on the other computer',
};

/** A conflict in the teacher's words, e.g. 'Lesson “Rhythm Review” (changed on both computers)'. */
export function describeConflict(mine, theirs, c) {
  const find = (collection, id) => mine[collection]?.find((r) => r.id === id) ?? theirs[collection]?.find((r) => r.id === id);
  let record = find(c.collection, c.id);
  if (record && NAMED_BY[c.collection]) {
    const [field, collection] = NAMED_BY[c.collection];
    record = find(collection, record[field]);
  }
  const name = record && (record.name || record.title || record.code);
  return `${KINDS[c.collection] ?? c.collection}${name ? ` “${name}”` : ''} (${WHY[c.kind]})`;
}

/** The conflicts as one short sentence part (at most `limit` named, then "and n more"). */
export function conflictSummary(mine, theirs, conflicts, limit = 4) {
  const named = conflicts.slice(0, limit).map((c) => describeConflict(mine, theirs, c));
  const more = conflicts.length - named.length;
  return named.join('; ') + (more > 0 ? `; and ${more} more` : '');
}
