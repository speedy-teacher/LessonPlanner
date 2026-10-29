// The year's events: the first and last day of school (from the year's dates), U.S. holidays that fall
// inside the school year (worked out for every year, so nobody has to type them), and the events you
// add yourself (`holidays` collection: breaks, concerts…). Pictures can be set to fit around any of them.
// An event you add with the same name as a built-in one replaces it (e.g. your district's own date).
// Shared by the browser app and the tests.

import { addDays, weekday } from './dates.js';
import { find } from './model.js';

const pad = (n) => String(n).padStart(2, '0');
const on = (year, month, day) => `${year}-${pad(month)}-${pad(day)}`;

/** The nth weekday (0 = Sunday) of a month; n = -1 for the last one. */
function nthWeekday(year, month, day, n) {
  if (n < 0) {
    let date = addDays(month === 12 ? on(year + 1, 1, 1) : on(year, month + 1, 1), -1);
    while (weekday(date) !== day) date = addDays(date, -1);
    return date;
  }
  let date = on(year, month, 1);
  while (weekday(date) !== day) date = addDays(date, 1);
  return addDays(date, 7 * (n - 1));
}

// U.S. federal holidays and well-known observances, by calendar year.
const US_HOLIDAYS = [
  ['new-year', 'New Year’s Day', (y) => on(y, 1, 1)],
  ['mlk', 'Martin Luther King Jr. Day', (y) => nthWeekday(y, 1, 1, 3)],
  ['groundhog', 'Groundhog Day', (y) => on(y, 2, 2)],
  ['valentines', 'Valentine’s Day', (y) => on(y, 2, 14)],
  ['presidents', 'Presidents’ Day', (y) => nthWeekday(y, 2, 1, 3)],
  ['st-patricks', 'St. Patrick’s Day', (y) => on(y, 3, 17)],
  ['earth-day', 'Earth Day', (y) => on(y, 4, 22)],
  ['mothers-day', 'Mother’s Day', (y) => nthWeekday(y, 5, 0, 2)],
  ['memorial', 'Memorial Day', (y) => nthWeekday(y, 5, 1, -1)],
  ['flag-day', 'Flag Day', (y) => on(y, 6, 14)],
  ['fathers-day', 'Father’s Day', (y) => nthWeekday(y, 6, 0, 3)],
  ['juneteenth', 'Juneteenth', (y) => on(y, 6, 19)],
  ['independence', 'Independence Day', (y) => on(y, 7, 4)],
  ['labor', 'Labor Day', (y) => nthWeekday(y, 9, 1, 1)],
  ['constitution', 'Constitution Day', (y) => on(y, 9, 17)],
  ['columbus', 'Columbus Day / Indigenous Peoples’ Day', (y) => nthWeekday(y, 10, 1, 2)],
  ['halloween', 'Halloween', (y) => on(y, 10, 31)],
  ['veterans', 'Veterans Day', (y) => on(y, 11, 11)],
  ['thanksgiving', 'Thanksgiving', (y) => nthWeekday(y, 11, 4, 4)],
  ['christmas', 'Christmas Day', (y) => on(y, 12, 25)],
];

/** U.S. holidays from `startDate` to `endDate` (ISO dates), in date order: [{ key, name, startDate, endDate }]. */
export function usHolidays(startDate, endDate) {
  const out = [];
  for (let y = Number(startDate.slice(0, 4)); y <= Number(endDate.slice(0, 4)); y += 1) {
    for (const [key, name, dateOf] of US_HOLIDAYS) {
      const date = dateOf(y);
      if (startDate <= date && date <= endDate) out.push({ key: `${key}-${y}`, name, startDate: date, endDate: date });
    }
  }
  return out.sort((a, b) => a.startDate.localeCompare(b.startDate));
}

/** The built-in events of a school year: first and last day of school, then U.S. holidays inside it. */
export function builtInEvents(year) {
  if (!year?.startDate || !year?.endDate) return [];
  return [
    { key: 'first-day', name: 'First Day of School', startDate: year.startDate, endDate: year.startDate },
    { key: 'last-day', name: 'Last Day of School', startDate: year.endDate, endDate: year.endDate },
    ...usHolidays(year.startDate, year.endDate),
  ].map((e) => ({ ...e, builtIn: true }));
}

const sameName = (a, b) => a.trim().toLowerCase() === b.trim().toLowerCase();

/**
 * Every event of a year, in date order: built-in ones (unless you added one with the same name) and
 * yours. Each is { name, startDate, endDate, builtIn?, id? (yours) }.
 */
export function yearEvents(state, yearId) {
  const yours = state.holidays.filter((h) => h.yearId === yearId);
  const builtIn = builtInEvents(find(state, 'years', yearId)).filter((e) => !yours.some((h) => sameName(h.name, e.name)));
  return [...builtIn, ...yours].sort((a, b) => a.startDate.localeCompare(b.startDate) || a.name.localeCompare(b.name));
}

