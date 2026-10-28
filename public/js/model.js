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

export const SCHEMA_VERSION = 2;

/** Default colors handed out to new outcomes and instruments (earthy & royal). */
export const PALETTE = ['#6b8f5e', '#6a4c93', '#b5654a', '#3f6e8c', '#c49a3a', '#8c4f6b', '#4f7d7a', '#7a6248'];

/** Collections and what each record looks like (documentation + normalizing). */
export const COLLECTIONS = {
  years: 'id, name, startDate, endDate',
  instruments: 'id, yearId, name, color',
  schools: 'id, yearId, name',
  grades: 'id, yearId, name, short',
  outcomes: 'id, yearId, code, title, color',
  templates: 'id, yearId, name, category, autoFields[]',
  criteria: 'id, outcomeId, title, gradeIds[]',
  slides: 'id, criterionId, title, templateId?, instrumentId?, position',
  placements: 'id, yearId, schoolId, gradeId, criterionId, startDate, endDate',
  instrumentBlocks: 'id, yearId, schoolId, instrumentId, startDate, endDate',
};

/** Collections that roll over (are copied) when a new year is created. */
export const ROLLOVER = ['instruments', 'schools', 'grades', 'templates', 'outcomes'];

/** Template fields that are filled in automatically from the schedule. */
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
    ['templates', 'yearId', 'delete'], ['placements', 'yearId', 'delete'],
    ['instrumentBlocks', 'yearId', 'delete'],
  ],
  instruments: [['instrumentBlocks', 'instrumentId', 'delete'], ['slides', 'instrumentId', 'null']],
  schools: [['placements', 'schoolId', 'delete'], ['instrumentBlocks', 'schoolId', 'delete']],
  grades: [['placements', 'gradeId', 'delete'], ['criteria', 'gradeIds', 'pull']],
  outcomes: [['criteria', 'outcomeId', 'delete']],
  templates: [['slides', 'templateId', 'null']],
  criteria: [['slides', 'criterionId', 'delete'], ['placements', 'criterionId', 'delete']],
};

export function newId(prefix) {
  const rand = Math.random().toString(36).slice(2, 8);
  return `${prefix}_${Date.now().toString(36)}${rand}`;
}

const PREFIX = {
  years: 'yr', instruments: 'ins', schools: 'sch', grades: 'gr', outcomes: 'out',
  templates: 'tpl', criteria: 'crit', slides: 'sld', placements: 'plc', instrumentBlocks: 'blk',
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
  state.templates.forEach((t) => {
    if (!Array.isArray(t.autoFields)) t.autoFields = [];
    if (typeof t.category !== 'string') t.category = '';
  });
  if ((state.schemaVersion || 1) < 2) migrateToV2(state);
  for (const year of state.years) assignOutcomeColors(state, year.id);
  if (!state.years.some((y) => y.id === state.activeYearId)) {
    state.activeYearId = state.years.at(-1)?.id ?? null;
  }
  state.schemaVersion = SCHEMA_VERSION;
  return state;
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
  if (collection === 'slides') renumberSlides(state, record.criterionId);
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
 * schools, grades, templates and essential outcomes (with their eval
 * criteria and lesson slides) are copied over. Calendars start empty.
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
    for (const slide of slidesFor(state, crit.id)) {
      add(state, 'slides', {
        criterionId: newCrit.id,
        title: slide.title,
        templateId: mapId(slide.templateId),
        instrumentId: mapId(slide.instrumentId),
        position: slide.position,
        copiedFromId: slide.id,
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

// ---------- outcomes, criteria, slides ----------

export function criteriaFor(state, outcomeId) {
  return state.criteria.filter((c) => c.outcomeId === outcomeId);
}

/** Lesson slides for an eval criterion, in their teaching order. */
export function slidesFor(state, criterionId) {
  return state.slides
    .filter((s) => s.criterionId === criterionId)
    .sort((a, b) => a.position - b.position);
}

export function addSlide(state, criterionId, fields = {}) {
  const position = slidesFor(state, criterionId).length;
  return add(state, 'slides', {
    criterionId, title: 'New slide', templateId: null, instrumentId: null, ...fields, position,
  });
}

/** Move a slide to a new place (0-based) in its criterion's order. */
export function moveSlide(state, slideId, newIndex) {
  const slide = find(state, 'slides', slideId);
  if (!slide) return;
  const ordered = slidesFor(state, slide.criterionId).filter((s) => s.id !== slideId);
  const index = Math.max(0, Math.min(newIndex, ordered.length));
  ordered.splice(index, 0, slide);
  ordered.forEach((s, i) => { s.position = i; });
}

function renumberSlides(state, criterionId) {
  slidesFor(state, criterionId).forEach((s, i) => { s.position = i; });
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

/** Move a placement so it starts on `startDate`, keeping its length. */
export function movePlacement(state, placementId, startDate) {
  const p = find(state, 'placements', placementId);
  if (!p) return null;
  const length = daysBetween(p.startDate, p.endDate);
  return update(state, 'placements', placementId, { startDate, endDate: addDays(startDate, length) });
}

/** Change a placement's first and/or last day (they're swapped if reversed). */
export function resizePlacement(state, placementId, { startDate, endDate }) {
  const p = find(state, 'placements', placementId);
  if (!p) return null;
  const [a, b] = [startDate ?? p.startDate, endDate ?? p.endDate].sort();
  return update(state, 'placements', placementId, { startDate: a, endDate: b });
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
 * Lesson slides in a placement that need an instrument the school does not
 * have on one or more of its school days.
 * Returns [{ criterion, slide, instrument, blocks, missingDates }].
 */
export function placementWarnings(state, placement) {
  const { yearId, schoolId, startDate, endDate } = placement;
  const criterion = find(state, 'criteria', placement.criterionId);
  const days = weekdaysBetween(startDate, endDate);
  const warnings = [];
  for (const slide of slidesFor(state, placement.criterionId)) {
    if (!slide.instrumentId) continue;
    const missingDates = days.filter((d) => !instrumentsAt(state, yearId, schoolId, d).includes(slide.instrumentId));
    if (!missingDates.length) continue;
    const instrument = find(state, 'instruments', slide.instrumentId);
    const blocks = blocksFor(state, yearId, schoolId, slide.instrumentId);
    warnings.push({ criterion, slide, instrument, blocks, missingDates });
  }
  return warnings;
}

// ---------- templates ----------

/**
 * The values a slide's template fills in automatically for a placement.
 * `date` is an ISO date, or an ISO interval "start/end" for several days.
 */
export function autoFill(state, slide, placement) {
  const template = find(state, 'templates', slide.templateId);
  if (!template) return [];
  const criterion = find(state, 'criteria', slide.criterionId);
  const values = {
    ...scheduleValues(state, placement),
    instrument: find(state, 'instruments', slide.instrumentId)?.name,
    outcome: outcomeLabel(find(state, 'outcomes', criterion?.outcomeId)),
    criterion: criterion?.title,
  };
  return template.autoFields.map((key) => ({ key, label: AUTO_FIELDS[key], value: values[key] ?? '' }));
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

/** Templates of a year, alphabetical, grouped by category ('' = no category, listed last). */
export function templatesByCategory(state, yearId) {
  const sorted = inYear(state, 'templates', yearId)
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
  const groups = Map.groupBy(sorted, (t) => t.category || '');
  return [...groups.entries()]
    .sort(([a], [b]) => (a === '') - (b === '') || a.localeCompare(b))
    .map(([category, templates]) => ({ category, templates }));
}

/** Where a template is used: [{ slide, criterion, outcome }]. */
export function templateUsage(state, templateId) {
  return state.slides
    .filter((s) => s.templateId === templateId)
    .map((slide) => {
      const criterion = find(state, 'criteria', slide.criterionId);
      return { slide, criterion, outcome: find(state, 'outcomes', criterion?.outcomeId) };
    });
}

export function duplicateTemplate(state, templateId) {
  const { id: _id, copiedFromId: _from, ...rest } = find(state, 'templates', templateId);
  return add(state, 'templates', { ...structuredClone(rest), name: `${rest.name} (copy)` });
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
