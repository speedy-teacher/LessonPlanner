// Joining a School Year a colleague shared: the teacher's own plan used its own schools, grades,
// instruments, outcomes and evals. Each is matched to the shared School Year's by name, the teacher
// checks the ones that didn't match, and their Lesson Schedule, lesson order, templates and pictures
// are then pointed at the shared ones.
//
// Pure logic, shared by the browser app and the Node tests.

import { splitState } from './pieces.js';

/** What gets matched, in order (evals are matched inside their matched outcome). */
export const MATCHED = ['schools', 'grades', 'instruments', 'outcomes', 'criteria'];

export const MATCH_WORDS = { schools: 'School', grades: 'Grade', instruments: 'Instrument', outcomes: 'Outcome', criteria: 'Eval' };

const simple = (text) => String(text ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/** How a record is shown (and matched): schools/instruments by name, grades by name or short name, outcomes by code. */
export function matchLabel(collection, r) {
  if (collection === 'outcomes') return [r.code, r.title].filter(Boolean).join(' – ');
  if (collection === 'criteria') return r.title ?? '';
  return r.name ?? '';
}

function namesOf(collection, r) {
  if (collection === 'grades') return [r.name, r.short].map(simple).filter(Boolean);
  if (collection === 'outcomes') return [r.code, r.title].map(simple).filter(Boolean);
  return [simple(matchLabel(collection, r))].filter(Boolean);
}

/**
 * Match `mine` (one year's planner data) to the shared School Year piece `theirs`.
 * Returns { map: { myId: theirId }, unmatched: [{ collection, id, label, choices: [{ id, label }] }] }.
 */
export function matchToSchoolYear(mine, theirs) {
  const map = {};
  const unmatched = [];
  if (mine.years[0] && theirs.years[0]) map[mine.years[0].id] = theirs.years[0].id;
  for (const collection of MATCHED) {
    const taken = new Set();
    for (const r of mine[collection]) {
      const choices = choicesFor(collection, r, theirs, map);
      const found = choices.find((c) => !taken.has(c.id) && sameName(collection, r, c));
      if (found) {
        map[r.id] = found.id;
        taken.add(found.id);
      } else {
        unmatched.push({ collection, id: r.id, label: matchLabel(collection, r), choices: choices.map((c) => ({ id: c.id, label: matchLabel(collection, c) })) });
      }
    }
  }
  return { map, unmatched };
}

/** The shared records a record could be matched to (evals only within the matching outcome). */
function choicesFor(collection, r, theirs, map) {
  if (collection !== 'criteria') return theirs[collection];
  return theirs.criteria.filter((c) => c.outcomeId === map[r.outcomeId]);
}

function sameName(collection, a, b) {
  const names = new Set(namesOf(collection, b));
  return namesOf(collection, a).some((n) => names.has(n));
}

/**
 * The teacher's own pieces (Teacher Schedule + Teacher Resources), pointed at the shared School Year.
 * `map` = { myId: theirId } (matchToSchoolYear's, with the teacher's choices added). Anything left
 * unmatched still points at the old record (shown as "not available" until it's fixed).
 */
export function joinedPieces(mine, theirs, map) {
  const state = renameDeep(structuredClone(mine), map);
  const pieces = splitState(state);
  const year = theirs.years[0];
  if (year) pieces.schedule.meta.year = { id: year.id, name: year.name };
  return { schedule: pieces.schedule, resources: pieces.resources };
}

function renameDeep(value, map) {
  if (Array.isArray(value)) return value.map((v) => renameDeep(v, map));
  if (!value || typeof value !== 'object') return value;
  for (const [key, v] of Object.entries(value)) value[key] = renameField(key, v, map);
  return value;
}

function renameField(key, v, map) {
  if (key === 'copiedFromId') return v;
  if ((key === 'id' || key.endsWith('Id')) && typeof v === 'string') return map[v] ?? v;
  if (key.endsWith('Ids') && Array.isArray(v)) return v.map((id) => map[id] ?? id);
  return renameDeep(v, map);
}
