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
//   manual = { fromWeek, toWeek, schoolIds[], gradeIds[], layout, direction, perGrade, folder: { folderId, name } | null, keepUpToDate }
//            layout = 'school' (a file per school, a tab per grade), 'grade' (a file per school and grade) or
//            'together' (one file, a tab per school with every grade on it); missing = from the older `perGrade`
//            (kept in step, so older versions of the planner still read it). direction = 'down' (grades one
//            under another) or 'across' (side by side, weeks lined up) for 'together'.
//            keepUpToDate = "Make" also adds the reports it makes to `watched`
//   watched = the reports the export bridge keeps up to date (same file, same folder), each remembering how it was made:
//            [{ id, name, schoolId, gradeIds[], perGrade, fromWeek, toWeek, folder: { folderId, name } }]
//            ('together' ones also have layout, direction and schoolIds[] — empty = every school, like the form)
//            Taking one off the list never touches the file in Drive.

import { formatRange, formatShort } from './dates.js';
import { AUTO_FIELD_PLACEHOLDERS, AUTO_FIELDS, find, inYear, TEXT_FIELDS, toRanges } from './model.js';
import { entryValues, fingerprint, lessonNumbers, safeName } from './exportPlan.js';
import { instrumentsInWeek, schoolWeeks, weekLessonsFor } from './weekPlan.js';
import { driveFileId, driveOpenUrl } from './locations.js';
import { readableText } from './evalGrade.js';

export const DEFAULT_LABEL = '{{copy_name}}';

/** Words the lesson label can use, besides every "Filled in automatically" detail ({{school}}, {{week_number}}…). */
export const LABEL_WORDS = {
  '{{copy_name}}': 'The copy’s file name',
  '{{template_name}}': 'The template’s name',
  '{{copy_thumbnail}}': 'A small picture of the copy’s first slide or page (its cell shows only the picture)',
  '{{template_thumbnail}}': 'A small picture of the template’s first slide or page (its cell shows only the picture)',
};

/** Words that become a small picture of a Google file instead of text. */
export const PICTURE_WORDS = ['{{copy_thumbnail}}', '{{template_thumbnail}}'];

/** The address of a small picture of a Drive file's first slide or page. */
export const thumbnailUrl = (fileId) => `https://drive.google.com/thumbnail?id=${encodeURIComponent(fileId)}&sz=w400`;

/** Ways to lay out the files of a report made from the Reports tab. */
export const LAYOUTS = ['school', 'grade', 'together'];
export const DIRECTIONS = ['down', 'across'];

const REPORT_DEFAULTS = { label: '', above: [], below: [], left: [], right: [], columnNames: true, footer: true, weekly: true, watched: [] };
const MANUAL_DEFAULTS = {
  fromWeek: null, toWeek: null, schoolIds: [], gradeIds: [], layout: null, direction: 'down', perGrade: false, folder: null, keepUpToDate: false,
};

/**
 * How a report's files are laid out (see the top of this file). Apart from 'together', `perGrade` decides,
 * so a choice made on an older version of the planner (which only knows `perGrade`) still counts.
 */
export function fileLayout(manual) {
  if (manual?.layout === 'together') return 'together';
  return manual?.perGrade ? 'grade' : 'school';
}

/** Saved values over defaults (a missing or null value gets the default). */
const withDefaults = (defaults, saved = {}) => Object.fromEntries(Object.entries(defaults).map(([k, v]) => [k, saved[k] ?? v]));

/** The year's report settings, with everything missing filled in. */
export function reportSettings(year) {
  const r = year?.reports ?? {};
  const manual = withDefaults(MANUAL_DEFAULTS, r.manual ?? {});
  const layout = fileLayout(manual);
  const direction = DIRECTIONS.includes(manual.direction) ? manual.direction : 'down';
  const settings = { ...withDefaults(REPORT_DEFAULTS, r), manual: { ...manual, layout, direction, perGrade: layout === 'grade' } };
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
  const next = { ...before, ...manual };
  if (manual.perGrade !== undefined && manual.layout === undefined) next.layout = manual.perGrade ? 'grade' : 'school';
  if (LAYOUTS.includes(manual.layout)) next.perGrade = manual.layout === 'grade';
  return { ...top, ...patch, manual: { ...next, perGrade: fileLayout(next) === 'grade' } };
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
function extraRow(text, words, pictures = {}) {
  const picture = pictureIn(text, pictures);
  if (picture) return { text: fillWords(text, words), ...picture };
  const used = [...String(text ?? '').matchAll(WORD)].map((m) => words[`{{${m[1]}}}`]);
  return used.length && used.every((v) => v === '') ? '' : fillWords(text, words);
}

/** The first picture word in the text that has a picture for this lesson: { image, link } or null. */
function pictureIn(text, pictures) {
  const word = [...String(text ?? '').matchAll(WORD)].map((m) => `{{${m[1]}}}`).find((w) => pictures[w]);
  return word ? pictures[word] : null;
}

/**
 * A cell's value: its words filled in — plain text, or { text, image, link } when it names a picture
 * (a Sheet cell holds a picture or text, so the text is only shown where the picture can't be).
 */
export function fillCell(text, words, pictures = {}) {
  const picture = pictureIn(text, pictures);
  return picture ? { text: fillWords(text, words), ...picture } : fillWords(text, words);
}

/** A column's title: its words named, e.g. "{{essential_outcome}}" → "Essential outcome". */
export function columnTitle(text) {
  const names = {
    '{{copy_name}}': 'Copy', '{{template_name}}': 'Template', '{{copy_thumbnail}}': 'Copy picture', '{{template_thumbnail}}': 'Template picture',
    ...Object.fromEntries(TEXT_FIELDS.map((key) => [AUTO_FIELD_PLACEHOLDERS[key], AUTO_FIELDS[key]])),
  };
  return fillWords(text, names) || 'Notes';
}

const extraRows = (texts, words, pictures) => (texts ?? []).map((t) => extraRow(t, words, pictures)).filter(Boolean);

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
    const words = lessonWords(entryValues(state, entry, week, numbers), entry, lesson, copy);
    const pictures = lessonPictures(lesson, copy);
    const column = (c) => fillCell(asColumn(c).value, words, pictures);
    const picture = pictureIn(label, pictures);
    return {
      entryId: entry.id, lessonId: entry.lessonId, text: lessonLabel(label, words), url: copy?.url ?? null,
      ...(picture ? { image: picture.image, imageId: picture.fileId } : {}),
      above: extraRows(above, words, pictures), below: extraRows(below, words, pictures), left: left.map(column), right: right.map(column),
    };
  });
  return { number: week.number, dates: formatRange(days[0], days.at(-1)), instruments: weekInstruments(state, cls, week, lessons.map((l) => l.lessonId)), lessons };
}

/** What each word means for a lesson (picture words are '' here: pictures aren't words). */
function lessonWords(values, entry, lesson, copy) {
  const words = Object.fromEntries(TEXT_FIELDS.map((key) => [AUTO_FIELD_PLACEHOLDERS[key], values[key] ?? '']));
  words['{{copy_name}}'] = copy?.name || `${entry.position + 1} - ${lesson?.name ?? 'Lesson'}`;
  words['{{template_name}}'] = lesson?.name ?? '';
  PICTURE_WORDS.forEach((w) => { words[w] = ''; });
  return words;
}

/** The pictures a lesson's cells can show: picture word → { image, link } (left out when there's no Drive file). */
function lessonPictures(lesson, copy) {
  const templateId = driveFileId(lesson);
  const pictures = {};
  if (copy?.id) pictures['{{copy_thumbnail}}'] = { image: thumbnailUrl(copy.id), fileId: copy.id, link: copy.url ?? null };
  if (templateId) {
    const mimeType = lesson.locations.find((l) => l.fileId === templateId)?.mimeType ?? null;
    pictures['{{template_thumbnail}}'] = { image: thumbnailUrl(templateId), fileId: templateId, link: driveOpenUrl({ fileId: templateId, mimeType }) };
  }
  return pictures;
}

/** Lesson copies (Drive ones) → `copyOf` for reports: entry id → { id, name, url } of its copy, or null. */
export function copyFinder(copies) {
  const byEntry = new Map((copies ?? []).filter((c) => !c.fileName).map((c) => [c.entryId, c]));
  return (entryId) => {
    const c = byEntry.get(entryId);
    return c ? { id: c.id, name: c.name, url: driveOpenUrl({ fileId: c.id, mimeType: c.mimeType }) } : null;
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

/** Changes when how a report is laid out in the Sheet changes, so reports made the old way are rewritten. */
const LAYOUT_VERSION = 2;

/** A report file's fingerprint (it changes only when what the file shows would). */
export const reportHash = (file) => fingerprint(JSON.stringify([LAYOUT_VERSION, file.name, file.tabs]));

// ---------- the rows a tab shows ----------

export const REPORT_NOTE = 'Automatically maintained by Lesson Planner';
/** The live Lesson Planner site (the footer links "Lesson Planner" here). */
export const SITE_URL = 'https://speedy-teacher.github.io/LessonPlanner/';

/** Whether a tab has a row of column names at the top (a tab of every grade: each grade has them). */
export const showsColumnNames = (tab) => {
  const one = tab.parts?.[0] ?? tab;
  return classWidth(one) > 2 && one.columns?.names !== false;
};

/** How many columns one class's part has: the lesson number, extra columns left, the lesson, extra columns right. */
const classWidth = (tab) => 2 + (tab.columns?.left.length ?? 0) + (tab.columns?.right.length ?? 0);

/** How many columns a tab has (grades side by side: each grade's columns with an empty one between). */
export function reportWidth(tab) {
  if (!tab.parts) return classWidth(tab);
  const one = classWidth(tab.parts[0] ?? {});
  return tab.direction === 'across' ? tab.parts.length * (one + 1) - 1 : one;
}

/** How many rows at the top stay in view while scrolling (none when grades are one under another). */
export function frozenRows(tab) {
  if (tab.parts && tab.direction !== 'across') return 0;
  return showsColumnNames(tab) ? 3 : 2;
}

/**
 * A tab as rows of cells: [{ text, url?, linkText?, style, span?, color?, ink? }] (color/ink = this cell's background and text colors) (span = how many columns the cell covers, default 1;
 * linkText = only that part of the text links to url).
 * Styles: heading, subheading, columnHead, week, label, instruments, lesson, column (an extra column),
 * extra (a lesson's rows above/below it), number, empty, note. Column A holds labels and lesson numbers.
 */
export function reportRows(tab) {
  if (tab.parts) return combinedRows(tab);
  const { head, weeks } = reportParts(tab);
  return [...head, ...weeks.flat(), ...footerRows(tab)];
}

const footerRows = (tab) => (tab.footer !== false
  ? [[{ text: REPORT_NOTE, style: 'note', span: reportWidth(tab), url: SITE_URL, linkText: 'Lesson Planner' }]] : []);

/** One class's rows in pieces: the rows at the top (head), and each week's rows (ending in a blank row). */
function reportParts(tab) {
  const width = classWidth(tab);
  const wide = (text, style) => ({ text, style, span: width });
  const rest = (text, style) => ({ text, style, span: width - 1 });
  const { title, soft } = tab.look ?? {};
  const head = [
    [{ ...wide(tab.heading, 'heading'), ...title }], // the grade's color behind the title, with text that reads on it
    [{ ...wide(tab.subheading, 'subheading'), ...soft }],
    columnHeads(tab),
  ];
  const weeks = tab.weeks.map((week) => [
    [{ text: `Week ${week.number}`, style: 'week' }, rest(week.dates, 'week')],
    [{ text: 'Instruments', style: 'label' }, rest(instrumentsLine(week.instruments), 'instruments')],
    ...(week.lessons.length ? [] : [[{ text: '', style: 'number' }, rest('No lessons on the schedule', 'empty')]]),
    ...week.lessons.flatMap((l, i) => lessonRows(tab, l, i)),
    [],
  ]);
  return { head, weeks };
}

/**
 * A tab of every grade: each grade's rows one under another ('down'), or side by side ('across') with an
 * empty column between and every week starting on the same row. One footer at the bottom.
 */
function combinedRows(tab) {
  const parts = tab.parts.map(reportParts);
  if (tab.direction !== 'across') return [...parts.flatMap((p) => [...p.head, ...p.weeks.flat()]), ...footerRows(tab)];
  const width = classWidth(tab.parts[0] ?? {});
  const sections = [parts.map((p) => p.head), ...(parts[0]?.weeks ?? []).map((_, w) => parts.map((p) => p.weeks[w] ?? []))];
  return [...sections.flatMap((section) => sideBySide(section, width)), ...footerRows(tab)];
}

/** Rows of several grades side by side: each grade's row filled out to `width` columns, an empty column between. */
function sideBySide(blocks, width) {
  const height = Math.max(...blocks.map((rows) => rows.length));
  const filled = (row = []) => {
    const used = row.reduce((n, cell) => n + (cell.span ?? 1), 0);
    return used < width ? [...row, { text: '', style: 'blank', span: width - used }] : row;
  };
  return Array.from({ length: height }, (_, r) => blocks.flatMap((rows, i) => [
    ...(i ? [{ text: '', style: 'gap' }] : []), ...filled(rows[r]),
  ]));
}

/** Column names at the top, when there are extra columns and their names are shown (otherwise an empty row). */
function columnHeads(tab) {
  if (!showsColumnNames(tab)) return [];
  const head = (text) => ({ text, style: 'columnHead' });
  return [head(''), ...tab.columns.left.map(head), head('Lesson'), ...tab.columns.right.map(head)];
}

/** A filled-in value as a cell: plain text, or a picture ({ image, imageId = its Drive file }, linked to its file). */
function cellValue(value) {
  if (typeof value === 'string') return { text: value };
  return { text: value.text ?? '', image: value.image, imageId: value.fileId, ...(value.link ? { url: value.link } : {}) };
}

/** A lesson's rows: its extra rows above, the lesson itself (numbered, linked to its copy, with its columns), its rows below. */
function lessonRows(tab, lesson, i) {
  const blanks = (titles) => titles.map(() => ({ text: '', style: 'column' }));
  const { left = [], right = [] } = tab.columns ?? {};
  const extra = (text) => [{ text: '', style: 'number' }, ...blanks(left), { text, style: 'extra' }, ...blanks(right)];
  const column = (value) => ({ ...cellValue(value), style: 'column' });
  const extraOf = (value) => extra('').map((cell) => (cell.style === 'extra' ? { ...cellValue(value), style: 'extra' } : cell));
  const image = lesson.image ? { image: lesson.image, imageId: lesson.imageId } : {};
  return [
    ...(lesson.above ?? []).map(extraOf),
    [{ text: String(i + 1), style: 'number' }, ...(lesson.left ?? []).map(column),
      { text: lesson.text, url: lesson.url, style: 'lesson', ...image }, ...(lesson.right ?? []).map(column)],
    ...(lesson.below ?? []).map(extraOf),
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

/** The week number of the school week `today` falls in (the first week when it's not in a school week). */
export function currentWeekNumber(year, today) {
  const weeks = schoolWeeks(year);
  return (weeks.find((w) => w.weekStart <= today && today <= w.friday) ?? weeks[0])?.number ?? 1;
}

/** Where the Reports tab's reports go: the folder chosen there, else the lesson copies' Drive folder (or null). */
export function reportFolder(year) {
  const { folder } = reportSettings(year).manual;
  const output = year?.output;
  return folder ?? (output?.kind === 'drive' ? { folderId: output.folderId, name: output.name } : null);
}

/**
 * What to remember about a report so it can be kept up to date: how it was made (`manual` = the form's choices,
 * `file` = what manualReports made from them). The same choices always find the same Drive file again.
 */
export function watchedEntry(manual, file, folder) {
  const layout = fileLayout(manual);
  // The weeks are remembered as numbers (not "this week"), so the report stays about the weeks it was made for.
  const entry = {
    name: file.name, schoolId: file.schoolId, gradeIds: file.gradeIds, perGrade: layout === 'grade',
    fromWeek: file.fromWeek ?? manual.fromWeek, toWeek: file.toWeek ?? manual.toWeek, folder: { folderId: folder.folderId, name: folder.name },
  };
  const weeks = [entry.fromWeek, entry.toWeek];
  if (layout !== 'together') {
    return { id: fingerprint(JSON.stringify([entry.schoolId, entry.gradeIds, entry.perGrade, entry.folder.folderId, weeks])), ...entry };
  }
  const together = { ...entry, layout, direction: manual.direction ?? 'down', schoolIds: file.schoolIds };
  return { id: fingerprint(JSON.stringify([layout, together.schoolIds, together.gradeIds, together.folder.folderId, weeks])), ...together };
}

/**
 * The file in Drive that is this report: the one with its key, else one made before reports were kept per week
 * (`oldKey`, same school and grades) that still has its name — i.e. still shows these same weeks.
 */
export function sameReport(haves, want) {
  return haves.find((h) => h.key === want.key) ?? haves.find((h) => h.key === want.oldKey && h.name === want.name) ?? null;
}

/** The list with `entries` added (one already there, made the same way, is replaced). */
export const withWatched = (list, entries) => [...list.filter((w) => !entries.some((e) => e.id === w.id)), ...entries];

/** What a watched report says now (the one file it makes), or null when its school or grades are gone. */
export function watchedReport(state, yearId, entry, { settings, copyOf, defaultWeek }) {
  const manual = {
    fromWeek: entry.fromWeek, toWeek: entry.toWeek, schoolIds: entry.schoolIds ?? [entry.schoolId], gradeIds: entry.gradeIds,
    layout: fileLayout(entry), direction: entry.direction ?? 'down', perGrade: entry.perGrade, folder: entry.folder, keepUpToDate: false,
  };
  return manualReports(state, yearId, { ...settings, manual, copyOf, defaultWeek })[0] ?? null;
}

/** The school weeks a manual report covers (from/to are week numbers; missing = the given default week). */
export function manualWeeks(year, manual, defaultWeek = 1) {
  const weeks = schoolWeeks(year);
  const from = manual.fromWeek ?? defaultWeek;
  const to = Math.max(from, manual.toWeek ?? from);
  return weeks.filter((w) => w.number >= from && w.number <= to);
}

/**
 * The files a manual report makes (see `layout` at the top): one per school (a tab per grade), one per
 * school and grade, or one with a tab per school showing every grade. Schools and grades not chosen =
 * every one. Returns [{ key, oldKey, name, schoolId, schoolIds?, gradeIds, fromWeek, toWeek, tabs, hash }]
 * (the key finds the same file again — same schools, grades and weeks — so making the report again updates it,
 * while a report for other weeks is a file of its own; `oldKey` = the key before weeks counted, see sameReport).
 */
export function manualReports(state, yearId, { manual, copyOf, defaultWeek, ...look }) {
  const year = find(state, 'years', yearId);
  const weeks = manualWeeks(year, manual, defaultWeek);
  const chosen = (collection, ids) => inYear(state, collection, yearId).filter((r) => !ids.length || ids.includes(r.id));
  const schools = chosen('schools', manual.schoolIds);
  const grades = chosen('grades', manual.gradeIds);
  if (!weeks.length || !grades.length || !schools.length) return [];
  const numbers = lessonNumbers(state.weekLessons.filter((e) => e.yearId === yearId));
  const tabOf = (school, g, extra = {}) => reportTab(state, { yearId, schoolId: school.id, gradeId: g.id }, weeks, { ...look, ...extra, copyOf, numbers });
  const layout = fileLayout(manual);
  if (layout === 'together') return [togetherFile({ manual, schools, grades, weeks, footer: look.footer }, tabOf)];
  const span = weeksSpan(weeks);
  const groups = layout === 'grade' ? grades.map((g) => [g]) : [grades];
  return schools.flatMap((school) => groups.map((group) => {
    const tabs = group.map((g) => tabOf(school, g));
    const who = layout === 'grade' ? `${school.name} – ${group[0].name}` : school.name;
    const ids = [school.id, group.map((g) => g.id)];
    const file = {
      key: fingerprint(JSON.stringify([...ids, span])), oldKey: fingerprint(JSON.stringify(ids)), place: '',
      name: safeName(`${who} – ${weeksTitle(weeks)} report`), schoolId: school.id, gradeIds: group.map((g) => g.id), ...span, tabs,
    };
    return { ...file, hash: reportHash(file) };
  }));
}

/** The first and last week number a report covers. */
const weeksSpan = (weeks) => ({ fromWeek: weeks[0].number, toWeek: weeks.at(-1).number });

/** The one file of a report with every grade together: a tab per school, its grades down or across. */
function togetherFile({ manual, schools, grades, weeks, footer }, tabOf) {
  const tabs = schools.map((school) => ({
    title: safeName(school.name).slice(0, 90), heading: school.name, direction: manual.direction === 'across' ? 'across' : 'down',
    footer: footer !== false, parts: grades.map((g) => tabOf(school, g, { footer: false })),
  }));
  const who = manual.schoolIds.length ? schools.map((s) => s.name).join(' & ') : 'All schools';
  const ids = ['together', manual.schoolIds, manual.gradeIds];
  const span = weeksSpan(weeks);
  const file = {
    key: fingerprint(JSON.stringify([...ids, span])), oldKey: fingerprint(JSON.stringify(ids)), place: '',
    name: safeName(`${who} – all grades – ${weeksTitle(weeks)} report`), schoolId: null, schoolIds: manual.schoolIds, gradeIds: manual.gradeIds, ...span, tabs,
  };
  return { ...file, hash: reportHash(file) };
}
