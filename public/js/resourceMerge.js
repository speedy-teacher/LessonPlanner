// A teacher has one Teacher Resources (templates and pictures), kept from year to year. When another
// year's older plan is moved to pieces, its templates and pictures are added to that same Resources
// instead of making a second one: things already there (same record, the same thing carried over from
// another year, or the same file in Drive) are matched, the rest is added. The plan's Lesson Schedule
// is then pointed at the matched records.
//
// Pure logic, shared by the browser app and the Node tests.

import { PIECES } from './pieces.js';

/** In the order they're matched (a folder before what's in it, a tag group before its tags…). */
const ORDER = ['localRoots', 'tagGroups', 'tags', 'deckFolders', 'imageFolders', 'lessons', 'images'];
const BY_NAME = { localRoots: [], tagGroups: [], tags: ['groupId'] };

/**
 * Add `incoming` (a Teacher Resources piece) to `existing`. Returns { resources, map } — `map` =
 * { incomingId: existingId } for everything matched, to point the plan's schedule at. Nothing passed in is changed.
 */
export function mergeResources(existing, incoming) {
  const resources = structuredClone(existing);
  const map = {};
  for (const collection of ORDER.filter((c) => PIECES.resources.collections.includes(c))) {
    for (const record of incoming[collection] ?? []) {
      const linked = relink(structuredClone(record), map);
      const match = resources[collection].find((r) => sameThing(collection, r, linked));
      if (match) map[record.id] = match.id;
      else resources[collection].push(linked);
    }
  }
  return { resources, map };
}

function sameThing(collection, a, b) {
  if (a.id === b.id || a.id === b.copiedFromId || a.copiedFromId === b.id) return true;
  if (a.copiedFromId && a.copiedFromId === b.copiedFromId) return true;
  if (BY_NAME[collection]) return simple(a.name) === simple(b.name) && BY_NAME[collection].every((f) => a[f] === b[f]);
  const places = new Set((a.locations ?? []).map((l) => l.uri));
  return (b.locations ?? []).some((l) => places.has(l.uri));
}

const simple = (text) => String(text ?? '').trim().toLowerCase();

/** A record's links to other Resources records, pointed at what they were matched to. */
function relink(record, map) {
  for (const [key, value] of Object.entries(record)) {
    if (key === 'id' || key === 'copiedFromId') continue;
    if (key.endsWith('Id') && typeof value === 'string') record[key] = map[value] ?? value;
    else if (key.endsWith('Ids') && Array.isArray(value)) record[key] = [...new Set(value.map((id) => map[id] ?? id))];
  }
  return record;
}

/** A Teacher Schedule pointed at the matched Resources records (lesson order, schedule entries). */
export function relinkSchedule(schedule, map) {
  const out = structuredClone(schedule);
  for (const collection of PIECES.schedule.collections) out[collection] = out[collection].map((r) => relink(r, map));
  return out;
}
