// Date helpers. All dates are stored as ISO "YYYY-MM-DD" strings and
// calculated in UTC so daylight-saving changes never shift a day.

const DAY_MS = 24 * 60 * 60 * 1000;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTHS_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July',
  'August', 'September', 'October', 'November', 'December'];
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function parseISO(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

export function toISO(date) {
  return date.toISOString().slice(0, 10);
}

export function addDays(iso, n) {
  return toISO(new Date(parseISO(iso).getTime() + n * DAY_MS));
}

export function weekday(iso) {
  return parseISO(iso).getUTCDay();
}

export function isWeekday(iso) {
  const d = weekday(iso);
  return d !== 0 && d !== 6;
}

export function nextWeekday(iso) {
  let d = addDays(iso, 1);
  while (!isWeekday(d)) d = addDays(d, 1);
  return d;
}

/** Every Monday–Friday date from start to end, inclusive. */
export function weekdaysBetween(start, end) {
  const out = [];
  for (let d = start; d <= end; d = addDays(d, 1)) {
    if (isWeekday(d)) out.push(d);
  }
  return out;
}

export function todayISO() {
  const now = new Date();
  return toISO(new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate())));
}

/** "YYYY-MM" key for the month an ISO date falls in. */
export function monthKey(iso) {
  return iso.slice(0, 7);
}

export function addMonths(key, n) {
  const [y, m] = key.split('-').map(Number);
  const total = y * 12 + (m - 1) + n;
  return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, '0')}`;
}

/** Month keys covering a date range, e.g. Aug 2026 … Jun 2027. */
export function monthsBetween(start, end) {
  const out = [];
  for (let k = monthKey(start); k <= monthKey(end); k = addMonths(k, 1)) out.push(k);
  return out;
}

/** Weeks (arrays of 5 ISO dates, Mon–Fri) that touch the given month. */
export function monthWeeks(key) {
  const first = `${key}-01`;
  const last = addDays(`${addMonths(key, 1)}-01`, -1);
  const weeks = [];
  for (let mon = addDays(first, -((weekday(first) + 6) % 7)); mon <= last; mon = addDays(mon, 7)) {
    const week = [0, 1, 2, 3, 4].map((i) => addDays(mon, i));
    if (week.some((d) => monthKey(d) === key)) weeks.push(week);
  }
  return weeks;
}

export function formatMonth(key) {
  const [y, m] = key.split('-').map(Number);
  return `${MONTHS_LONG[m - 1]} ${y}`;
}

export function shortMonth(key) {
  return MONTHS[Number(key.slice(5, 7)) - 1];
}

export function formatDate(iso) {
  const d = parseISO(iso);
  return `${WEEKDAYS[d.getUTCDay()]}, ${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`;
}

export function formatShort(iso) {
  const d = parseISO(iso);
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`;
}

export function formatRange(start, end) {
  return start === end ? formatShort(start) : `${formatShort(start)} – ${formatShort(end)}`;
}
