// Assistant commands for Setup › School Year: the year's dates, schools, grades,
// instruments and events (holidays and breaks). See agentCommands.js.

import { add, nextColor, remove, update } from './model.js';
import { yearEvents } from './schoolEvents.js';
import {
  anyDate, color, dateIn, fail, grade, holiday, instrument, patchFrom, school, text, year,
} from './agentHelpers.js';

/** The three simple lists on the School Year page. */
const LISTS = {
  schools: { find: school, what: 'school' },
  grades: { find: grade, what: 'grade' },
  instruments: { find: instrument, what: 'instrument' },
};

function listNamed(name) {
  const key = String(name ?? '').toLowerCase();
  return LISTS[key] ? [key, LISTS[key]] : fail('list should be "schools", "grades" or "instruments".');
}

function newItem(state, collection, a) {
  const base = { yearId: year(state).id, name: text(a.name, 'name') };
  if (collection === 'schools') return base;
  const colored = { ...base, color: a.color ? color(a.color) : nextColor(state, collection, base.yearId) };
  if (collection === 'grades') return { ...colored, short: a.short ?? base.name.replace(/^grade\s*/i, '').slice(0, 3) };
  return colored;
}

const LIST = ['"schools", "grades" or "instruments"', true];

export const SETUP_COMMANDS = {
  setYear: {
    summary: 'Rename the school year or change its first or last day.',
    changes: true,
    params: { name: ['New name'], startDate: ['New first day of school'], endDate: ['New last day of school'] },
    run: (state, a) => {
      const y = year(state);
      const patch = patchFrom(a, { name: (v) => text(v, 'name'), startDate: (v) => anyDate(v, 'start date'), endDate: (v) => anyDate(v, 'end date') });
      const next = { ...y, ...patch };
      if (next.startDate > next.endDate) fail('The first day has to come before the last day.');
      update(state, 'years', y.id, patch);
      return { done: `School year is now ${next.name}, ${next.startDate} to ${next.endDate}.` };
    },
  },
  addSetupItem: {
    summary: 'Add a school, grade or instrument to the year.',
    changes: true,
    params: { list: LIST, name: ['Its name', true], short: ['Grades only: short label, e.g. K or 3'], color: ['Grades and instruments: color like #b5654a; default a free one'] },
    run: (state, a) => {
      const [collection] = listNamed(a.list);
      const item = add(state, collection, newItem(state, collection, a));
      return { id: item.id, done: `Added ${item.name}.` };
    },
  },
  editSetupItem: {
    summary: 'Rename a school, grade or instrument, or change a grade\'s short label or a grade\'s or instrument\'s color.',
    changes: true,
    params: { list: LIST, item: ['Its current name', true], name: ['New name'], short: ['Grades only: short label'], color: ['Grades and instruments: color'] },
    run: (state, a) => {
      const [collection, kind] = listNamed(a.list);
      const item = kind.find(state, a.item);
      update(state, collection, item.id, patchFrom(a, { name: (v) => text(v, 'name'), short: String, color }));
      return { done: `Updated ${item.name}.` };
    },
  },
  removeSetupItem: {
    summary: 'Remove a school, grade or instrument. Its calendar entries and schedule lessons go with it (Undo brings them back).',
    changes: true,
    params: { list: LIST, item: ['Its name', true] },
    run: (state, a) => {
      const [collection, kind] = listNamed(a.list);
      const item = kind.find(state, a.item);
      remove(state, collection, item.id);
      return { done: `Removed ${item.name}.` };
    },
  },
  listEvents: {
    summary: 'The year\'s events: first/last day of school and U.S. holidays (built in) plus the holidays and breaks you added.',
    params: {},
    run: (state) => yearEvents(state, year(state).id).map((e) => ({
      name: e.name, startDate: e.startDate, endDate: e.endDate, ...(e.builtIn ? { builtIn: true } : { id: e.id }),
    })),
  },
  addEvent: {
    summary: 'Add a holiday or break (for every school). Using a built-in event\'s name replaces its dates.',
    changes: true,
    params: { name: ['e.g. Winter Break', true], startDate: ['First day', true], endDate: ['Last day; default the first day'] },
    run: (state, a) => {
      const startDate = dateIn(state, a.startDate, 'start date');
      const endDate = a.endDate ? dateIn(state, a.endDate, 'end date') : startDate;
      const [from, to] = [startDate, endDate].sort();
      const h = add(state, 'holidays', { yearId: year(state).id, name: text(a.name, 'name'), startDate: from, endDate: to });
      return { id: h.id, done: `Added ${h.name}.` };
    },
  },
  editEvent: {
    summary: 'Rename or re-date a holiday or break you added.',
    changes: true,
    params: { event: ['Its name', true], name: ['New name'], startDate: ['New first day'], endDate: ['New last day'] },
    run: (state, a) => {
      const h = holiday(state, a.event);
      const patch = patchFrom(a, { name: (v) => text(v, 'name'), startDate: (v) => dateIn(state, v), endDate: (v) => dateIn(state, v) });
      const [startDate, endDate] = [patch.startDate ?? h.startDate, patch.endDate ?? h.endDate].sort();
      update(state, 'holidays', h.id, { ...patch, startDate, endDate });
      return { done: `Updated ${h.name}.` };
    },
  },
  deleteEvent: {
    summary: 'Remove a holiday or break you added (built-in ones come back if you had replaced them).',
    changes: true,
    params: { event: ['Its name', true] },
    run: (state, a) => {
      const h = holiday(state, a.event);
      remove(state, 'holidays', h.id);
      return { done: `Removed ${h.name}.` };
    },
  },
};
