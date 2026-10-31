// Reports: Google Sheets that list, week by week, the lessons a class (school + grade) is taught,
// in order, each one linked to its lesson copy, and which instruments the school has that week.
//
// Two kinds, built the same way:
//   weekly — one per week folder of the lesson copies (made and kept up to date by the export bridge)
//   manual — made from the Reports tab for the weeks, schools and grades the teacher picks: one file
//            per school (a tab per grade), or one file per school and grade.
//
// This module only works out what a report says (pure, shared with the Node tests). Rows are plain
// cells { text, url?, style } so the Reports tab preview and the Google Sheet (reportSheets.js) match.
//
// Report settings live on the year record: `year.reports` = { label, above, below, weekly, manual }
//   label  = how each lesson is written, e.g. "{{copy_name}} / {{template_name}}" ('' = DEFAULT_LABEL)
//   above, below = extra rows shown above / below every lesson, e.g. ["{{essential_outcome}}"]
//            (same words as the label; a row that comes out empty for a lesson is left out)
//   left, right = extra columns left / right of the lesson: [{ name, value }], e.g. { name: 'Outcome', value: '{{essential_outcome}}' }
//            (value uses the same words as the label; an older plain-text column gets a name from columnTitle)
//   columnNames = false leaves out the row of column names at the top
//   footer = false leaves out the "Automatically maintained by Lesson Planner" line at the bottom
//   weekly = false turns the weekly reports off (on when missing)
//   manual = { fromWeek, toWeek, schoolIds[], gradeIds[], perGrade, folder: { folderId, name } | null }

import { formatRange, formatShort } from './dates.js';
import { AUTO_FIELD_PLACEHOLDERS, AUTO_FIELDS, find, inYear, TEXT_FIELDS, toRanges } from './model.js';
import { entryValues, fingerprint, lessonNumbers, safeName } from './exportPlan.js';
import { instrumentsInWeek, schoolWeeks, weekLessonsFor } from './weekPlan.js';
import { driveOpenUrl } from './locations.js';
import { readableText } from './evalGrade.js';

export const DEFAULT_LABEL = '{{copy_name}}';

/** Words the lesson label can use, besides every "Filled in automatically" detail ({{school}}, {{week_number}}…). */
export const LABEL_WORDS = {
  '{{copy_name}}': 'The copy’s file name',
  '{{template_name}}': 'The template’s name',
};

const REPORT_DEFAULTS = { label: '', above: [], below: [], left: [], right: [], columnNames: true, footer: true, weekly: true };
const MANUAL_DEFAULTS = { fromWeek: null, toWeek: null, schoolIds: [], gradeIds: [], perGrade: false, folder: null };

/** Saved values over defaults (a missing or null value gets the default). */
const withDefaults = (defaults, saved = {}) => Object.fromEntries(Object.entries(defaults).map(([k, v]) => [k, saved[k] ?? v]));

/** The year's report settings, with everything missing filled in. */
export function reportSettings(year) {
  const r = year?.reports ?? {};
  const settings = { ...withDefaults(REPORT_DEFAULTS, r), manual: withDefaults(MANUAL_DEFAULTS, r.manual ?? {}) };
  return { ...settings, left: settings.left.map(asColumn), right: settings.right.map(asColumn) };
}

/** An extra column as { name, value } (plain text = its value, named after its words). */
export function asColumn(column) {
  if (typeof column === 'string') return { name: columnTitle(column), value: column };
  return { name: String(column?.name ?? ''), value: String(column?.value ?? '') };
}

/** The year's report settings with some changed (`patch` at the top, `manual` for the Reports tab form). */
export function changedReports(year, patch = {}, manual = {}) {
  const { manual: before, ...top } = reportSettings(year);
  return { ...top, ...patch, manual: { ...before, ...manual } };
}

/** The lesson label with its words swapped for the lesson's details (unknown words stay as typed). */
export function lessonLabel(label, words) {
  return fillWords(label || DEFAULT_LABEL, words) || words['{{copy_name}}'];
}

const WORD = /\{\{\s*([\w]+)\s*\}\}/g;

/** Text with its {{words}} swapped for the lesson's details (unknown words stay as typed). */
export function fillWords(text, words) {
  return String(text ?? '').replace(WORD, (all, key) => words[`{{${key}}}`] ?? all).trim();
}

/** An extra row for a lesson, or '' when all its words are empty for it (e.g. "Outcome: {{essential_outcome}}" without an eval). */
function extraRow(text, words) {
  const used = [...String(text ?? '').matchAll(WORD)].map((m) => words[`{{${m[1]}}}`]);
  return used.length && used.every((v) => v === '') ? '' : fillWords(text, words);
}

/** A column's title: its words named, e.g. "{{essential_outcome}}" → "Essential outcome". */
export function columnTitle(text) {
  const names = {
    '{{copy_name}}': 'Copy', '{{template_name}}': 'Template',
    ...Object.fromEntries(TEXT_FIELDS.map((key) => [AUTO_FIELD_PLACEHOLDERS[key], AUTO_FIELDS[key]])),
  };
  return fillWords(text, names) || 'Notes';
}

const extraRows = (texts, words) => (texts ?? []).map((t) => extraRow(t, words)).filter(Boolean);

/** "Drum (all week)" or "Drum (available Oct 6 - Oct 7)" (days apart: "Oct 6, Oct 8 - Oct 9"). */
export function instrumentText(name, { days, allWeek }) {
  if (allWeek) return `${name} (all week)`;
  const ranges = toRanges(days).map(([a, b]) => (a === b ? formatShort(a) : `${formatShort(a)} - ${formatShort(b)}`));
  return `${name} (available ${ranges.join(', ')})`;
}

/** A color mixed with white (`amount` 0–1 of the color), e.g. a soft tint of a grade's color. */
export function tint(hex, amount) {
  const mixed = [1, 3, 5].map((i) => Math.round(255 - (255 - parseInt(hex.slice(i, i + 2), 16)) * amount));
  return `#${mixed.map((c) => c.toString(16).padStart(2, '0')).join('')}`;
}

/** The grade's colors for a tab's title and dates: { color, ink } and a soft tint { color, ink } (null = no grade color). */
function gradeLook(hex) {
  if (!/^#[0-9a-f]{6}$/i.test(hex ?? '')) return null;
  const soft = tint(hex, 0.18);
  return { title: { color: hex, ink: readableText(hex) }, soft: { color: soft, ink: readableText(soft) } };
}

/**
 * The instruments for a class's week: `required` = the ones its lessons use, `also` = the others at the
 * school that week (each "Drum (all week)" or "Drum (available …)"; a required one that isn't there says so).
 */
export function weekInstruments(state, cls, week, lessonIds = []) {
  const there = new Map(instrumentsInWeek(state, cls, week).map((i) => [i.instrumentId, i]));
  const needed = new Set(lessonIds.flatMap((id) => find(state, 'lessons', id)?.instrumentIds ?? []));
  const named = (ids) => ids.map((id) => ({ id, name: find(state, 'instruments', id)?.name ?? '' }))
    .filter((i) => i.name).sort((a, b) => a.name.localeCompare(b.name));
  const text = ({ id, name }) => (there.has(id) ? instrumentText(name, there.get(id)) : `${name} (not at the school this week)`);
  return {
    required: named([...needed]).map(text),
    also: named([...there.keys()].filter((id) => !needed.has(id))).map(text),
  };
}

/** "Required: Drum (all week) / Also available: Bells (available Sep 8 - Sep 9)". */
export function instrumentsLine({ required, also }) {
  return `Required: ${required.join(', ') || 'none'} / Also available: ${also.join(', ') || 'none'}`;
}

/**
 * One week of a class: { number, dates, instruments: { required, also }, lessons: [{ entryId, text, url, above, below, left, right }] }
 * (above/below = the lesson's extra rows, left/right = its extra columns, see reportSettings).
 * `copyOf(entryId)` → { name, url } of its lesson copy, or null (not made yet, or no template).
 */
export function reportWeek(state, cls, week, { label, above, below, left = [], right = [], copyOf, numbers }) {
  const days = week.days.length ? week.days : [week.weekStart];
  const lessons = weekLessonsFor(state, cls, week.weekStart).map((entry) => {
    const lesson = find(state, 'lessons', entry.lessonId);
    const copy = copyOf(entry.id);
    const values = entryValues(state, entry, week, numbers);
    const words = Object.fromEntries(TEXT_FIELDS.map((key) => [AUTO_FIELD_PLACEHOLDERS[key], values[key] ?? '']));
    words['{{copy_name}}'] = copy?.name || `${entry.position + 1} - ${lesson?.name ?? 'Lesson'}`;
    words['{{template_name}}'] = lesson?.name ?? '';
    return {
      entryId: entry.id, lessonId: entry.lessonId, text: lessonLabel(label, words), url: copy?.url ?? null,
      above: extraRows(above, words), below: extraRows(below, words),
      left: left.map((c) => fillWords(asColumn(c).value, words)), right: right.map((c) => fillWords(asColumn(c).value, words)),
    };
  });
  return { number: week.number, dates: formatRange(days[0], days.at(-1)), instruments: weekInstruments(state, cls, week, lessons.map((l) => l.lessonId)), lessons };
}

/** Lesson copies (Drive ones) → `copyOf` for reports: entry id → { name, url } of its copy, or null. */
export function copyFinder(copies) {
  const byEntry = new Map((copies ?? []).filter((c) => !c.fileName).map((c) => [c.entryId, c]));
  return (entryId) => {
    const c = byEntry.get(entryId);
    return c ? { name: c.name, url: driveOpenUrl({ fileId: c.id, mimeType: c.mimeType }) } : null;
  };
}

const nameOf = (state, collection, id) => find(state, collection, id)?.name ?? '';

/** "Week 3" or "Weeks 3–5". */
export function weeksTitle(weeks) {
  if (!weeks.length) return 'No weeks';
  const [first, last] = [weeks[0].number, weeks.at(-1).number];
  return first === last ? `Week ${first}` : `Weeks ${first}–${last}`;
}

/**
 * One tab: a class over some weeks. { title (tab name), heading, subheading, weeks: [reportWeek],
 * columns: { left, right (column names), names (show them at the top) }, footer }.
 */
export function reportTab(state, cls, weeks, options) {
  const school = nameOf(state, 'schools', cls.schoolId);
  const grade = nameOf(state, 'grades', cls.gradeId);
  const days = weeks.flatMap((w) => (w.days.length ? w.days : [w.weekStart]));
  return {
    title: safeName(grade).slice(0, 90),
    heading: `${school} · ${grade}`,
    look: gradeLook(find(state, 'grades', cls.gradeId)?.color),
    subheading: days.length ? `${weeksTitle(weeks)} · ${formatRange(days[0], days.at(-1))}` : weeksTitle(weeks),
    columns: {
      left: (options.left ?? []).map((c) => asColumn(c).name), right: (options.right ?? []).map((c) => asColumn(c).name),
      names: options.columnNames !== false,
    },
    footer: options.footer !== false,
    weeks: weeks.map((w) => reportWeek(state, cls, w, options)),
  };
}

/** A report file's fingerprint (it changes only when what the file shows would). */
export const reportHash = (file) => fingerprint(JSON.stringify([file.name, file.tabs]));

// ---------- the rows a tab shows ----------

export const REPORT_NOTE = 'Automatically maintained by Lesson Planner';
/** The live Lesson Planner site (the footer links "Lesson Planner" here). */
export const SITE_URL = 'https://speedy-teacher.github.io/LessonPlanner/';

/** Whether a tab has a row of column names at the top. */
export const showsColumnNames = (tab) => reportWidth(tab) > 2 && tab.columns?.names !== false;

/** How many columns a tab has: the lesson number, extra columns left, the lesson, extra columns right. */
export function reportWidth(tab) {
  return 2 + (tab.columns?.left.length ?? 0) + (tab.columns?.right.length ?? 0);
}

/**
 * A tab as rows of cells: [{ text, url?, linkText?, style, span?, color?, ink? }] (color/ink = this cell's background and text colors) (span = how many columns the cell covers, default 1;
 * linkText = only that part of the text links to url).
 * Styles: heading, subheading, columnHead, week, label, instruments, lesson, column (an extra column),
 * extra (a lesson's rows above/below it), number, empty, note. Column A holds labels and lesson numbers.
 */
export function reportRows(tab) {
  const width = reportWidth(tab);
  const wide = (text, style) => ({ text, style, span: width });
  const rest = (text, style) => ({ text, style, span: width - 1 });
  const { title, soft } = tab.look ?? {};
  const rows = [
    [{ ...wide(tab.heading, 'heading'), ...title }], // the grade's color behind the title, with text that reads on it
    [{ ...wide(tab.subheading, 'subheading'), ...soft }],
    columnHeads(tab),
  ];
  for (const week of tab.weeks) {
    rows.push([{ text: `Week ${week.number}`, style: 'week' }, rest(week.dates, 'week')]);
    rows.push([{ text: 'Instruments', style: 'label' }, rest(instrumentsLine(week.instruments), 'instruments')]);
    if (!week.lessons.length) rows.push([{ text: '', style: 'number' }, rest('No lessons on the schedule', 'empty')]);
    week.lessons.forEach((l, i) => rows.push(...lessonRows(tab, l, i)));
    rows.push([]);
  }
  if (tab.footer !== false) rows.push([{ ...wide(REPORT_NOTE, 'note'), url: SITE_URL, linkText: 'Lesson Planner' }]);
  return rows;
}

/** Column names at the top, when there are extra columns and their names are shown (otherwise an empty row). */
function columnHeads(tab) {
  if (!showsColumnNames(tab)) return [];
  const head = (text) => ({ text, style: 'columnHead' });
  return [head(''), ...tab.columns.left.map(head), head('Lesson'), ...tab.columns.right.map(head)];
}

/** A lesson's rows: its extra rows above, the lesson itself (numbered, linked to its copy, with its columns), its rows below. */
function lessonRows(tab, lesson, i) {
  const blanks = (titles) => titles.map(() => ({ text: '', style: 'column' }));
  const { left = [], right = [] } = tab.columns ?? {};
  const extra = (text) => [{ text: '', style: 'number' }, ...blanks(left), { text, style: 'extra' }, ...blanks(right)];
  const column = (text) => ({ text, style: 'column' });
  return [
    ...(lesson.above ?? []).map(extra),
    [{ text: String(i + 1), style: 'number' }, ...(lesson.left ?? []).map(column),
      { text: lesson.text, url: lesson.url, style: 'lesson' }, ...(lesson.right ?? []).map(column)],
    ...(lesson.below ?? []).map(extra),
  ];
}

// ---------- weekly reports (one per week folder of the lesson copies) ----------

/**
 * The weekly reports the lesson copies ask for: one per week folder (a class's week with at least one
 * wanted copy), placed in that folder. `wants` = wantedCopies(); `copyOf(entryId)` → { name, url } | null.
 * Returns [{ key, path, name, place, hash, tabs }].
 */
export function weeklyReports(state, yearId, { wants, copyOf, rootKey, ...look }) {
  const weeks = new Map(schoolWeeks(find(state, 'years', yearId)).map((w) => [w.weekStart, w]));
  const numbers = lessonNumbers(state.weekLessons.filter((e) => e.yearId === yearId && weeks.has(e.weekStart)));
  const files = new Map();
  for (const want of wants) {
    const entry = find(state, 'weekLessons', want.entryId);
    const key = entry && `${entry.schoolId}|${entry.gradeId}|${entry.weekStart}`;
    if (!entry || files.has(key)) continue;
    const week = weeks.get(entry.weekStart);
    const tab = reportTab(state, entry, [week], { ...look, copyOf, numbers });
    const file = { key, path: want.path, name: safeName(`Week ${week.number} report`), tabs: [tab] };
    files.set(key, { ...file, place: fingerprint(JSON.stringify([rootKey, want.path])), hash: reportHash(file) });
  }
  return [...files.values()];
}

/**
 * What to do to make the report files match: [{ kind: 'create', want } | { kind: 'update', want, have }
 * | { kind: 'remove', have }]. `update` also moves and renames. Haves = [{ id, key, hash, place, name }].
 */
export function reportSteps(wants, haves) {
  const byKey = Map.groupBy(haves, (h) => h.key);
  const steps = [];
  for (const want of wants) {
    const [have, ...twins] = byKey.get(want.key) ?? [];
    twins.forEach((t) => steps.push({ kind: 'remove', have: t }));
    if (!have) steps.push({ kind: 'create', want });
    else if (have.hash !== want.hash || have.place !== want.place || have.name !== want.name) steps.push({ kind: 'update', want, have });
  }
  const wanted = new Set(wants.map((w) => w.key));
  haves.filter((h) => !wanted.has(h.key)).forEach((have) => steps.push({ kind: 'remove', have }));
  return steps;
}

// ---------- reports made from the Reports tab ----------

/** The school weeks a manual report covers (from/to are week numbers; missing = the given default week). */
export function manualWeeks(year, manual, defaultWeek = 1) {
  const weeks = schoolWeeks(year);
  const from = manual.fromWeek ?? defaultWeek;
  const to = Math.max(from, manual.toWeek ?? from);
  return weeks.filter((w) => w.number >= from && w.number <= to);
}

/**
 * The files a manual report makes: one per school (a tab per grade), or with `perGrade` one per school
 * and grade. Schools and grades not chosen = every one. Returns [{ key, name, schoolId, gradeIds, tabs, hash }]
 * (the key finds the same file again, so making the report again updates it).
 */
export function manualReports(state, yearId, { manual, copyOf, defaultWeek, ...look }) {
  const year = find(state, 'years', yearId);
  const weeks = manualWeeks(year, manual, defaultWeek);
  const chosen = (collection, ids) => inYear(state, collection, yearId).filter((r) => !ids.length || ids.includes(r.id));
  const schools = chosen('schools', manual.schoolIds);
  const grades = chosen('grades', manual.gradeIds);
  if (!weeks.length || !grades.length) return [];
  const numbers = lessonNumbers(state.weekLessons.filter((e) => e.yearId === yearId));
  const groups = manual.perGrade ? grades.map((g) => [g]) : [grades];
  return schools.flatMap((school) => groups.map((group) => {
    const tabs = group.map((g) => reportTab(state, { yearId, schoolId: school.id, gradeId: g.id }, weeks, { ...look, copyOf, numbers }));
    const who = manual.perGrade ? `${school.name} – ${group[0].name}` : school.name;
    const file = {
      key: fingerprint(JSON.stringify([school.id, group.map((g) => g.id), weeks[0].number, weeks.at(-1).number])),
      name: safeName(`${who} – ${weeksTitle(weeks)} report`), schoolId: school.id, gradeIds: group.map((g) => g.id), tabs,
    };
    return { ...file, hash: reportHash(file) };
  }));
}
