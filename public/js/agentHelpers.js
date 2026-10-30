// Shared pieces for the assistant commands (agentCommands.js and the agent*.js areas):
// finding things the way the teacher names them, checking dates and weeks, and
// describing records as plain JSON. Shared by the browser app and the Node tests.

import { mondayOf } from './dates.js';
import { activeYear, find, inYear, outcomeLabel, outcomeOf, stepsFor } from './model.js';
import { schoolWeeks } from './weekPlan.js';
import { folderPath, IMAGE_SHELF, LESSON_SHELF } from './library.js';

/** A command's problem, worded for the person reading the assistant's reply. */
export class CommandError extends Error {}

export const fail = (message) => { throw new CommandError(message); };

// ---------- finding things by name or id ----------

const same = (a, b) => String(a ?? '').trim().toLowerCase() === String(b ?? '').trim().toLowerCase();

const isBlank = (v) => v === undefined || v === null || v === '';

/** One record from `list` whose id or any of `fields` matches `ref`. */
export function pick(list, ref, what, fields = ['name']) {
  if (isBlank(ref)) fail(`Please say which ${what}.`);
  const byId = list.find((r) => r.id === ref);
  if (byId) return byId;
  const matches = list.filter((r) => fields.some((f) => same(r[f], ref)));
  if (matches.length === 1) return matches[0];
  const choices = list.map((r) => r[fields[0]]).filter(Boolean).join(', ');
  if (!matches.length) fail(`No ${what} called "${ref}". Choices: ${choices || 'none yet'}.`);
  return fail(`More than one ${what} is called "${ref}" — please use its id.`);
}

/** A list argument: an array, or one value on its own. */
export const listOf = (value) => {
  if (isBlank(value)) return [];
  return Array.isArray(value) ? value : [value];
};

/** Several records, each found with `one(state, ref)`; returns their ids. */
export const idsOf = (state, refs, one) => [...new Set(listOf(refs).map((r) => one(state, r).id))];

export function year(state) {
  return activeYear(state) || fail('This plan has no school year yet.');
}

export const ofYear = (state, collection) => inYear(state, collection, year(state).id);

export const school = (state, ref) => pick(ofYear(state, 'schools'), ref, 'school');
export const grade = (state, ref) => pick(ofYear(state, 'grades'), ref, 'grade', ['name', 'short']);
export const lesson = (state, ref) => pick(ofYear(state, 'lessons'), ref, 'lesson');
export const instrument = (state, ref) => pick(ofYear(state, 'instruments'), ref, 'instrument');
export const outcome = (state, ref) => pick(ofYear(state, 'outcomes'), ref, 'outcome', ['code', 'title']);
export const image = (state, ref) => pick(ofYear(state, 'images'), ref, 'picture');
export const tagGroup = (state, ref) => pick(ofYear(state, 'tagGroups'), ref, 'tag category');
export const holiday = (state, ref) => pick(ofYear(state, 'holidays'), ref, 'event you added');

/** A tag by name, id, or "Category: tag" when two categories share a tag name. */
export function tag(state, ref) {
  const tags = ofYear(state, 'tags');
  const [groupName, tagName] = String(ref ?? '').split(/:\s*/);
  if (tagName !== undefined && !tags.some((t) => t.id === ref)) {
    const group = tagGroup(state, groupName);
    return pick(tags.filter((t) => t.groupId === group.id), tagName, `tag in ${group.name}`);
  }
  return pick(tags, ref, 'tag');
}

export function yearCriteria(state) {
  const outcomeIds = new Set(ofYear(state, 'outcomes').map((o) => o.id));
  return state.criteria.filter((c) => outcomeIds.has(c.outcomeId));
}

export const evalOf = (state, ref) => pick(yearCriteria(state), ref, 'eval', ['title']);

/** Lesson decks ('lessons', the default) or pictures ('images'): which folders and items. */
export function shelfOf(kind) {
  if (isBlank(kind) || same(kind, 'lessons')) return LESSON_SHELF;
  if (same(kind, 'images') || same(kind, 'pictures')) return IMAGE_SHELF;
  return fail('kind should be "lessons" or "images".');
}

export const folder = (state, ref, shelf = LESSON_SHELF) => pick(ofYear(state, shelf.folders), ref, 'folder');

export function classOf(state, args) {
  return { yearId: year(state).id, schoolId: school(state, args.school).id, gradeId: grade(state, args.grade).id };
}

/** A record by id, checked to belong to the open year. */
export function record(state, collection, id, what) {
  const r = find(state, collection, id);
  if (!r || (r.yearId && r.yearId !== year(state).id)) fail(`No ${what} with id "${id}".`);
  return r;
}

// ---------- values ----------

const ISO = /^\d{4}-\d{2}-\d{2}$/;

export function dateIn(state, value, what = 'date') {
  const y = year(state);
  if (!ISO.test(value ?? '')) fail(`The ${what} should look like 2026-09-14.`);
  if (value < y.startDate || value > y.endDate) fail(`${value} is outside the school year (${y.startDate} to ${y.endDate}).`);
  return value;
}

/** A date anywhere (not only inside the school year), e.g. for the year's own first and last day. */
export function anyDate(value, what = 'date') {
  if (!ISO.test(value ?? '')) fail(`The ${what} should look like 2026-09-14.`);
  return value;
}

/** A school week, given by its number (1 = first week) or any date inside it. */
export function weekOf(state, ref) {
  const weeks = schoolWeeks(year(state));
  const byNumber = typeof ref === 'number' || /^\d+$/.test(String(ref ?? ''));
  const week = byNumber
    ? weeks.find((w) => w.number === Number(ref))
    : ISO.test(ref ?? '') && weeks.find((w) => w.weekStart === mondayOf(ref));
  return week || fail(`No school week "${ref}". Use a week number from 1 to ${weeks.length}, or a date like 2026-09-14.`);
}

/** 1-based position from the person's point of view → 0-based index (undefined = at the end). */
export const indexOf = (position) => (isBlank(position) ? undefined : Math.max(0, Number(position) - 1));

export function color(value) {
  if (!/^#[0-9a-f]{6}$/i.test(value ?? '')) fail('Colors look like #6b8f5e.');
  return value;
}

export function text(value, what) {
  const t = String(value ?? '').trim();
  return t || fail(`Please give the ${what}.`);
}

/** Only the keys of `args` that were given, renamed/converted by `fields` (key → convert). */
export function patchFrom(args, fields) {
  return Object.fromEntries(Object.entries(fields)
    .filter(([key]) => args[key] !== undefined)
    .map(([key, convert]) => [key, convert(args[key])]));
}

// ---------- describing things ----------

export const namesOf = (state, collection, ids) => ids.map((id) => find(state, collection, id)?.name).filter(Boolean);

export function lessonInfo(state, l) {
  return {
    id: l.id, name: l.name, category: l.category,
    instruments: namesOf(state, 'instruments', l.instrumentIds),
    folder: folderPath(state, l.folderId).map((f) => f.name).join(' › ') || null,
    ...(l.isNew ? { isNew: true } : {}),
  };
}

/**
 * An eval for the assistant. Each grade has its own lesson order: `lessons` when they're all the
 * same (or for `gradeId` only), otherwise `lessonsByGrade` (grade name → lessons).
 */
export function evalInfo(state, c, gradeId) {
  const order = (g) => namesOf(state, 'lessons', stepsFor(state, c.id, g).map((s) => s.lessonId));
  const grades = gradeId ? [gradeId] : c.gradeIds;
  const orders = grades.length ? grades.map((g) => [find(state, 'grades', g)?.name, order(g)]) : [[null, order(null)]];
  const same = orders.every(([, list]) => list.join('\n') === orders[0][1].join('\n'));
  return {
    id: c.id, title: c.title, outcome: outcomeLabel(outcomeOf(state, c.id)),
    grades: namesOf(state, 'grades', c.gradeIds),
    ...(c.mainGradeId ? { mainGrade: find(state, 'grades', c.mainGradeId)?.name } : {}),
    ...(same ? { lessons: orders[0][1] } : { lessonsByGrade: Object.fromEntries(orders) }),
  };
}

/** The grades a lesson-order command changes: the one asked for (it must be one of the eval's), or all of them. */
export function orderGrades(state, c, ref) {
  if (!ref) return c.gradeIds.length ? c.gradeIds : [null];
  const g = grade(state, ref);
  if (!c.gradeIds.includes(g.id)) fail(`${c.title} isn't for ${g.name}. Its grades: ${namesOf(state, 'grades', c.gradeIds).join(', ') || 'none yet'}.`);
  return [g.id];
}
