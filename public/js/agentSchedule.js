// Assistant commands for the three calendars: the Lesson Schedule, the Outcome & Eval
// Calendar and the Instrument Schedule. See agentCommands.js for how commands are run.

import { weekdaysBetween } from './dates.js';
import {
  blocksFor, find, outcomeLabel, outcomeOf, paintInstrument, placeCriterion, placementWarnings, placementsFor, remove, resizeRange,
} from './model.js';
import {
  addWeekLesson, autoFillWeek, autoFillWeeks, entryCriterion, moveWeekLesson, placementsInWeek, removeWeekLesson,
  schoolWeeks, weekLessonsFor,
} from './weekPlan.js';
import {
  classOf, dateIn, evalOf, indexOf, instrument, lesson, ofYear, record, school, weekOf, year,
} from './agentHelpers.js';

function placementInfo(state, p) {
  return {
    id: p.id, eval: find(state, 'criteria', p.criterionId)?.title, outcome: outcomeLabel(outcomeOf(state, p.criterionId)),
    startDate: p.startDate, endDate: p.endDate,
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

/** Every class (school + grade) of the year. */
function allClasses(state) {
  const yearId = year(state).id;
  return ofYear(state, 'schools').flatMap((s) => ofYear(state, 'grades').map((g) => ({ yearId, schoolId: s.id, gradeId: g.id, school: s, grade: g })));
}

const CLASS = { school: ['School name', true], grade: ['Grade name', true] };
const WEEK = ['Week number or a date in that week', true];

export const SCHEDULE_COMMANDS = {
  getSchedule: {
    summary: 'The Lesson Schedule for one class: each school week with its lessons in order (entryId is needed to move or remove one).',
    params: { ...CLASS, fromWeek: ['First week (number or date); default week 1'], toWeek: ['Last week (number or date); default the last week'] },
    run: (state, a) => {
      const cls = classOf(state, a);
      const weeks = schoolWeeks(year(state));
      const from = a.fromWeek ? weekOf(state, a.fromWeek).number : 1;
      const to = a.toWeek ? weekOf(state, a.toWeek).number : weeks.length;
      return weeks.filter((w) => w.number >= from && w.number <= to).map((w) => weekInfo(state, cls, w));
    },
  },
  getWeek: {
    summary: 'One school week for every class: the lessons each class has that week and the evals on the calendar.',
    params: { week: WEEK },
    run: (state, a) => {
      const week = weekOf(state, a.week);
      return {
        week: week.number, weekStart: week.weekStart,
        classes: allClasses(state).map((c) => {
          const { lessons, evalsOnCalendar } = weekInfo(state, c, week);
          return { school: c.school.name, grade: c.grade.name, lessons, evalsOnCalendar };
        }).filter((c) => c.lessons.length || c.evalsOnCalendar.length),
      };
    },
  },
  addLessonToWeek: {
    summary: 'Put a lesson on a class\'s Lesson Schedule in a week.',
    changes: true,
    params: { ...CLASS, week: WEEK, lesson: ['Lesson name', true], eval: ['The eval it is taught for'], position: ['Place in the week (1 = first); default last'] },
    run: (state, a) => {
      const week = weekOf(state, a.week);
      const entry = addWeekLesson(state, {
        ...classOf(state, a), weekStart: week.weekStart, lessonId: lesson(state, a.lesson).id,
        criterionId: a.eval ? evalOf(state, a.eval).id : null, index: indexOf(a.position),
      });
      return { entryId: entry.id, done: `Added "${a.lesson}" to week ${week.number}.` };
    },
  },
  moveScheduledLesson: {
    summary: 'Move a lesson on the Lesson Schedule to another week and/or place in the week.',
    changes: true,
    params: { entryId: ['From getSchedule', true], week: WEEK, position: ['Place in the week (1 = first); default last'] },
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
    params: { ...CLASS, week: WEEK },
    run: (state, a) => ({ lessonsPlaced: autoFillWeek(state, classOf(state, a), schoolWeeks(year(state)), weekOf(state, a.week).weekStart) }),
  },
  fillScheduleFromCalendar: {
    summary: 'Fill a class\'s whole Lesson Schedule from the Outcome & Eval Calendar, replacing everything on it. Leave out school and grade to fill every class.',
    changes: true,
    params: { school: ['School name; leave out (with grade) for every class'], grade: ['Grade name'] },
    run: (state, a) => {
      const classes = a.school || a.grade ? [classOf(state, a)] : allClasses(state);
      const weeks = schoolWeeks(year(state));
      return { lessonsPlaced: classes.reduce((sum, cls) => sum + autoFillWeeks(state, cls, weeks), 0) };
    },
  },
  getCalendar: {
    summary: 'The Outcome & Eval Calendar for one class: each eval placed on it with its dates and any instrument warnings.',
    params: CLASS,
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
    params: { ...CLASS, eval: ['Eval title', true], startDate: ['First day, e.g. 2026-09-14', true], endDate: ['Last day; default the first day'] },
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
  removeEvalFromCalendar: {
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
      return ofYear(state, 'instruments').map((i) => ({
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
