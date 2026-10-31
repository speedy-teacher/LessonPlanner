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
// Report settings live on the year record: `year.reports` = { label, weekly, manual }
//   label  = how each lesson is written, e.g. "{{copy_name}} / {{template_name}}" ('' = DEFAULT_LABEL)
//   weekly = false turns the weekly reports off (on when missing)
//   manual = { fromWeek, toWeek, schoolIds[], gradeIds[], perGrade, folder: { folderId, name } | null }

import { formatRange, formatShort } from './dates.js';
import { AUTO_FIELD_PLACEHOLDERS, find, inYear, TEXT_FIELDS, toRanges } from './model.js';
import { entryValues, fingerprint, lessonNumbers, safeName } from './exportPlan.js';
import { instrumentsInWeek, schoolWeeks, weekLessonsFor } from './weekPlan.js';
import { driveOpenUrl } from './locations.js';

export const DEFAULT_LABEL = '{{copy_name}}';

/** Words the lesson label can use, besides every "Filled in automatically" detail ({{school}}, {{week_number}}…). */
export const LABEL_WORDS = {
  '{{copy_name}}': 'The copy’s file name',
  '{{template_name}}': 'The template’s name',
};

/** The year's report settings, with everything missing filled in. */
export function reportSettings(year) {
  const r = year?.reports ?? {};
  const m = r.manual ?? {};
  return {
    label: r.label || '',
    weekly: r.weekly !== false,
    manual: {
      fromWeek: m.fromWeek ?? null, toWeek: m.toWeek ?? null,
      schoolIds: m.schoolIds ?? [], gradeIds: m.gradeIds ?? [], perGrade: Boolean(m.perGrade), folder: m.folder ?? null,
    },
  };
}

/** The lesson label with its words swapped for the lesson's details (unknown words stay as typed). */
export function lessonLabel(label, words) {
  const text = (label || DEFAULT_LABEL).replace(/\{\{\s*([\w]+)\s*\}\}/g, (all, key) => words[`{{${key}}}`] ?? all);
  return text.trim() || words['{{copy_name}}'];
}

/** "Drum (all week)" or "Drum (available Oct 6 - Oct 7)" (days apart: "Oct 6, Oct 8 - Oct 9"). */
export function instrumentText(name, { days, allWeek }) {
  if (allWeek) return `${name} (all week)`;
  const ranges = toRanges(days).map(([a, b]) => (a === b ? formatShort(a) : `${formatShort(a)} - ${formatShort(b)}`));
  return `${name} (available ${ranges.join(', ')})`;
}

/** The instruments a class's school has during a week, as report lines (sorted by name). */
export function weekInstruments(state, cls, week) {
  return instrumentsInWeek(state, cls, week)
    .map((i) => ({ name: find(state, 'instruments', i.instrumentId)?.name ?? '', ...i }))
    .filter((i) => i.name)
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((i) => instrumentText(i.name, i));
}

/**
 * One week of a class: { number, dates, instruments: [text], lessons: [{ entryId, text, url }] }.
 * `copyOf(entryId)` → { name, url } of its lesson copy, or null (not made yet, or no template).
 */
export function reportWeek(state, cls, week, { label, copyOf, numbers }) {
  const days = week.days.length ? week.days : [week.weekStart];
  const lessons = weekLessonsFor(state, cls, week.weekStart).map((entry) => {
    const lesson = find(state, 'lessons', entry.lessonId);
    const copy = copyOf(entry.id);
    const values = entryValues(state, entry, week, numbers);
    const words = Object.fromEntries(TEXT_FIELDS.map((key) => [AUTO_FIELD_PLACEHOLDERS[key], values[key] ?? '']));
    words['{{copy_name}}'] = copy?.name || `${entry.position + 1} - ${lesson?.name ?? 'Lesson'}`;
    words['{{template_name}}'] = lesson?.name ?? '';
    return { entryId: entry.id, text: lessonLabel(label, words), url: copy?.url ?? null };
  });
  return { number: week.number, dates: formatRange(days[0], days.at(-1)), instruments: weekInstruments(state, cls, week), lessons };
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

/** One tab: a class over some weeks. { title (tab name), heading, subheading, weeks: [reportWeek] }. */
export function reportTab(state, cls, weeks, options) {
  const school = nameOf(state, 'schools', cls.schoolId);
  const grade = nameOf(state, 'grades', cls.gradeId);
  const days = weeks.flatMap((w) => (w.days.length ? w.days : [w.weekStart]));
  return {
    title: safeName(grade).slice(0, 90),
    heading: `${school} · ${grade}`,
    subheading: days.length ? `${weeksTitle(weeks)} · ${formatRange(days[0], days.at(-1))}` : weeksTitle(weeks),
    weeks: weeks.map((w) => reportWeek(state, cls, w, options)),
  };
}

/** A report file's fingerprint (it changes only when what the file shows would). */
export const reportHash = (file) => fingerprint(JSON.stringify([file.name, file.tabs]));

// ---------- the rows a tab shows ----------

export const REPORT_NOTE = 'Made by the Lesson Planner. It’s rewritten when the Lesson Schedule changes, so changes typed here don’t stay.';

/**
 * A tab as rows of cells: [{ text, url?, style }]. Styles: heading, subheading, week, label, instruments,
 * lesson, number, empty. Column A holds labels and lesson numbers, column B the rest.
 */
export function reportRows(tab) {
  const rows = [
    [{ text: tab.heading, style: 'heading' }],
    [{ text: tab.subheading, style: 'subheading' }],
    [],
  ];
  for (const week of tab.weeks) {
    rows.push([{ text: `Week ${week.number}`, style: 'week' }, { text: week.dates, style: 'week' }]);
    rows.push([{ text: 'Instruments', style: 'label' }, { text: week.instruments.join('\n') || 'None scheduled', style: 'instruments' }]);
    if (!week.lessons.length) rows.push([{ text: '', style: 'number' }, { text: 'No lessons on the schedule', style: 'empty' }]);
    week.lessons.forEach((l, i) => rows.push([{ text: String(i + 1), style: 'number' }, { text: l.text, url: l.url, style: 'lesson' }]));
    rows.push([]);
  }
  rows.push([{ text: REPORT_NOTE, style: 'note' }]);
  return rows;
}

// ---------- weekly reports (one per week folder of the lesson copies) ----------

/**
 * The weekly reports the lesson copies ask for: one per week folder (a class's week with at least one
 * wanted copy), placed in that folder. `wants` = wantedCopies(); `copyOf(entryId)` → { name, url } | null.
 * Returns [{ key, path, name, place, hash, tabs }].
 */
export function weeklyReports(state, yearId, { wants, copyOf, label, rootKey }) {
  const weeks = new Map(schoolWeeks(find(state, 'years', yearId)).map((w) => [w.weekStart, w]));
  const numbers = lessonNumbers(state.weekLessons.filter((e) => e.yearId === yearId && weeks.has(e.weekStart)));
  const files = new Map();
  for (const want of wants) {
    const entry = find(state, 'weekLessons', want.entryId);
    const key = entry && `${entry.schoolId}|${entry.gradeId}|${entry.weekStart}`;
    if (!entry || files.has(key)) continue;
    const week = weeks.get(entry.weekStart);
    const tab = reportTab(state, entry, [week], { label, copyOf, numbers });
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
export function manualReports(state, yearId, { manual, label, copyOf, defaultWeek }) {
  const year = find(state, 'years', yearId);
  const weeks = manualWeeks(year, manual, defaultWeek);
  const chosen = (collection, ids) => inYear(state, collection, yearId).filter((r) => !ids.length || ids.includes(r.id));
  const schools = chosen('schools', manual.schoolIds);
  const grades = chosen('grades', manual.gradeIds);
  if (!weeks.length || !grades.length) return [];
  const numbers = lessonNumbers(state.weekLessons.filter((e) => e.yearId === yearId));
  const groups = manual.perGrade ? grades.map((g) => [g]) : [grades];
  return schools.flatMap((school) => groups.map((group) => {
    const tabs = group.map((g) => reportTab(state, { yearId, schoolId: school.id, gradeId: g.id }, weeks, { label, copyOf, numbers }));
    const who = manual.perGrade ? `${school.name} – ${group[0].name}` : school.name;
    const file = {
      key: fingerprint(JSON.stringify([school.id, group.map((g) => g.id), weeks[0].number, weeks.at(-1).number])),
      name: safeName(`${who} – ${weeksTitle(weeks)} report`), schoolId: school.id, gradeIds: group.map((g) => g.id), tabs,
    };
    return { ...file, hash: reportHash(file) };
  }));
}
