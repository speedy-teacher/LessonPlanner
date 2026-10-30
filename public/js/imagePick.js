// Choosing the picture (e.g. a bitmoji) for a lesson copy, from only the dates the lesson is shown,
// the school's holidays, and the lesson's instruments. Ported from the lesson-organizer project's
// pick_bitmoji.py, which was built and tested against the teacher's 52 tagged bitmojis.
//
// An image's `when` (see model.js) lists windows; the image fits a showing when the showing's dates
// overlap ANY window:
//   date window    { type: 'date', from: 'MM-DD', to: 'MM-DD', startByEnd } — every year, may wrap past
//                  New Year; with startByEnd the showing must also BEGIN by `to` (month greetings).
//   holiday window { type: 'holiday', holiday, anchor: 'start'|'end', daysBefore, daysAfter } — around one
//                  of the year's events (schoolEvents.js: first/last day of school, U.S. holidays, your own),
//                  matched by name, ignoring capitals; `aliases` also match.
// Score = `when.priority` if a window fits, 1 if it may be used any time, otherwise 0 (never used).
// The best score wins; ties prefer pictures shared with "anyone with the link" (only those can be
// placed in a copy), then ones showing an instrument the lesson uses.
// On the Lesson Schedule every school week gets one picture (the same for every class that week), and
// pictures take turns: weeks with only one picture that fits get it first, then every other week takes
// the best fit that is used farthest away (never used comes first), so a picture only comes back once
// every other picture that fits has had its turn, and never right before a week that needs it.
// (Sharing doesn't count here: the planner shares a picture for a moment while placing it, which would
// make the choice change from minute to minute and from computer to computer.)

import { addDays } from './dates.js';
import { find } from './model.js';
import { schoolWeeks } from './weekPlan.js';
import { yearEvents } from './schoolEvents.js';

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

/** Pictures picked for this entry's lesson by hand (they fit any week, and the best for the week wins). */
function chosenForLesson(state, entry) {
  return state.images
    .filter((i) => i.yearId === entry.yearId && i.lessonIds?.includes(entry.lessonId))
    .map((i) => ({ ...i, when: { ...i.when, anytime: true } }));
}

/** How far (in weeks) a picture is from its nearest other use; Infinity when it isn't used yet. */
function gapToUses(imageId, n, assigned) {
  let gap = Infinity;
  for (const [m, image] of assigned) if (image.id === imageId) gap = Math.min(gap, Math.abs(n - m));
  return gap;
}

/** Of a week's best fits, the one used farthest away (never used first; ties keep the list order). */
function farthestFromUses(best, n, assigned) {
  return best.reduce((a, b) => (gapToUses(b.id, n, assigned) > gapToUses(a.id, n, assigned) ? b : a));
}

let lastPlan = { key: '', plan: new Map() };

/**
 * One picture for every school week of the year (Map weekStart → image): the best fit for the week,
 * taking turns with the other best fits so none repeats until all of them have been used.
 */
export function weeklyPictures(state, yearId) {
  const images = state.images.filter((i) => i.yearId === yearId);
  const holidays = yearEvents(state, yearId);
  const year = find(state, 'years', yearId);
  // The plan is worked out again only when something it depends on changed (the plan is edited in place).
  const key = JSON.stringify([year, holidays, images.map((i) => [i.id, i.when])]);
  if (lastPlan.key !== key) lastPlan = { key, plan: planWeeks(year, images, holidays) };
  return lastPlan.plan;
}

function planWeeks(year, images, holidays) {
  const weeks = schoolWeeks(year).map((week, n) => ({
    week, n, best: week.days.length ? pickImages(images, { start: week.days[0], end: week.days.at(-1), holidays }) : [],
  })).filter((w) => w.best.length);
  const assigned = new Map();
  weeks.filter((w) => w.best.length === 1).forEach((w) => assigned.set(w.n, w.best[0]));
  weeks.filter((w) => w.best.length > 1).forEach((w) => assigned.set(w.n, farthestFromUses(w.best, w.n, assigned)));
  return new Map(weeks.map((w) => [w.week.weekStart, assigned.get(w.n)]));
}

/** The picture chosen for a schedule entry ({ image, week } — image null when none fits). */
export function pictureForEntry(state, entry, sharing = () => null) {
  const { week, start, end } = entryDates(state, entry);
  const chosen = chosenForLesson(state, entry);
  if (!chosen.length && week?.days.length) {
    const image = weeklyPictures(state, entry.yearId).get(entry.weekStart);
    return { image: image ? find(state, 'images', image.id) : null, week };
  }
  const lesson = find(state, 'lessons', entry.lessonId);
  const pool = chosen.length ? chosen : state.images.filter((i) => i.yearId === entry.yearId);
  const [best] = pickImages(pool, {
    start, end, sharing,
    holidays: yearEvents(state, entry.yearId),
    instrumentIds: lesson?.instrumentIds ?? [],
  });
  return { image: best ? find(state, 'images', best.id) : null, week };
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
  const holidays = yearEvents(state, image.yearId);
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

// ---------- in words ----------

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

function monthDayText(mmdd) {
  const [m, d] = (mmdd || '01-01').split('-').map(Number);
  return `${MONTH_NAMES[m - 1]} ${d}`;
}

/** "Dec 1 – Dec 13, every year" · "30 days before Halloween" · "the end of Winter Break and 10 days after". */
export function windowSentence(win) {
  if (win.type !== 'holiday') {
    const start = win.startByEnd ? ' (if the lesson starts by then)' : '';
    return `${monthDayText(win.from)} – ${monthDayText(win.to)}, every year${start}`;
  }
  const event = win.holiday || 'an event';
  return eventSentence(win.anchor === 'end' ? `the end of ${event}` : event, win.daysBefore || 0, win.daysAfter || 0);
}

function eventSentence(day, before, after) {
  if (before && after) return `${plural(before, 'day')} before to ${plural(after, 'day')} after ${day}`;
  if (before) return `${plural(before, 'day')} before ${day}`;
  if (after) return `${day} and ${plural(after, 'day')} after`;
  return `On ${day}`;
}
