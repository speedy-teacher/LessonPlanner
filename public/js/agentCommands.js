// Commands an AI assistant (e.g. Claude in Chrome, or Gemini in Chrome once it can) runs
// on the open plan instead of clicking around the screen. Each takes plain arguments —
// things are named the way the teacher sees them ("Grade 3", "Hot Cross Buns"), or by
// id — and returns plain JSON. Every screen's changes have a command, in one file per area:
//   agentSchedule.js  Lesson Schedule, Outcome & Eval Calendar, Instrument Schedule
//   agentSetup.js     School Year: dates, schools, grades, instruments, events
//   agentOutcomes.js  Outcomes, evals and each eval's lesson order
//   agentLessons.js   Lesson templates and folders
//   agentImages.js    Images tab: pictures, tags, when to use them
//   agentReports.js   Reports tab: what a report covers, weekly reports
// Everything works on the plan's active school year. `runCommands` runs a list of
// commands on a copy of the data, so either all of them work or nothing changes; the
// browser (agentBridge.js) then saves it as one undoable change.
//
// Shared by the browser app and the Node tests.

import { COLLECTIONS, outcomeLabel } from './model.js';
import { schoolWeeks } from './weekPlan.js';
import { CommandError, fail, ofYear, year } from './agentHelpers.js';
import { SCHEDULE_COMMANDS } from './agentSchedule.js';
import { SETUP_COMMANDS } from './agentSetup.js';
import { OUTCOME_COMMANDS } from './agentOutcomes.js';
import { LESSON_COMMANDS } from './agentLessons.js';
import { IMAGE_COMMANDS } from './agentImages.js';
import { REPORT_COMMANDS } from './agentReports.js';

export { CommandError };

/** Things only the teacher can do (Google asks a person to click), for the assistant to say so. */
export const NEEDS_THE_TEACHER = [
  'Signing in to Google Drive',
  'Bringing in lesson decks or pictures from Google Drive or the computer (the Add button)',
  'Choosing the folder for lesson copies, or moving the plan to another folder',
  'Making a report in Google Drive (the Make button on the Reports tab) or choosing the folder it goes in',
  'Starting a new school year (it becomes a new plan file) or opening another plan',
];

const GENERAL_COMMANDS = {
  overview: {
    summary: 'Start here: the open school year, its dates and weeks, schools, grades, instruments, outcomes, and how many lessons and pictures it has.',
    params: {},
    run: (state) => {
      const y = year(state);
      const names = (collection) => ofYear(state, collection).map((r) => r.name);
      return {
        year: y.name, startDate: y.startDate, endDate: y.endDate, weeks: schoolWeeks(y).length,
        schools: names('schools'), grades: names('grades'), instruments: names('instruments'),
        outcomes: ofYear(state, 'outcomes').map((o) => ({ id: o.id, label: outcomeLabel(o) })),
        lessonCount: ofYear(state, 'lessons').length, pictureCount: ofYear(state, 'images').length,
        onlyTheTeacherCanDo: NEEDS_THE_TEACHER,
      };
    },
  },
  findRecords: {
    summary: 'Read raw records of any kind when no other command shows what you need. Collections and their fields: see "collections" in help().',
    params: { collection: ['e.g. weekLessons', true], where: ['Fields that must match, e.g. { "lessonId": "les_…" }'] },
    run: (state, a) => {
      if (!COLLECTIONS[a.collection] || a.collection === 'years') fail(`Collections: ${Object.keys(COLLECTIONS).join(', ')}.`);
      const where = Object.entries(a.where ?? {});
      const list = state[a.collection].filter((r) => !r.yearId || r.yearId === year(state).id);
      return list.filter((r) => where.every(([k, v]) => r[k] === v || (Array.isArray(r[k]) && r[k].includes(v))));
    },
  },
};

const AREAS = {
  'Getting started': GENERAL_COMMANDS,
  'Lesson Schedule, Outcome & Eval Calendar, Instrument Schedule': SCHEDULE_COMMANDS,
  'School Year setup': SETUP_COMMANDS,
  'Outcomes, evals & lesson order': OUTCOME_COMMANDS,
  'Lesson templates & folders': LESSON_COMMANDS,
  'Images (pictures, tags, timing)': IMAGE_COMMANDS,
  Reports: REPORT_COMMANDS,
};

export const COMMANDS = Object.assign({}, ...Object.values(AREAS));

/** What the commands are and what they take, for an assistant to read. */
export function describeCommands() {
  return Object.entries(AREAS).flatMap(([area, commands]) => Object.entries(commands).map(([name, c]) => ({
    name, area, summary: c.summary, changesThePlan: Boolean(c.changes),
    params: Object.fromEntries(Object.entries(c.params).map(([p, [about, required]]) => [p, required ? `${about} (required)` : about])),
  })));
}

function checkRequired(name, command, args) {
  const missing = Object.entries(command.params).filter(([p, [, required]]) => required && (args[p] ?? '') === '').map(([p]) => p);
  if (missing.length) fail(`${name} needs: ${missing.join(', ')}.`);
}

/** Run one command on `state` (edited in place). Throws CommandError with a friendly message. */
export function runCommand(state, name, args = {}) {
  const command = Object.hasOwn(COMMANDS, name) ? COMMANDS[name] : fail(`There's no command called "${name}". Call help() for the list.`);
  checkRequired(name, command, args ?? {});
  return command.run(state, args ?? {});
}

export const changesPlan = (name) => Boolean(Object.hasOwn(COMMANDS, name) && COMMANDS[name].changes);

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
