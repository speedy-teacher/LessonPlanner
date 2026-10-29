// Lesson copies: every lesson on the Lesson Schedule gets its own copy of its template file,
// kept in the year's output folder as
//   <output folder>/<plan name>/<school>/<grade>/Week <n>/<order> - <lesson name>
// with the "Filled in automatically" details ({{school}}, {{week_number}}…) filled in.
//
// This module only works out what *should* be there and what to do about what *is* there,
// so the same steps are used whether copies go to Google Drive or to a folder on the computer
// (exportDrive.js / exportLocal.js do the actual work, exportBridge.js runs it in the background).
//
// A wanted copy: { key, entryId, lessonId, template, path: [folder names], name, values, hash, place }
//   template = the template file's id/address; values = { '{{school}}': 'School A', … } to fill in;
//   hash     = fingerprint of the template + values (changes only when the copy's contents would);
//   place    = fingerprint of where it goes (output folder + path).
// A copy that exists: { id, entryId, lessonId, hash, place, name, … } (more fields per kind of folder).

import { formatRange } from './dates.js';
import { AUTO_FIELD_PLACEHOLDERS, find, lessonInstruments, outcomeLabel } from './model.js';
import { entryCriterion, placementsInWeek, schoolWeeks } from './weekPlan.js';

/** Letters files and folders can't have on a computer (and Drive shows oddly). */
export function safeName(text) {
  const clean = String(text ?? '').replace(/[\\/:*?"<>|\p{Cc}]+/gu, '-').replace(/\s+/g, ' ').trim();
  return clean.replace(/^\.+/, '') || 'Untitled';
}

/** A short fingerprint of some text (the same text always gives the same one). */
export function fingerprint(text) {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(36);
}

const scheduleOrder = (a, b) => a.weekStart.localeCompare(b.weekStart) || a.position - b.position;

/** Each entry's running lesson number for its class (school + grade) through the year: entry id → 1, 2, 3… */
export function lessonNumbers(entries) {
  const numbers = new Map();
  const byClass = Map.groupBy([...entries].sort(scheduleOrder), (e) => `${e.yearId}|${e.schoolId}|${e.gradeId}`);
  for (const list of byClass.values()) list.forEach((e, i) => numbers.set(e.id, i + 1));
  return numbers;
}

/**
 * Every detail a schedule entry can fill in, by AUTO_FIELDS key.
 * `week` = the school week it's in ({ number, weekStart, friday, days }); `numbers` = lessonNumbers()
 * (worked out here when not given).
 */
export function entryValues(state, entry, week, numbers = lessonNumbers(state.weekLessons)) {
  const lesson = find(state, 'lessons', entry.lessonId);
  const criterion = entryCriterion(state, entry, placementsInWeek(state, entry, week));
  const days = week.days.length ? week.days : [week.weekStart];
  const nameOf = (collection, id) => find(state, collection, id)?.name ?? '';
  return {
    school: nameOf('schools', entry.schoolId),
    grade: nameOf('grades', entry.gradeId),
    date: formatRange(days[0], days.at(-1)),
    week: String(week.number),
    lessonNumber: String(numbers.get(entry.id) || ''),
    instrument: lessonInstruments(state, lesson).map((i) => i.name).join(', '),
    outcome: outcomeLabel(find(state, 'outcomes', criterion?.outcomeId)),
    criterion: criterion?.title || '',
  };
}

/** Only the details the lesson asks for, as placeholder → text (sorted, so fingerprints are steady). */
function fillValues(lesson, all) {
  return Object.fromEntries([...lesson.autoFields].sort()
    .filter((key) => AUTO_FIELD_PLACEHOLDERS[key])
    .map((key) => [AUTO_FIELD_PLACEHOLDERS[key], all[key] ?? '']));
}

/**
 * The copies the schedule asks for, in schedule order.
 * `target` = { rootKey (which output folder), yearFolder (plan name), templateOf(lesson) → id or null,
 *              canFill(lesson) → whether details can be filled in there }.
 * Lessons with no template file the folder can copy from are left out.
 */
export function wantedCopies(state, yearId, target) {
  const weeks = new Map(schoolWeeks(find(state, 'years', yearId)).map((w) => [w.weekStart, w]));
  const entries = state.weekLessons.filter((e) => e.yearId === yearId && weeks.has(e.weekStart)).sort(scheduleOrder);
  const numbers = lessonNumbers(entries);
  return entries
    .map((entry) => wantedCopy(state, entry, { week: weeks.get(entry.weekStart), numbers }, target))
    .filter(Boolean);
}

function wantedCopy(state, entry, { week, numbers }, { rootKey, yearFolder, templateOf, canFill }) {
  const lesson = find(state, 'lessons', entry.lessonId);
  const template = lesson ? templateOf(lesson) : null;
  if (!template) return null;
  const all = entryValues(state, entry, week, numbers);
  const values = canFill(lesson) ? fillValues(lesson, all) : {};
  const path = [yearFolder, all.school, all.grade, `Week ${week.number}`].map(safeName);
  return {
    key: entry.id, entryId: entry.id, lessonId: lesson.id, template, path, values,
    name: safeName(`${entry.position + 1} - ${lesson.name}`),
    hash: fingerprint(JSON.stringify([template, values])),
    place: fingerprint(JSON.stringify([rootKey, path])),
  };
}

/**
 * What to do for one schedule entry, given the copy it wants (or null) and the copies of it that exist:
 *   { kind: 'create', want }          — make a copy from the template
 *   { kind: 'refill', want, have }    — the details changed: a fresh copy replaces the old one
 *   { kind: 'move', want, have }      — same contents, new folder or name
 *   { kind: 'remove', have }          — not on the schedule any more (or a spare copy)
 *   null                              — nothing to do
 */
export function nextStep(want, haves) {
  if (!want) return haves.length ? { kind: 'remove', have: haves[0] } : null;
  if (!haves.length) return { kind: 'create', want };
  const best = haves.find((h) => h.hash === want.hash && h.lessonId === want.lessonId) ?? haves[0];
  const spare = haves.find((h) => h !== best);
  if (spare) return { kind: 'remove', have: spare };
  if (best.hash !== want.hash || best.lessonId !== want.lessonId) return { kind: 'refill', want, have: best };
  if (best.place !== want.place || best.name !== want.name) return { kind: 'move', want, have: best };
  return null;
}

/** Copies that exist, grouped by the schedule entry they belong to. */
export function groupCopies(haves) {
  return Map.groupBy(haves, (h) => h.entryId);
}

/** The entries (keys) that need something done, wanted copies first in schedule order, then leftovers. */
export function keysToDo(wants, haves) {
  const byEntry = groupCopies(haves);
  const wanted = new Map(wants.map((w) => [w.key, w]));
  const keys = [...wanted.keys(), ...[...byEntry.keys()].filter((k) => !wanted.has(k))];
  return keys.filter((k) => nextStep(wanted.get(k) ?? null, byEntry.get(k) ?? []));
}
