// The Lesson Schedule: which lesson decks a class (school + grade) is taught in
// each school week, in order. Only the week matters, not the day.
//
// Records live in the `weekLessons` collection (see model.js). Shared by the
// browser app and the Node tests.

import { addDays, mondayOf, weekdaysBetween } from './dates.js';
import { add, find, outcomeOf, placementsFor, remove, stepsFor, instrumentsAt } from './model.js';

/** Every school week of a year: [{ number, weekStart (Monday), friday, days: school days inside the year }]. */
export function schoolWeeks(year) {
  if (!year) return [];
  const weeks = [];
  for (let monday = mondayOf(year.startDate), n = 1; monday <= year.endDate; monday = addDays(monday, 7), n += 1) {
    const friday = addDays(monday, 4);
    const from = monday < year.startDate ? year.startDate : monday;
    const to = friday > year.endDate ? year.endDate : friday;
    weeks.push({ number: n, weekStart: monday, friday, days: weekdaysBetween(from, to) });
  }
  return weeks;
}

/** A class's lessons in one week, in teaching order. `cls` = { yearId, schoolId, gradeId }. */
export function weekLessonsFor(state, cls, weekStart) {
  return classEntries(state, cls)
    .filter((e) => e.weekStart === weekStart)
    .sort((a, b) => a.position - b.position);
}

function classEntries(state, { yearId, schoolId, gradeId }) {
  return state.weekLessons.filter((e) => e.yearId === yearId && e.schoolId === schoolId && e.gradeId === gradeId);
}

/** Put the entry at `index` (0-based; default: last) of its week and number the week 0, 1, 2… */
function placeInWeek(state, entry, index) {
  const others = weekLessonsFor(state, entry, entry.weekStart).filter((e) => e !== entry);
  const at = Math.max(0, Math.min(index ?? others.length, others.length));
  others.splice(at, 0, entry);
  others.forEach((e, i) => { e.position = i; });
}

/** Add a lesson deck to a class's week. The deck stays in the library; this is just a reference to it. */
export function addWeekLesson(state, { yearId, schoolId, gradeId, weekStart, lessonId, criterionId = null, index }) {
  const entry = add(state, 'weekLessons', { yearId, schoolId, gradeId, weekStart, lessonId, criterionId, position: Infinity });
  placeInWeek(state, entry, index);
  return entry;
}

/** Move an entry to another place in its week, or to another week. */
export function moveWeekLesson(state, entryId, weekStart, index) {
  const entry = find(state, 'weekLessons', entryId);
  if (!entry) return null;
  const from = entry.weekStart;
  entry.weekStart = weekStart;
  entry.position = Infinity;
  placeInWeek(state, entry, index);
  if (from !== weekStart) renumber(state, entry, from);
  return entry;
}

/** Take an entry off the schedule (the lesson deck itself is kept). */
export function removeWeekLesson(state, entryId) {
  const entry = find(state, 'weekLessons', entryId);
  if (!entry) return;
  remove(state, 'weekLessons', entryId);
  renumber(state, entry, entry.weekStart);
}

function renumber(state, cls, weekStart) {
  weekLessonsFor(state, cls, weekStart).forEach((e, i) => { e.position = i; });
}

/** Eval entries on the Outcome & Eval Calendar that touch a week, earliest first. */
export function placementsInWeek(state, cls, week) {
  return placementsFor(state, cls.yearId, cls.schoolId, cls.gradeId)
    .filter((p) => p.startDate <= week.friday && p.endDate >= week.weekStart)
    .sort((a, b) => a.startDate.localeCompare(b.startDate));
}

/**
 * Instruments at the school during a week: [{ instrumentId, days: [dates it's there] }].
 * `allWeek` is true when it's there on every school day of that week.
 */
export function instrumentsInWeek(state, cls, week) {
  const byInstrument = new Map();
  for (const date of week.days) {
    for (const id of instrumentsAt(state, cls.yearId, cls.schoolId, date)) {
      if (!byInstrument.has(id)) byInstrument.set(id, []);
      byInstrument.get(id).push(date);
    }
  }
  return [...byInstrument.entries()].map(([instrumentId, days]) => ({
    instrumentId, days, allWeek: days.length === week.days.length,
  }));
}

/** Instruments an entry's lesson uses that aren't at the school on any day of its week. */
export function missingInstruments(state, entry, week) {
  const lesson = find(state, 'lessons', entry.lessonId);
  const there = new Set(instrumentsInWeek(state, entry, week).map((i) => i.instrumentId));
  return (lesson?.instrumentIds ?? []).filter((id) => !there.has(id));
}

/**
 * The eval an entry is taught for: the one it was put in for, otherwise an eval on the
 * calendar that week that teaches this lesson, otherwise null.
 */
export function entryCriterion(state, entry, weekPlacements) {
  if (entry.criterionId && find(state, 'criteria', entry.criterionId)) return find(state, 'criteria', entry.criterionId);
  const match = weekPlacements.find((p) => stepsFor(state, p.criterionId).some((s) => s.lessonId === entry.lessonId));
  return match ? find(state, 'criteria', match.criterionId) : null;
}

/** The outcome an entry's eval belongs to (for its color), or null. */
export function entryOutcome(state, entry, weekPlacements) {
  const criterion = entryCriterion(state, entry, weekPlacements);
  return criterion ? outcomeOf(state, criterion.id) : null;
}

/**
 * The lesson library for the schedule's side list, narrowed by any of:
 * search text, category, grade, outcome and eval (ids; empty = any).
 * When a grade, outcome or eval is chosen, only decks taught in matching evals are listed,
 * in teaching order. Returns [{ lesson, criterionId }] — criterionId is set when one eval is chosen.
 */
export function filterLessons(state, yearId, { search = '', category = '', gradeId = '', outcomeId = '', criterionId = '' } = {}) {
  const byEval = gradeId || outcomeId || criterionId;
  const list = byEval
    ? lessonsInEvals(state, yearId, { gradeId, outcomeId, criterionId })
    : state.lessons.filter((l) => l.yearId === yearId)
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
  const words = search.trim().toLowerCase();
  return list
    .filter((l) => !category || l.category === category)
    .filter((l) => !words || `${l.name} ${l.category}`.toLowerCase().includes(words))
    .map((lesson) => ({ lesson, criterionId: criterionId || null }));
}

function lessonsInEvals(state, yearId, { gradeId, outcomeId, criterionId }) {
  const outcomeIds = state.outcomes.filter((o) => o.yearId === yearId && (!outcomeId || o.id === outcomeId)).map((o) => o.id);
  const criteria = state.criteria.filter((c) => outcomeIds.includes(c.outcomeId)
    && (!gradeId || c.gradeIds.includes(gradeId)) && (!criterionId || c.id === criterionId));
  const ids = [...new Set(criteria.flatMap((c) => stepsFor(state, c.id).map((s) => s.lessonId)))];
  return ids.map((id) => find(state, 'lessons', id)).filter(Boolean);
}

/**
 * Fill a class's weeks from the Outcome & Eval Calendar: each eval's lessons, in teaching order,
 * are spread evenly over the weeks the eval is on the calendar. Replaces the class's schedule.
 * Returns how many lessons were placed.
 */
export function autoFillWeeks(state, cls, weeks) {
  classEntries(state, cls).forEach((e) => remove(state, 'weekLessons', e.id));
  const sorted = placementsFor(state, cls.yearId, cls.schoolId, cls.gradeId)
    .sort((a, b) => a.startDate.localeCompare(b.startDate));
  let count = 0;
  for (const p of sorted) {
    const covered = weeks.filter((w) => p.startDate <= w.friday && p.endDate >= w.weekStart);
    const steps = stepsFor(state, p.criterionId);
    if (!covered.length) continue;
    steps.forEach((step, i) => {
      const week = covered[Math.floor((i * covered.length) / steps.length)];
      addWeekLesson(state, { ...cls, weekStart: week.weekStart, lessonId: step.lessonId, criterionId: p.criterionId });
      count += 1;
    });
  }
  return count;
}
