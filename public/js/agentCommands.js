// Commands an AI assistant (e.g. Claude in Chrome) can run on the open plan,
// instead of clicking around the screen. Each command takes plain arguments —
// things are named the way the teacher sees them ("Grade 3", "Hot Cross Buns"),
// or by id — and returns plain JSON.
//
// Everything works on the plan's active school year. `runCommands` runs a list
// of commands on a copy of the data, so either all of them work or nothing
// changes; the browser (agentBridge.js) then saves it as one undoable change.
//
// Shared by the browser app and the Node tests.

import { mondayOf, weekdaysBetween } from './dates.js';
import {
  activeYear, find, inYear, outcomeLabel, outcomeOf, paintInstrument, placeCriterion, placementWarnings,
  placementsFor, remove, resizeRange, stepsFor, blocksFor,
} from './model.js';
import {
  addWeekLesson, autoFillWeek, autoFillWeeks, filterLessons, moveWeekLesson, placementsInWeek,
  removeWeekLesson, schoolWeeks, weekLessonsFor, entryCriterion,
} from './weekPlan.js';

/** A command's problem, worded for the person reading the assistant's reply. */
export class CommandError extends Error {}

const fail = (message) => { throw new CommandError(message); };

// ---------- finding things by name or id ----------

const same = (a, b) => String(a ?? '').trim().toLowerCase() === String(b ?? '').trim().toLowerCase();

/** One record from `list` whose id or any of `fields` matches `ref`. */
function pick(list, ref, what, fields = ['name']) {
  if (ref === undefined || ref === null || ref === '') fail(`Please say which ${what}.`);
  const byId = list.find((r) => r.id === ref);
  if (byId) return byId;
  const matches = list.filter((r) => fields.some((f) => same(r[f], ref)));
  if (matches.length === 1) return matches[0];
  const choices = list.map((r) => r[fields[0]]).filter(Boolean).join(', ');
  if (!matches.length) fail(`No ${what} called "${ref}". Choices: ${choices || 'none yet'}.`);
  return fail(`More than one ${what} is called "${ref}" — please use its id.`);
}

function year(state) {
  return activeYear(state) || fail('This plan has no school year yet.');
}

const school = (state, ref) => pick(inYear(state, 'schools', year(state).id), ref, 'school');
const grade = (state, ref) => pick(inYear(state, 'grades', year(state).id), ref, 'grade', ['name', 'short']);
const lesson = (state, ref) => pick(inYear(state, 'lessons', year(state).id), ref, 'lesson');
const instrument = (state, ref) => pick(inYear(state, 'instruments', year(state).id), ref, 'instrument');
const outcome = (state, ref) => pick(inYear(state, 'outcomes', year(state).id), ref, 'outcome', ['code', 'title']);

function yearCriteria(state) {
  const outcomeIds = new Set(inYear(state, 'outcomes', year(state).id).map((o) => o.id));
  return state.criteria.filter((c) => outcomeIds.has(c.outcomeId));
}

const evalOf = (state, ref) => pick(yearCriteria(state), ref, 'eval', ['title']);

function classOf(state, args) {
  return { yearId: year(state).id, schoolId: school(state, args.school).id, gradeId: grade(state, args.grade).id };
}

function record(state, collection, id, what) {
  const r = find(state, collection, id);
  if (!r || (r.yearId && r.yearId !== year(state).id)) fail(`No ${what} with id "${id}".`);
  return r;
}

// ---------- dates and weeks ----------

const ISO = /^\d{4}-\d{2}-\d{2}$/;

function dateIn(state, value, what = 'date') {
  const y = year(state);
  if (!ISO.test(value ?? '')) fail(`The ${what} should look like 2026-09-14.`);
  if (value < y.startDate || value > y.endDate) fail(`${value} is outside the school year (${y.startDate} to ${y.endDate}).`);
  return value;
}

/** A school week, given by its number (1 = first week) or any date inside it. */
function weekOf(state, ref) {
  const weeks = schoolWeeks(year(state));
  const byNumber = typeof ref === 'number' || /^\d+$/.test(String(ref ?? ''));
  const week = byNumber
    ? weeks.find((w) => w.number === Number(ref))
    : ISO.test(ref ?? '') && weeks.find((w) => w.weekStart === mondayOf(ref));
  return week || fail(`No school week "${ref}". Use a week number from 1 to ${weeks.length}, or a date like 2026-09-14.`);
}

/** 1-based position from the person's point of view → 0-based index (undefined = at the end). */
const indexOf = (position) => (position === undefined || position === null ? undefined : Math.max(0, Number(position) - 1));

// ---------- describing things ----------

const lessonInfo = (state, l) => ({
  id: l.id, name: l.name, category: l.category,
  instruments: l.instrumentIds.map((id) => find(state, 'instruments', id)?.name).filter(Boolean),
});

function evalInfo(state, c) {
  return {
    id: c.id, title: c.title, outcome: outcomeLabel(outcomeOf(state, c.id)),
    grades: c.gradeIds.map((id) => find(state, 'grades', id)?.name).filter(Boolean),
    lessons: stepsFor(state, c.id).map((s) => find(state, 'lessons', s.lessonId)?.name).filter(Boolean),
  };
}

function placementInfo(state, p) {
  const c = find(state, 'criteria', p.criterionId);
  return {
    id: p.id, eval: c?.title, outcome: outcomeLabel(outcomeOf(state, p.criterionId)), startDate: p.startDate, endDate: p.endDate,
    instrumentWarnings: placementWarnings(state, p).map((w) => `${w.lesson?.name} needs ${w.instrument?.name} on ${w.missingDates.length} day(s)`),
  };
}

function weekInfo(state, cls, week) {
  const placements = placementsInWeek(state, cls, week);
  return {
    week: week.number, weekStart: week.weekStart, schoolDays: week.days.length,
    lessons: weekLessonsFor(state, cls, week.weekStart).map((e, i) => ({
      entryId: e.id, position: i + 1, lesson: find(state, 'lessons', e.lessonId)?.name,
      eval: entryCriterion(state, e, placements)?.title ?? null,
    })),
    evalsOnCalendar: placements.map((p) => find(state, 'criteria', p.criterionId)?.title),
  };
}

const names = (state, collection) => inYear(state, collection, year(state).id).map((r) => r.name);

// ---------- the commands ----------
// `params`: name → [description, required?]. `changes`: whether the command edits the plan.

export const COMMANDS = {
  overview: {
    summary: 'The open school year: its dates, number of weeks, schools, grades, instruments, outcomes and how many lessons it has.',
    params: {},
    run: (state) => {
      const y = year(state);
      return {
        year: y.name, startDate: y.startDate, endDate: y.endDate, weeks: schoolWeeks(y).length,
        schools: names(state, 'schools'),
        grades: inYear(state, 'grades', y.id).map((g) => g.name),
        instruments: names(state, 'instruments'),
        outcomes: inYear(state, 'outcomes', y.id).map((o) => ({ id: o.id, label: outcomeLabel(o) })),
        lessonCount: inYear(state, 'lessons', y.id).length,
      };
    },
  },
  listLessons: {
    summary: 'Lesson templates (slide decks), optionally narrowed. With grade/outcome/eval, only lessons taught in matching evals, in teaching order.',
    params: {
      search: ['Words in the lesson name or category'], category: ['Category name'],
      grade: ['Grade name'], outcome: ['Outcome code or title'], eval: ['Eval title'],
    },
    run: (state, a) => filterLessons(state, year(state).id, {
      search: a.search ?? '', category: a.category ?? '',
      gradeId: a.grade ? grade(state, a.grade).id : '',
      outcomeId: a.outcome ? outcome(state, a.outcome).id : '',
      criterionId: a.eval ? evalOf(state, a.eval).id : '',
    }).map(({ lesson: l }) => lessonInfo(state, l)),
  },
  listEvals: {
    summary: 'Eval criteria with their outcome, grades and lessons in teaching order.',
    params: { grade: ['Only evals for this grade'], outcome: ['Only evals of this outcome'] },
    run: (state, a) => {
      const g = a.grade ? grade(state, a.grade) : null;
      const o = a.outcome ? outcome(state, a.outcome) : null;
      return yearCriteria(state)
        .filter((c) => (!g || c.gradeIds.includes(g.id)) && (!o || c.outcomeId === o.id))
        .map((c) => evalInfo(state, c));
    },
  },
  getSchedule: {
    summary: 'The Lesson Schedule for one class: each school week with its lessons in order (entryId is needed to move or remove one).',
    params: {
      school: ['School name', true], grade: ['Grade name', true],
      fromWeek: ['First week (number or date); default week 1'], toWeek: ['Last week (number or date); default the last week'],
    },
    run: (state, a) => {
      const cls = classOf(state, a);
      const weeks = schoolWeeks(year(state));
      const from = a.fromWeek ? weekOf(state, a.fromWeek).number : 1;
      const to = a.toWeek ? weekOf(state, a.toWeek).number : weeks.length;
      return weeks.filter((w) => w.number >= from && w.number <= to).map((w) => weekInfo(state, cls, w));
    },
  },
  addLessonToWeek: {
    summary: 'Put a lesson on a class\'s Lesson Schedule in a week.',
    changes: true,
    params: {
      school: ['School name', true], grade: ['Grade name', true], week: ['Week number or a date in that week', true],
      lesson: ['Lesson name', true], eval: ['The eval it is taught for'], position: ['Place in the week (1 = first); default last'],
    },
    run: (state, a) => {
      const cls = classOf(state, a);
      const entry = addWeekLesson(state, {
        ...cls, weekStart: weekOf(state, a.week).weekStart, lessonId: lesson(state, a.lesson).id,
        criterionId: a.eval ? evalOf(state, a.eval).id : null, index: indexOf(a.position),
      });
      return { entryId: entry.id, done: `Added "${a.lesson}" to week ${weekOf(state, a.week).number}.` };
    },
  },
  moveScheduledLesson: {
    summary: 'Move a lesson on the Lesson Schedule to another week and/or place in the week.',
    changes: true,
    params: { entryId: ['From getSchedule', true], week: ['Week number or a date in that week', true], position: ['Place in the week (1 = first); default last'] },
    run: (state, a) => {
      record(state, 'weekLessons', a.entryId, 'scheduled lesson');
      const week = weekOf(state, a.week);
      moveWeekLesson(state, a.entryId, week.weekStart, indexOf(a.position));
      return { done: `Moved to week ${week.number}.` };
    },
  },
  removeScheduledLesson: {
    summary: 'Take a lesson off the Lesson Schedule (the lesson template is kept).',
    changes: true,
    params: { entryId: ['From getSchedule', true] },
    run: (state, a) => {
      record(state, 'weekLessons', a.entryId, 'scheduled lesson');
      removeWeekLesson(state, a.entryId);
      return { done: 'Removed from the schedule.' };
    },
  },
  fillWeekFromCalendar: {
    summary: 'Fill one week of a class\'s Lesson Schedule from the Outcome & Eval Calendar, replacing that week.',
    changes: true,
    params: { school: ['School name', true], grade: ['Grade name', true], week: ['Week number or a date in that week', true] },
    run: (state, a) => {
      const placed = autoFillWeek(state, classOf(state, a), schoolWeeks(year(state)), weekOf(state, a.week).weekStart);
      return { lessonsPlaced: placed };
    },
  },
  fillScheduleFromCalendar: {
    summary: 'Fill a class\'s whole Lesson Schedule from the Outcome & Eval Calendar, replacing everything on it.',
    changes: true,
    params: { school: ['School name', true], grade: ['Grade name', true] },
    run: (state, a) => ({ lessonsPlaced: autoFillWeeks(state, classOf(state, a), schoolWeeks(year(state))) }),
  },
  getCalendar: {
    summary: 'The Outcome & Eval Calendar for one class: each eval placed on it with its dates and any instrument warnings.',
    params: { school: ['School name', true], grade: ['Grade name', true] },
    run: (state, a) => {
      const cls = classOf(state, a);
      return placementsFor(state, cls.yearId, cls.schoolId, cls.gradeId)
        .sort((p, q) => p.startDate.localeCompare(q.startDate))
        .map((p) => placementInfo(state, p));
    },
  },
  placeEval: {
    summary: 'Put an eval on a class\'s Outcome & Eval Calendar from one date to another.',
    changes: true,
    params: {
      school: ['School name', true], grade: ['Grade name', true], eval: ['Eval title', true],
      startDate: ['First day, e.g. 2026-09-14', true], endDate: ['Last day; default the first day'],
    },
    run: (state, a) => {
      const startDate = dateIn(state, a.startDate, 'start date');
      const endDate = a.endDate ? dateIn(state, a.endDate, 'end date') : startDate;
      const p = placeCriterion(state, { ...classOf(state, a), criterionId: evalOf(state, a.eval).id, startDate, endDate });
      resizeRange(state, 'placements', p.id, { startDate, endDate });
      return placementInfo(state, p);
    },
  },
  changeEvalDates: {
    summary: 'Change the first and/or last day of an eval on the calendar.',
    changes: true,
    params: { placementId: ['From getCalendar', true], startDate: ['New first day'], endDate: ['New last day'] },
    run: (state, a) => {
      record(state, 'placements', a.placementId, 'eval on the calendar');
      const startDate = a.startDate ? dateIn(state, a.startDate, 'start date') : undefined;
      const endDate = a.endDate ? dateIn(state, a.endDate, 'end date') : undefined;
      return placementInfo(state, resizeRange(state, 'placements', a.placementId, { startDate, endDate }));
    },
  },
  removeEval: {
    summary: 'Take an eval off the Outcome & Eval Calendar (the eval itself is kept).',
    changes: true,
    params: { placementId: ['From getCalendar', true] },
    run: (state, a) => {
      record(state, 'placements', a.placementId, 'eval on the calendar');
      remove(state, 'placements', a.placementId);
      return { done: 'Removed from the calendar.' };
    },
  },
  getInstrumentSchedule: {
    summary: 'The Instrument Schedule for one school: the date ranges each instrument is there.',
    params: { school: ['School name', true] },
    run: (state, a) => {
      const s = school(state, a.school);
      return inYear(state, 'instruments', year(state).id).map((i) => ({
        instrument: i.name,
        ranges: blocksFor(state, s.yearId, s.id, i.id).map((b) => ({ startDate: b.startDate, endDate: b.endDate })),
      }));
    },
  },
  setInstrumentDays: {
    summary: 'Mark an instrument as at a school (or not, with present: false) on every school day from one date to another.',
    changes: true,
    params: {
      school: ['School name', true], instrument: ['Instrument name', true],
      startDate: ['First day', true], endDate: ['Last day; default the first day'], present: ['true (default) or false'],
    },
    run: (state, a) => {
      const s = school(state, a.school);
      const startDate = dateIn(state, a.startDate, 'start date');
      const endDate = a.endDate ? dateIn(state, a.endDate, 'end date') : startDate;
      const dates = weekdaysBetween(...[startDate, endDate].sort());
      paintInstrument(state, { yearId: s.yearId, schoolId: s.id, instrumentId: instrument(state, a.instrument).id, dates, on: a.present !== false });
      return { done: `${a.instrument} ${a.present === false ? 'removed from' : 'added to'} ${s.name}, ${startDate} to ${endDate}.` };
    },
  },
};

/** What the commands are and what they take, for an assistant to read. */
export function describeCommands() {
  return Object.entries(COMMANDS).map(([name, c]) => ({
    name, summary: c.summary, changesThePlan: Boolean(c.changes),
    params: Object.fromEntries(Object.entries(c.params).map(([p, [text, required]]) => [p, required ? `${text} (required)` : text])),
  }));
}

function checkRequired(name, command, args) {
  const missing = Object.entries(command.params).filter(([p, [, required]]) => required && (args[p] ?? '') === '').map(([p]) => p);
  if (missing.length) fail(`${name} needs: ${missing.join(', ')}.`);
}

/** Run one command on `state` (edited in place). Throws CommandError with a friendly message. */
export function runCommand(state, name, args = {}) {
  const command = COMMANDS[name] || fail(`There's no command called "${name}". Commands: ${Object.keys(COMMANDS).join(', ')}.`);
  checkRequired(name, command, args);
  return command.run(state, args);
}

export const changesPlan = (name) => Boolean(COMMANDS[name]?.changes);

/**
 * Run a list of commands ([{ command, args }]) on a copy of `state`, in order.
 * All or nothing: returns { state: the changed copy, results, changed } — or throws,
 * naming which step failed, and the original is untouched.
 */
export function runCommands(state, steps) {
  const copy = structuredClone(state);
  const results = steps.map(({ command, args }, i) => {
    try {
      return runCommand(copy, command, args);
    } catch (err) {
      if (!(err instanceof CommandError) || steps.length === 1) throw err;
      throw new CommandError(`Step ${i + 1} (${command}): ${err.message} Nothing was changed.`);
    }
  });
  return { state: copy, results, changed: steps.some((s) => changesPlan(s.command)) };
}
