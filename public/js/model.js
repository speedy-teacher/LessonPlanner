// The Lesson Planner data model.
//
// All data lives in one plain JSON object made of flat "collections"
// (arrays of records with an `id`). Records point at each other by id,
// which keeps the data easy to export, search and reuse elsewhere.
//
// Year-scoped collections carry a `yearId`. Records copied into a new
// year keep a `copiedFromId` link back to last year's record, so the same
// school/outcome/etc. can be followed across years.
//
// This module is shared by the browser app and the Node tests.

import { addDays, daysBetween, isWeekday, nextWeekday, weekdaysBetween } from './dates.js';

export const SCHEMA_VERSION = 3;

/** Default colors handed out to new outcomes and instruments (earthy & royal). */
export const PALETTE = ['#6b8f5e', '#6a4c93', '#b5654a', '#3f6e8c', '#c49a3a', '#8c4f6b', '#4f7d7a', '#7a6248'];

/** Collections and what each record looks like (documentation + normalizing). */
export const COLLECTIONS = {
  years: 'id, name, startDate, endDate',
  instruments: 'id, yearId, name, color',
  schools: 'id, yearId, name',
  grades: 'id, yearId, name, short',
  outcomes: 'id, yearId, code, title, color',
  // A lesson is one slide deck: what it fills in automatically and which instruments it uses.
  lessons: 'id, yearId, name, category, autoFields[], instrumentIds[]',
  criteria: 'id, outcomeId, title, gradeIds[]',
  // The lessons an eval criterion is taught with, in teaching order (a lesson can be in several evals).
  criterionLessons: 'id, criterionId, lessonId, position',
  placements: 'id, yearId, schoolId, gradeId, criterionId, startDate, endDate',
  instrumentBlocks: 'id, yearId, schoolId, instrumentId, startDate, endDate',
};

/** Collections that roll over (are copied) when a new year is created. */
export const ROLLOVER = ['instruments', 'schools', 'grades', 'lessons', 'outcomes'];

/** Lesson deck fields that are filled in automatically from the schedule. */
export const AUTO_FIELDS = {
  school: 'School',
  grade: 'Grade',
  date: 'Date',
  instrument: 'Instrument',
  outcome: 'Essential outcome',
  criterion: 'Eval criterion',
};

// What happens to related records when a record is removed:
// delete them, clear the link (null), or pull the id out of a list.
const RELATIONS = {
  years: [
    ['instruments', 'yearId', 'delete'], ['schools', 'yearId', 'delete'],
    ['grades', 'yearId', 'delete'], ['outcomes', 'yearId', 'delete'],
    ['lessons', 'yearId', 'delete'], ['placements', 'yearId', 'delete'],
    ['instrumentBlocks', 'yearId', 'delete'],
  ],
  instruments: [['instrumentBlocks', 'instrumentId', 'delete'], ['lessons', 'instrumentIds', 'pull']],
  schools: [['placements', 'schoolId', 'delete'], ['instrumentBlocks', 'schoolId', 'delete']],
  grades: [['placements', 'gradeId', 'delete'], ['criteria', 'gradeIds', 'pull']],
  outcomes: [['criteria', 'outcomeId', 'delete']],
  lessons: [['criterionLessons', 'lessonId', 'delete']],
  criteria: [['criterionLessons', 'criterionId', 'delete'], ['placements', 'criterionId', 'delete']],
};

export function newId(prefix) {
  const rand = Math.random().toString(36).slice(2, 8);
  return `${prefix}_${Date.now().toString(36)}${rand}`;
}

const PREFIX = {
  years: 'yr', instruments: 'ins', schools: 'sch', grades: 'gr', outcomes: 'out',
  lessons: 'les', criteria: 'crit', criterionLessons: 'cl', placements: 'plc', instrumentBlocks: 'blk',
};

export function emptyState() {
  const state = { schemaVersion: SCHEMA_VERSION, activeYearId: null };
  for (const name of Object.keys(COLLECTIONS)) state[name] = [];
  return state;
}

/** Fill in anything missing from saved data so older files keep loading. */
export function normalize(raw) {
  const state = { ...emptyState(), ...(raw || {}) };
  for (const name of Object.keys(COLLECTIONS)) {
    if (!Array.isArray(state[name])) state[name] = [];
  }
  state.criteria.forEach((c) => { if (!Array.isArray(c.gradeIds)) c.gradeIds = []; });
  migrate(state);
  state.lessons.forEach(normalizeLesson);
  for (const year of state.years) assignOutcomeColors(state, year.id);
  if (!state.years.some((y) => y.id === state.activeYearId)) {
    state.activeYearId = state.years.at(-1)?.id ?? null;
  }
  state.schemaVersion = SCHEMA_VERSION;
  return state;
}

/** Upgrade data saved by older versions of the app, one version at a time. */
function migrate(state) {
  const version = state.schemaVersion || 1;
  if (version < 2) migrateToV2(state);
  if (version < 3) migrateToV3(state);
}

function normalizeLesson(lesson) {
  if (!Array.isArray(lesson.autoFields)) lesson.autoFields = [];
  if (!Array.isArray(lesson.instrumentIds)) lesson.instrumentIds = [];
  if (typeof lesson.category !== 'string') lesson.category = '';
}

/**
 * Version 1 placed whole outcomes on single days. Version 2 places eval
 * criteria over a date range: each old entry becomes one entry per
 * criterion of that outcome which applies to the entry's grade.
 */
function migrateToV2(state) {
  state.placements = state.placements.flatMap((p) => {
    if (p.criterionId) return [p];
    return criteriaFor(state, p.outcomeId)
      .filter((c) => c.gradeIds.includes(p.gradeId))
      .map((c) => ({
        id: newId('plc'), yearId: p.yearId, schoolId: p.schoolId, gradeId: p.gradeId,
        criterionId: c.id, startDate: p.date, endDate: p.date,
      }));
  });
}

/**
 * Version 2 had slide "templates" and per-eval "slides" that each picked a
 * template and an instrument. Version 3: each template is a lesson (one slide
 * deck) that knows its own instruments, and an eval lists lessons in order.
 */
function migrateToV3(state) {
  const lessons = new Map((state.templates || []).map((t) => [t.id, { ...t, instrumentIds: [] }]));
  state.lessons = [...lessons.values()];
  state.criterionLessons = (state.slides || []).map((slide) => {
    const lesson = lessons.get(slide.templateId) ?? lessonFromSlide(state, slide);
    if (slide.instrumentId && !lesson.instrumentIds.includes(slide.instrumentId)) lesson.instrumentIds.push(slide.instrumentId);
    return { id: slide.id, criterionId: slide.criterionId, lessonId: lesson.id, position: slide.position };
  });
  delete state.templates;
  delete state.slides;
}

/** An old slide without a template becomes a lesson of its own. */
function lessonFromSlide(state, slide) {
  const yearId = outcomeOf(state, slide.criterionId)?.yearId ?? null;
  const lesson = { id: newId('les'), yearId, name: slide.title, category: '', autoFields: [], instrumentIds: [] };
  state.lessons.push(lesson);
  return lesson;
}

function assignOutcomeColors(state, yearId) {
  inYear(state, 'outcomes', yearId).forEach((o, i) => {
    if (!o.color) o.color = PALETTE[i % PALETTE.length];
  });
}

/** A color for the next new outcome/instrument in a year that isn't used yet, if possible. */
export function nextColor(state, collection, yearId) {
  const used = new Set(inYear(state, collection, yearId).map((r) => r.color));
  return PALETTE.find((c) => !used.has(c)) ?? PALETTE[used.size % PALETTE.length];
}

// ---------- generic record helpers ----------

export function find(state, collection, id) {
  return state[collection].find((r) => r.id === id) || null;
}

export function inYear(state, collection, yearId) {
  return state[collection].filter((r) => r.yearId === yearId);
}

export function add(state, collection, fields) {
  const record = { id: newId(PREFIX[collection]), ...fields };
  state[collection].push(record);
  return record;
}

export function update(state, collection, id, patch) {
  const record = find(state, collection, id);
  if (record) Object.assign(record, patch);
  return record;
}

/** Remove a record and tidy up everything that pointed at it. */
export function remove(state, collection, id) {
  const record = find(state, collection, id);
  if (!record) return;
  state[collection] = state[collection].filter((r) => r.id !== id);
  for (const [other, field, action] of RELATIONS[collection] || []) {
    applyRelation(state, other, field, action, id);
  }
  if (collection === 'criterionLessons') renumberSteps(state, record.criterionId);
  if (collection === 'years' && state.activeYearId === id) {
    state.activeYearId = state.years.at(-1)?.id ?? null;
  }
}

function applyRelation(state, other, field, action, id) {
  if (action === 'delete') {
    state[other].filter((r) => r[field] === id).forEach((r) => remove(state, other, r.id));
  } else if (action === 'null') {
    state[other].forEach((r) => { if (r[field] === id) r[field] = null; });
  } else if (action === 'pull') {
    state[other].forEach((r) => { r[field] = r[field].filter((x) => x !== id); });
  }
}

// ---------- academic years ----------

/**
 * Create a new academic year. When `copyFromYearId` is given, instruments,
 * schools, grades, lessons and essential outcomes (with their eval
 * criteria and lesson order) are copied over. Calendars start empty.
 */
export function createYear(state, { name, startDate, endDate }, copyFromYearId = null) {
  const year = add(state, 'years', { name, startDate, endDate });
  if (copyFromYearId) copyYearContents(state, copyFromYearId, year.id);
  state.activeYearId = year.id;
  return year;
}

function copyYearContents(state, fromYearId, toYearId) {
  const idMap = {};
  for (const collection of ROLLOVER) {
    for (const old of inYear(state, collection, fromYearId)) {
      const { id, ...rest } = old;
      const copy = add(state, collection, { ...structuredClone(rest), yearId: toYearId, copiedFromId: id });
      idMap[id] = copy.id;
    }
  }
  const mapId = (id) => (id ? idMap[id] ?? null : null);
  for (const lesson of inYear(state, 'lessons', toYearId)) {
    lesson.instrumentIds = lesson.instrumentIds.map(mapId).filter(Boolean);
  }
  for (const outcomeId of Object.keys(idMap).filter((id) => find(state, 'outcomes', id))) {
    copyCriteria(state, outcomeId, idMap[outcomeId], mapId);
  }
}

function copyCriteria(state, fromOutcomeId, toOutcomeId, mapId) {
  for (const crit of criteriaFor(state, fromOutcomeId)) {
    const newCrit = add(state, 'criteria', {
      outcomeId: toOutcomeId,
      title: crit.title,
      gradeIds: crit.gradeIds.map(mapId).filter(Boolean),
      copiedFromId: crit.id,
    });
    for (const step of stepsFor(state, crit.id)) {
      add(state, 'criterionLessons', {
        criterionId: newCrit.id, lessonId: mapId(step.lessonId), position: step.position, copiedFromId: step.id,
      });
    }
  }
}

export function activeYear(state) {
  return find(state, 'years', state.activeYearId);
}

/** Suggested dates/name for the year after `year`. */
export function suggestNextYear(year) {
  const shift = (iso) => `${Number(iso.slice(0, 4)) + 1}${iso.slice(4)}`;
  const startYear = Number(year.startDate.slice(0, 4)) + 1;
  return { name: `${startYear}–${startYear + 1}`, startDate: shift(year.startDate), endDate: shift(year.endDate) };
}

// ---------- outcomes, criteria, lesson order ----------

export function criteriaFor(state, outcomeId) {
  return state.criteria.filter((c) => c.outcomeId === outcomeId);
}

/**
 * The "steps" of an eval criterion: its lessons in teaching order.
 * Each step is a criterionLessons record pointing at a lesson.
 */
export function stepsFor(state, criterionId) {
  return state.criterionLessons
    .filter((s) => s.criterionId === criterionId)
    .sort((a, b) => a.position - b.position);
}

/** Add a lesson to the end of an eval criterion's teaching order. */
export function addStep(state, criterionId, lessonId) {
  return add(state, 'criterionLessons', { criterionId, lessonId, position: stepsFor(state, criterionId).length });
}

/** Move a step to a new place (0-based) in its criterion's order. */
export function moveStep(state, stepId, newIndex) {
  const step = find(state, 'criterionLessons', stepId);
  if (!step) return;
  const ordered = stepsFor(state, step.criterionId).filter((s) => s.id !== stepId);
  const index = Math.max(0, Math.min(newIndex, ordered.length));
  ordered.splice(index, 0, step);
  ordered.forEach((s, i) => { s.position = i; });
}

function renumberSteps(state, criterionId) {
  stepsFor(state, criterionId).forEach((s, i) => { s.position = i; });
}

export function toggleGrade(state, criterionId, gradeId) {
  const crit = find(state, 'criteria', criterionId);
  if (!crit) return;
  crit.gradeIds = crit.gradeIds.includes(gradeId)
    ? crit.gradeIds.filter((g) => g !== gradeId)
    : [...crit.gradeIds, gradeId];
}

/** Eval criteria of an outcome that apply to a grade. */
export function criteriaForGrade(state, outcomeId, gradeId) {
  return criteriaFor(state, outcomeId).filter((c) => c.gradeIds.includes(gradeId));
}

/** The outcome an eval criterion belongs to. */
export function outcomeOf(state, criterionId) {
  return find(state, 'outcomes', find(state, 'criteria', criterionId)?.outcomeId);
}

// ---------- lesson calendar (placements) ----------
// A placement puts one eval criterion on the calendar for a school + grade,
// from startDate to endDate (inclusive).

export function placementsFor(state, yearId, schoolId, gradeId) {
  return state.placements.filter(
    (p) => p.yearId === yearId && p.schoolId === schoolId && p.gradeId === gradeId,
  );
}

export function placeCriterion(state, { yearId, schoolId, gradeId, criterionId, startDate, endDate = startDate }) {
  return add(state, 'placements', { yearId, schoolId, gradeId, criterionId, startDate, endDate });
}

// ---------- date ranges (placements and instrument blocks) ----------

/** Move a dated record so it starts on `startDate`, keeping its length. */
export function moveRange(state, collection, id, startDate) {
  const r = find(state, collection, id);
  if (!r) return null;
  const length = daysBetween(r.startDate, r.endDate);
  return update(state, collection, id, { startDate, endDate: addDays(startDate, length) });
}

/** Change a dated record's first and/or last day (they're swapped if reversed). */
export function resizeRange(state, collection, id, { startDate, endDate }) {
  const r = find(state, collection, id);
  if (!r) return null;
  const [a, b] = [startDate ?? r.startDate, endDate ?? r.endDate].sort();
  return update(state, collection, id, { startDate: a, endDate: b });
}

export function movePlacement(state, placementId, startDate) {
  return moveRange(state, 'placements', placementId, startDate);
}

export function resizePlacement(state, placementId, dates) {
  return resizeRange(state, 'placements', placementId, dates);
}

export function coversDate(p, date) {
  return p.startDate <= date && date <= p.endDate;
}

// ---------- instrument schedule ----------

export function blocksFor(state, yearId, schoolId, instrumentId) {
  return state.instrumentBlocks
    .filter((b) => b.yearId === yearId && b.schoolId === schoolId && b.instrumentId === instrumentId)
    .sort((a, b) => a.startDate.localeCompare(b.startDate));
}

/** Put an instrument at a school from startDate to endDate (inclusive). */
export function addInstrumentBlock(state, { yearId, schoolId, instrumentId, startDate, endDate = startDate }) {
  return add(state, 'instrumentBlocks', { yearId, schoolId, instrumentId, startDate, endDate });
}

/** Ids of instruments scheduled at a school on a date. */
export function instrumentsAt(state, yearId, schoolId, date) {
  const ids = state.instrumentBlocks
    .filter((b) => b.yearId === yearId && b.schoolId === schoolId && b.startDate <= date && date <= b.endDate)
    .map((b) => b.instrumentId);
  return [...new Set(ids)];
}

/**
 * Turn school days on (on=true) or off for an instrument at a school.
 * Stored as date ranges; neighbouring school days merge into one range.
 */
export function paintInstrument(state, { yearId, schoolId, instrumentId, dates, on }) {
  const blocks = blocksFor(state, yearId, schoolId, instrumentId);
  const days = new Set(blocks.flatMap((b) => weekdaysBetween(b.startDate, b.endDate)));
  dates.filter(isWeekday).forEach((d) => (on ? days.add(d) : days.delete(d)));
  const blockIds = new Set(blocks.map((b) => b.id));
  state.instrumentBlocks = state.instrumentBlocks.filter((b) => !blockIds.has(b.id));
  for (const [startDate, endDate] of toRanges([...days])) {
    add(state, 'instrumentBlocks', { yearId, schoolId, instrumentId, startDate, endDate });
  }
}

/** Group school days into [start, end] runs with no school day missing. */
export function toRanges(dates) {
  const sorted = [...dates].sort();
  const ranges = [];
  for (const d of sorted) {
    const last = ranges.at(-1);
    if (last && nextWeekday(last[1]) === d) last[1] = d;
    else ranges.push([d, d]);
  }
  return ranges;
}

// ---------- warnings ----------

/**
 * Lessons in a placement that use an instrument the school does not have
 * on one or more of its school days.
 * Returns [{ criterion, step, lesson, instrument, blocks, missingDates }].
 */
export function placementWarnings(state, placement) {
  const { yearId, schoolId, startDate, endDate } = placement;
  const criterion = find(state, 'criteria', placement.criterionId);
  const days = weekdaysBetween(startDate, endDate);
  const warnings = [];
  for (const step of stepsFor(state, placement.criterionId)) {
    const lesson = find(state, 'lessons', step.lessonId);
    for (const instrumentId of lesson?.instrumentIds ?? []) {
      const missingDates = days.filter((d) => !instrumentsAt(state, yearId, schoolId, d).includes(instrumentId));
      if (!missingDates.length) continue;
      const instrument = find(state, 'instruments', instrumentId);
      warnings.push({ criterion, step, lesson, instrument, blocks: blocksFor(state, yearId, schoolId, instrumentId), missingDates });
    }
  }
  return warnings;
}

// ---------- lessons (slide decks) ----------

export function lessonInstruments(state, lesson) {
  return (lesson?.instrumentIds ?? []).map((id) => find(state, 'instruments', id)).filter(Boolean);
}

/**
 * The values a lesson fills in automatically. `step` is { lessonId, criterionId? };
 * `placement` (optional) supplies school, grade and dates.
 * `date` is an ISO date, or an ISO interval "start/end" for several days.
 */
export function autoFill(state, step, placement) {
  const lesson = find(state, 'lessons', step.lessonId);
  if (!lesson) return [];
  const criterion = find(state, 'criteria', step.criterionId ?? placement?.criterionId);
  const values = {
    ...scheduleValues(state, placement),
    instrument: lessonInstruments(state, lesson).map((i) => i.name).join(', '),
    outcome: outcomeLabel(find(state, 'outcomes', criterion?.outcomeId)),
    criterion: criterion?.title,
  };
  return lesson.autoFields.map((key) => ({ key, label: AUTO_FIELDS[key], value: values[key] ?? '' }));
}

function scheduleValues(state, placement) {
  if (!placement) return {};
  const { startDate, endDate } = placement;
  return {
    school: find(state, 'schools', placement.schoolId)?.name,
    grade: find(state, 'grades', placement.gradeId)?.name,
    date: startDate === endDate ? startDate : `${startDate}/${endDate}`,
  };
}

/** Lessons of a year, alphabetical, grouped by category ('' = no category, listed last). */
export function lessonsByCategory(state, yearId) {
  const sorted = inYear(state, 'lessons', yearId)
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
  const groups = Map.groupBy(sorted, (l) => l.category || '');
  return [...groups.entries()]
    .sort(([a], [b]) => (a === '') - (b === '') || a.localeCompare(b))
    .map(([category, lessons]) => ({ category, lessons }));
}

/** The evals a lesson is taught in: [{ criterion, outcome, positions: [1-based] }]. */
export function lessonEvals(state, lessonId) {
  const steps = state.criterionLessons.filter((s) => s.lessonId === lessonId);
  return [...Map.groupBy(steps, (s) => s.criterionId).entries()].map(([criterionId, list]) => {
    const criterion = find(state, 'criteria', criterionId);
    const order = stepsFor(state, criterionId);
    return {
      criterion,
      outcome: find(state, 'outcomes', criterion?.outcomeId),
      positions: list.map((s) => order.indexOf(s) + 1).sort((a, b) => a - b),
    };
  });
}

/**
 * Where a lesson is used, by grade, following lesson → eval steps → eval
 * criteria → their grades and essential outcome:
 * [{ grade, outcomes: [{ outcome, evals: [{ criterion, positions }] }] }].
 * Grades and outcomes keep their usual order; evals with no grade yet come last (grade null).
 */
export function lessonUsageByGrade(state, lessonId) {
  const evals = lessonEvals(state, lessonId).filter((e) => e.criterion);
  const groups = state.grades
    .map((grade) => ({ grade, evals: evals.filter((e) => e.criterion.gradeIds.includes(grade.id)) }))
    .filter((g) => g.evals.length);
  const ungraded = evals.filter((e) => !e.criterion.gradeIds.length);
  if (ungraded.length) groups.push({ grade: null, evals: ungraded });
  return groups.map(({ grade, evals: list }) => ({ grade, outcomes: groupByOutcome(state, list) }));
}

function groupByOutcome(state, evals) {
  const order = (outcome) => state.outcomes.indexOf(outcome);
  return [...Map.groupBy(evals, (e) => e.outcome).entries()]
    .sort(([a], [b]) => order(a) - order(b))
    .map(([outcome, list]) => ({ outcome, evals: list }));
}

export function duplicateLesson(state, lessonId) {
  const { id: _id, copiedFromId: _from, ...rest } = find(state, 'lessons', lessonId);
  return add(state, 'lessons', { ...structuredClone(rest), name: `${rest.name} (copy)` });
}

export function outcomeLabel(outcome) {
  if (!outcome) return '';
  return outcome.code ? `${outcome.code} · ${outcome.title}` : outcome.title;
}

/** The school day before/after a date, used for keyboard nudging. */
export function shiftSchoolDay(date, direction) {
  let d = addDays(date, direction);
  while (!isWeekday(d)) d = addDays(d, direction);
  return d;
}
