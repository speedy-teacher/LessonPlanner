// Choosing the picture (e.g. a bitmoji) for a lesson copy, from only the dates the lesson is shown,
// the school's holidays, and the lesson's instruments. Ported from the lesson-organizer project's
// pick_bitmoji.py, which was built and tested against the teacher's 52 tagged bitmojis.
//
// An image's `when` (see model.js) lists windows; the image fits a showing when the showing's dates
// overlap ANY window:
//   date window    { type: 'date', from: 'MM-DD', to: 'MM-DD', startByEnd } — every year, may wrap past
//                  New Year; with startByEnd the showing must also BEGIN by `to` (month greetings).
//   holiday window { type: 'holiday', holiday, anchor: 'start'|'end', daysBefore, daysAfter } — around a
//                  holiday on the year's list (matched by name, ignoring capitals; `aliases` also match).
// Score = `when.priority` if a window fits, 1 if it may be used any time, otherwise 0 (never used).
// The best score wins; ties prefer pictures shared with "anyone with the link" (only those can be
// placed in a copy), then ones showing an instrument the lesson uses.

import { addDays } from './dates.js';
import { find } from './model.js';
import { schoolWeeks } from './weekPlan.js';

/** How strongly a picture's windows count when they fit. */
export const PRIORITIES = [
  { value: 4, label: 'Greeting', hint: 'Start of a month, first week of school, first week back' },
  { value: 3, label: 'Holiday', hint: 'Around a holiday or break' },
  { value: 2, label: 'Season', hint: 'A time of year, e.g. snow or sunshine' },
];

const overlaps = (aStart, aEnd, bStart, bEnd) => aStart <= bEnd && bStart <= aEnd;
const noLeapDay = (mmdd) => (mmdd === '02-29' ? '02-28' : mmdd);

/** A date window's dates in the year it starts. */
function yearlyWindow(window, year) {
  const from = noLeapDay(window.from);
  const to = noLeapDay(window.to);
  return [`${year}-${from}`, `${to < from ? year + 1 : year}-${to}`];
}

function dateWindowFits(window, start, end) {
  for (let year = Number(start.slice(0, 4)) - 1; year <= Number(end.slice(0, 4)); year += 1) {
    const [from, to] = yearlyWindow(window, year);
    if (overlaps(start, end, from, to) && (!window.startByEnd || start <= to)) return true;
  }
  return false;
}

/** The holidays a window is about (by name or alias, ignoring capitals). */
export function holidaysFor(window, holidays) {
  const names = new Set([window.holiday, ...(window.aliases ?? [])].map((n) => String(n ?? '').trim().toLowerCase()));
  return holidays.filter((h) => names.has(h.name.trim().toLowerCase()));
}

function holidayWindowFits(window, start, end, holidays) {
  return holidaysFor(window, holidays).some((h) => {
    const day = window.anchor === 'end' ? h.endDate : h.startDate;
    return overlaps(start, end, addDays(day, -(window.daysBefore || 0)), addDays(day, window.daysAfter || 0));
  });
}

export function windowFits(window, start, end, holidays) {
  return window.type === 'holiday' ? holidayWindowFits(window, start, end, holidays) : dateWindowFits(window, start, end);
}

/** How well a picture fits a showing from `start` to `end` (ISO dates): its priority, 1 (any time) or 0. */
export function scoreImage(image, start, end, holidays = []) {
  const { when } = image;
  if (when.windows.some((w) => windowFits(w, start, end, holidays))) return when.priority;
  return when.anytime ? 1 : 0;
}

const SHARING_ORDER = (shared) => (shared === true ? 0 : shared === null || shared === undefined ? 1 : 2);

/**
 * The best pictures for a showing, best first ([] if none fits).
 * `sharing(image)` → true (anyone with the link), false (not shared) or null (not known yet).
 */
export function pickImages(images, { start, end, holidays = [], instrumentIds = [], sharing = () => null }) {
  const scored = images.map((image) => ({ image, score: scoreImage(image, start, end, holidays) }));
  const top = Math.max(0, ...scored.map((s) => s.score));
  if (!top) return [];
  const fitsInstrument = (image) => (image.instrumentIds.some((id) => instrumentIds.includes(id)) ? 0 : 1);
  return scored.filter((s) => s.score === top).map((s) => s.image)
    .sort((a, b) => SHARING_ORDER(sharing(a)) - SHARING_ORDER(sharing(b)) || fitsInstrument(a) - fitsInstrument(b));
}

// ---------- on the Lesson Schedule ----------

/** The dates a schedule entry's lesson is shown: the school days of its week. */
export function entryDates(state, entry) {
  const week = schoolWeeks(find(state, 'years', entry.yearId)).find((w) => w.weekStart === entry.weekStart);
  const days = week?.days.length ? week.days : [entry.weekStart, addDays(entry.weekStart, 4)];
  return { week, start: days[0], end: days.at(-1) };
}

/** The picture chosen for a schedule entry ({ image, week } — image null when none fits). */
export function pictureForEntry(state, entry, sharing = () => null) {
  const { week, start, end } = entryDates(state, entry);
  const lesson = find(state, 'lessons', entry.lessonId);
  const [image = null] = pickImages(state.images.filter((i) => i.yearId === entry.yearId), {
    start, end, sharing,
    holidays: state.holidays.filter((h) => h.yearId === entry.yearId),
    instrumentIds: lesson?.instrumentIds ?? [],
  });
  return { image, week };
}

/** Whether a lesson has a spot for a picture (its "Picture" detail is ticked). */
export function wantsPicture(lesson) {
  return Boolean(lesson?.autoFields.includes('image'));
}

/** Each time a lesson is on the schedule, the picture it gets: [{ entry, week, image }] in schedule order. */
export function lessonPictures(state, lessonId, sharing) {
  if (!wantsPicture(find(state, 'lessons', lessonId))) return [];
  return state.weekLessons
    .filter((e) => e.lessonId === lessonId)
    .sort((a, b) => a.weekStart.localeCompare(b.weekStart) || a.position - b.position)
    .map((entry) => ({ entry, ...pictureForEntry(state, entry, sharing) }));
}

/** Schedule entries whose lesson gets this picture: [{ entry, week }]. */
export function imageUses(state, imageId, sharing) {
  const image = find(state, 'images', imageId);
  if (!image) return [];
  return state.weekLessons
    .filter((e) => e.yearId === image.yearId && wantsPicture(find(state, 'lessons', e.lessonId)))
    .map((entry) => ({ entry, ...pictureForEntry(state, entry, sharing) }))
    .filter((p) => p.image?.id === imageId)
    .sort((a, b) => a.entry.weekStart.localeCompare(b.entry.weekStart));
}

/** The school weeks where one of a picture's windows fits (not counting "any time"). */
export function weeksImageFits(state, image) {
  const holidays = state.holidays.filter((h) => h.yearId === image.yearId);
  return schoolWeeks(find(state, 'years', image.yearId))
    .filter((w) => w.days.length && image.when.windows.some((win) => windowFits(win, w.days[0], w.days.at(-1), holidays)));
}

/** "Weeks 1, 14–15 and 30" from week numbers. */
export function weekRanges(numbers) {
  const runs = [];
  for (const n of [...numbers].sort((a, b) => a - b)) {
    const last = runs.at(-1);
    if (last && last[1] === n - 1) last[1] = n;
    else runs.push([n, n]);
  }
  const parts = runs.map(([a, b]) => (a === b ? String(a) : `${a}–${b}`));
  if (!parts.length) return '';
  const list = parts.length > 1 ? `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}` : parts[0];
  return `${numbers.length === 1 ? 'Week' : 'Weeks'} ${list}`;
}
