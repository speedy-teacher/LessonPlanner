// Reports: Google Sheets listing each week's lessons in order (linked to their copies) and the
// instruments at the school that week — one in every week folder of the lesson copies (kept up to
// date), and ones made from the Reports tab for chosen weeks, schools and grades.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { add, createYear, emptyState, paintInstrument, update } from '../public/js/model.js';
import { addWeekLesson, moveWeekLesson, removeWeekLesson } from '../public/js/weekPlan.js';
import { canFillIn, driveFileId, driveLocation } from '../public/js/locations.js';
import { wantedCopies } from '../public/js/exportPlan.js';
import {
  copyFinder, instrumentsLine, tint, instrumentText, lessonLabel, manualReports, REPORT_NOTE, reportRows, reportSettings, reportSteps, SITE_URL,
  weeklyReports,
} from '../public/js/reportPlan.js';
import { driveReports, REPORT_LABEL, sheetCell, SHEETS, sheetRequests } from '../public/js/reportSheets.js';
import { runCommand } from '../public/js/agentCommands.js';
import { weeklyReportKeeper } from '../public/js/reportBridge.js';

const SLIDES = 'application/vnd.google-apps.presentation';
const DRIVE = { rootKey: 'drive:fakeRoot', yearFolder: 'Music Plan', templateOf: driveFileId, canFill: canFillIn };

function setup() {
  const s = emptyState();
  const year = createYear(s, { name: 'Year A', startDate: '2026-08-24', endDate: '2026-10-30' });
  const schoolA = add(s, 'schools', { yearId: year.id, name: 'School A' });
  const schoolB = add(s, 'schools', { yearId: year.id, name: 'School B' });
  const k = add(s, 'grades', { yearId: year.id, name: 'Kindergarten', short: 'K' });
  const g1 = add(s, 'grades', { yearId: year.id, name: 'Grade 1', short: '1' });
  const drum = add(s, 'instruments', { yearId: year.id, name: 'Drum', color: '#b5654a' });
  const bells = add(s, 'instruments', { yearId: year.id, name: 'Bells', color: '#3f6e8c' });
  const deck = (name) => add(s, 'lessons', {
    yearId: year.id, name, category: '', autoFields: ['week'], instrumentIds: [], locations: [driveLocation({ fileId: `tmpl-${name}`, mimeType: SLIDES })],
  });
  const beat = deck('Beat');
  const song = deck('Song');
  const noTemplate = add(s, 'lessons', { yearId: year.id, name: 'Game', category: '', autoFields: [], instrumentIds: [], locations: [] });
  return { s, year, schoolA, schoolB, k, g1, drum, bells, beat, song, noTemplate };
}

const WEEK3 = '2026-09-07';
const lessonAt = (t, lesson, { school = t.schoolA, grade = t.k, week = WEEK3 } = {}) => addWeekLesson(t.s, {
  yearId: t.year.id, schoolId: school.id, gradeId: grade.id, weekStart: week, lessonId: lesson.id,
});

/** Pretend lesson copies, one per wanted copy, like the export bridge makes them. */
const copiesFor = (wants) => wants.map((w, i) => ({ id: `copy${i}`, entryId: w.entryId, name: w.name, mimeType: SLIDES }));

function weekly(t, { label = '', copies } = {}) {
  const wants = wantedCopies(t.s, t.year.id, DRIVE);
  return weeklyReports(t.s, t.year.id, { wants, copyOf: copyFinder(copies ?? copiesFor(wants)), label, rootKey: DRIVE.rootKey });
}

test('every week folder of the lesson copies gets a report: lessons in order, linked to their copies', () => {
  const t = setup();
  lessonAt(t, t.beat);
  lessonAt(t, t.noTemplate);
  lessonAt(t, t.song);
  lessonAt(t, t.song, { grade: t.g1, week: '2026-09-14' });
  const reports = weekly(t);
  assert.equal(reports.length, 2);
  const [kWeek3] = reports;
  assert.equal(kWeek3.name, 'Week 3 report');
  assert.deepEqual(kWeek3.path, ['Music Plan', 'School A', 'Kindergarten', 'Week 3']);
  const [tab] = kWeek3.tabs;
  assert.equal(tab.heading, 'School A · Kindergarten');
  assert.deepEqual(tab.weeks[0].lessons.map((l) => l.text), ['1 - Beat', '2 - Game', '3 - Song']);
  assert.match(tab.weeks[0].lessons[0].url, /^https:\/\/docs\.google\.com\/presentation\/d\/copy0\/edit$/);
  assert.equal(tab.weeks[0].lessons[1].url, null, 'a lesson with no copy is listed without a link');
  assert.equal(reports[1].tabs[0].heading, 'School A · Grade 1');
});

test('each week says which instruments its lessons need, then the others at the school that week', () => {
  const t = setup();
  const ukulele = add(t.s, 'instruments', { yearId: t.year.id, name: 'Ukulele', color: '#6a4c93' });
  t.beat.instrumentIds = [t.drum.id];
  t.song.instrumentIds = [ukulele.id, t.drum.id];
  lessonAt(t, t.beat);
  lessonAt(t, t.song);
  paintInstrument(t.s, { yearId: t.year.id, schoolId: t.schoolA.id, instrumentId: t.drum.id, dates: ['2026-09-07', '2026-09-08', '2026-09-09', '2026-09-10', '2026-09-11'], on: true });
  paintInstrument(t.s, { yearId: t.year.id, schoolId: t.schoolA.id, instrumentId: t.bells.id, dates: ['2026-09-08', '2026-09-09'], on: true });
  paintInstrument(t.s, { yearId: t.year.id, schoolId: t.schoolB.id, instrumentId: t.bells.id, dates: ['2026-09-07'], on: true });
  const [report] = weekly(t);
  const { instruments } = report.tabs[0].weeks[0];
  assert.deepEqual(instruments, {
    required: ['Drum (all week)', 'Ukulele (not at the school this week)'],
    also: ['Bells (available Sep 8 - Sep 9)'],
  });
  assert.equal(instrumentsLine(instruments), 'Required: Drum (all week), Ukulele (not at the school this week) / Also available: Bells (available Sep 8 - Sep 9)');
  assert.equal(instrumentsLine({ required: [], also: [] }), 'Required: none / Also available: none');
  assert.equal(instrumentText('Drum', { days: ['2026-09-07', '2026-09-09', '2026-09-10'], allWeek: false }), 'Drum (available Sep 7, Sep 9 - Sep 10)');
});

test('how each lesson is written can be chosen; the default is the copy name', () => {
  const t = setup();
  lessonAt(t, t.beat);
  assert.equal(weekly(t)[0].tabs[0].weeks[0].lessons[0].text, '1 - Beat');
  assert.equal(weekly(t, { label: '{{copy_name}} / {{template_name}}' })[0].tabs[0].weeks[0].lessons[0].text, '1 - Beat / Beat');
  assert.equal(weekly(t, { label: 'Week {{week_number}}: {{template_name}} {{unknown}}' })[0].tabs[0].weeks[0].lessons[0].text, 'Week 3: Beat {{unknown}}');
  assert.equal(lessonLabel('   ', { '{{copy_name}}': 'X' }), 'X');
});

test('weekly reports are made once, updated when the week changes, and removed when the week empties', () => {
  const t = setup();
  const first = lessonAt(t, t.beat);
  let haves = [];
  const sync = () => {
    const steps = reportSteps(weekly(t), haves);
    for (const step of steps) {
      if (step.kind === 'remove') haves = haves.filter((h) => h !== step.have);
      else haves = [...haves.filter((h) => h !== step.have), { id: step.have?.id ?? `r${haves.length}`, ...step.want }];
    }
    return steps.map((s) => s.kind);
  };
  assert.deepEqual(sync(), ['create']);
  assert.deepEqual(sync(), [], 'nothing to do when nothing changed');
  lessonAt(t, t.song);
  assert.deepEqual(sync(), ['update']);
  moveWeekLesson(t.s, first.id, '2026-09-14');
  assert.deepEqual(sync().sort(), ['create', 'update']);
  removeWeekLesson(t.s, first.id);
  assert.deepEqual(sync(), ['remove']);
  update(t.s, 'years', t.year.id, { reports: { weekly: false } });
  assert.equal(reportSettings(t.s.years[0]).weekly, false);
});

test('Reports tab: one file per school with a tab per grade, or one file per grade', () => {
  const t = setup();
  lessonAt(t, t.beat);
  lessonAt(t, t.song, { grade: t.g1, week: '2026-09-14' });
  lessonAt(t, t.beat, { school: t.schoolB });
  const manual = { ...reportSettings(t.year).manual, fromWeek: 3, toWeek: 4 };
  const files = manualReports(t.s, t.year.id, { manual, label: '', copyOf: () => null });
  assert.deepEqual(files.map((f) => f.name), ['School A – Weeks 3–4 report', 'School B – Weeks 3–4 report']);
  assert.deepEqual(files[0].tabs.map((tab) => tab.title), ['Kindergarten', 'Grade 1']);
  assert.equal(files[0].tabs[1].heading, 'School A · Grade 1');
  assert.equal(files[0].tabs[1].subheading, 'Weeks 3–4 · Sep 7 – Sep 18');
  assert.deepEqual(files[0].tabs[1].weeks.map((w) => [w.number, w.lessons.map((l) => l.text)]), [[3, []], [4, ['1 - Song']]]);

  const perGrade = manualReports(t.s, t.year.id, { manual: { ...manual, perGrade: true, schoolIds: [t.schoolA.id] }, label: '', copyOf: () => null });
  assert.deepEqual(perGrade.map((f) => f.name), ['School A – Kindergarten – Weeks 3–4 report', 'School A – Grade 1 – Weeks 3–4 report']);
  assert.ok(perGrade.every((f) => f.tabs.length === 1));
  const again = manualReports(t.s, t.year.id, { manual: { ...manual, perGrade: true, schoolIds: [t.schoolA.id] }, label: '', copyOf: () => null });
  assert.equal(again[0].key, perGrade[0].key, 'making the same report again finds the same file');
  const shifted = manualReports(t.s, t.year.id, { manual: { ...manual, fromWeek: 4, toWeek: 5, perGrade: true, schoolIds: [t.schoolA.id] }, label: '', copyOf: () => null });
  assert.equal(shifted[0].key, perGrade[0].key, 'other weeks: the same file, brought up to date');
  assert.notEqual(shifted[0].name, perGrade[0].name);
});

test('a tab shows the school and grade at the top, then each week, its instruments and its lessons', () => {
  const t = setup();
  lessonAt(t, t.beat);
  const [file] = manualReports(t.s, t.year.id, { manual: { ...reportSettings(t.year).manual, fromWeek: 3, schoolIds: [t.schoolA.id], gradeIds: [t.k.id] }, label: '', copyOf: () => ({ name: 'Copy', url: 'https://example.test/c' }) });
  const rows = reportRows(file.tabs[0]).map((r) => r.map((c) => c.text));
  assert.deepEqual(rows, [
    ['School A · Kindergarten'], ['Week 3 · Sep 7 – Sep 11'], [],
    ['Week 3', 'Sep 7 – Sep 11'], ['Instruments', 'Required: none / Also available: none'], ['1', 'Copy'], [],
    ['Automatically maintained by Lesson Planner'],
  ]);
});

test('the footer says the report is kept by Lesson Planner (linked to the site), and can be turned off', () => {
  const t = setup();
  lessonAt(t, t.beat);
  const manual = { ...reportSettings(t.year).manual, fromWeek: 3, schoolIds: [t.schoolA.id], gradeIds: [t.k.id] };
  const [file] = manualReports(t.s, t.year.id, { manual, copyOf: () => null });
  const footer = reportRows(file.tabs[0]).at(-1)[0];
  assert.equal(footer.text, REPORT_NOTE);
  assert.equal(footer.url, SITE_URL);
  const cell = sheetCell(footer);
  assert.deepEqual(cell.textFormatRuns.map((r) => [r.startIndex, r.format.link?.uri ?? null]), [[0, null], [28, SITE_URL]]);
  assert.equal(REPORT_NOTE.slice(28), 'Lesson Planner');
  assert.equal(cell.userEnteredFormat.textFormat.link, undefined, 'only the words "Lesson Planner" link');

  const [plain] = manualReports(t.s, t.year.id, { manual, footer: false, copyOf: () => null });
  assert.notEqual(reportRows(plain.tabs[0]).at(-1)[0]?.text, REPORT_NOTE);
  runCommand(t.s, 'setReportOptions', { footer: false });
  assert.equal(reportSettings(t.s.years[0]).footer, false);
  assert.equal(runCommand(t.s, 'previewReport')[0].tabs[0].rows.at(-1).length, 0, 'last row is the blank after the week');
});

test('the Google Sheet gets a new tab per grade (old tabs out), linked lessons and a big title', () => {
  const t = setup();
  lessonAt(t, t.beat);
  const [file] = manualReports(t.s, t.year.id, { manual: { ...reportSettings(t.year).manual, fromWeek: 3, schoolIds: [t.schoolA.id] }, label: '', copyOf: () => ({ name: 'Copy', url: 'https://example.test/c' }) });
  const requests = sheetRequests([0], file.tabs, [11, 12]);
  assert.deepEqual(requests.filter((r) => r.addSheet).map((r) => r.addSheet.properties.sheetId), [11, 12]);
  assert.deepEqual(requests.filter((r) => r.deleteSheet), [{ deleteSheet: { sheetId: 0 } }]);
  const titles = requests.filter((r) => r.updateSheetProperties).map((r) => r.updateSheetProperties.properties.title);
  assert.deepEqual(titles, ['Kindergarten', 'Grade 1']);
  const cells = requests.find((r) => r.updateCells).updateCells.rows;
  assert.equal(cells[0].values[0].userEnteredValue.stringValue, 'School A · Kindergarten');
  assert.ok(cells[0].values[0].userEnteredFormat.textFormat.bold);
  assert.equal(cells[5].values[1].userEnteredFormat.textFormat.link.uri, 'https://example.test/c');
});

/** Whether a search (Drive "q", maybe "'<folder>' in parents") finds the file. */
function listed(url, file) {
  const folder = url.searchParams.get('q')?.match(/^.*'([^']*)' in parents/)?.[1];
  return !file.trashed && (!folder || Boolean(file.parents?.includes(folder)));
}

/** A pretend Drive + Sheets that records every request. */
function fakeGoogle() {
  const files = new Map();
  const calls = [];
  let n = 0;
  const json = (body) => new Response(JSON.stringify(body), { status: 200 });
  const send = async (url, init = {}) => {
    const u = new URL(url);
    const body = init.body ? JSON.parse(init.body) : null;
    calls.push({ method: init.method || 'GET', url: u, body });
    if (u.host === 'sheets.googleapis.com') return json(u.pathname.endsWith(':batchUpdate') ? {} : { sheets: [{ properties: { sheetId: 0 } }] });
    const id = u.pathname.match(/\/files\/([^/]+)/)?.[1];
    if (init.method === 'POST') { n += 1; const f = { id: `s${n}`, ...body }; files.set(f.id, f); return json(f); }
    if (init.method === 'PATCH') {
      const f = files.get(id);
      Object.assign(f, { ...body, appProperties: { ...f.appProperties, ...body.appProperties } });
      if (u.searchParams.get('addParents')) f.parents = [u.searchParams.get('addParents')];
      return json(f);
    }
    return json({ files: [...files.values()].filter((f) => listed(u, f)) });
  };
  return { files, calls, send };
}

test('reports are Google Sheets in Drive, labelled so they are found again, rewritten only when they change', async () => {
  const t = setup();
  lessonAt(t, t.beat);
  const g = fakeGoogle();
  const reports = driveReports({ send: g.send, yearId: t.year.id, random: () => 0.5 });
  const [want] = weekly(t);
  const made = await reports.create('weekly', want, 'weekFolder');
  const file = g.files.get(made.id);
  assert.equal(file.mimeType, SHEETS);
  assert.deepEqual(file.parents, ['weekFolder']);
  assert.equal(file.appProperties[REPORT_LABEL], t.year.id);
  assert.equal(made.hash, want.hash);
  assert.ok(g.calls.some((c) => c.url.pathname.endsWith(':batchUpdate')));

  const before = g.calls.length;
  await reports.update('weekly', made, { ...want, name: 'Renamed' }, 'weekFolder');
  assert.ok(!g.calls.slice(before).some((c) => c.url.host === 'sheets.googleapis.com'), 'same contents: not rewritten');
  assert.equal(g.files.get(made.id).name, 'Renamed');

  const list = await reports.list('weekly');
  assert.match(g.calls.at(-1).url.searchParams.get('q'), /lessonPlannerReport.*reportKind/);
  assert.equal(list[0].key, want.key);
  await reports.remove(list[0]);
  assert.equal(g.files.get(made.id).trashed, true);
});

test('an assistant can set up the report and its options, and preview it', () => {
  const t = setup();
  lessonAt(t, t.beat);
  runCommand(t.s, 'setupReport', { fromWeek: 3, toWeek: '2026-09-16', schools: 'School A', grades: ['K'], oneFilePer: 'grade' });
  runCommand(t.s, 'setReportOptions', { lessonText: '{{template_name}}', weeklyReports: false });
  const settings = runCommand(t.s, 'reportSettings');
  assert.deepEqual(settings, {
    lessonText: '{{template_name}}', rowsAbove: [], rowsBelow: [], columnsBefore: [], columnsAfter: [], columnNames: true, footer: true, weeklyReports: false, fromWeek: 3, toWeek: 4,
    schools: ['School A'], grades: ['Kindergarten'], oneFilePer: 'grade', folder: null, keepUpToDate: false,
  });
  const [preview] = runCommand(t.s, 'previewReport');
  assert.equal(preview.file, 'School A – Kindergarten – Weeks 3–4 report');
  assert.deepEqual(preview.tabs[0].rows[5], ['1', 'Beat']);
  assert.throws(() => runCommand(t.s, 'setupReport', { fromWeek: 4, toWeek: 3 }), /after the first week/);
  runCommand(t.s, 'setReportOptions', { rowsAbove: ['{{essential_outcome}}'], rowsBelow: 'Eval: {{eval_criterion}}' });
  assert.deepEqual(runCommand(t.s, 'reportSettings').rowsBelow, ['Eval: {{eval_criterion}}']);
  assert.equal(runCommand(t.s, 'reportSettings').lessonText, '{{template_name}}', 'other options are kept');
  runCommand(t.s, 'setupReport', { schools: 'all' });
  assert.equal(runCommand(t.s, 'reportSettings').schools, 'all');
});

test('rows can be added above and below each lesson, e.g. its essential outcome', () => {
  const t = setup();
  const outcome = add(t.s, 'outcomes', { yearId: t.year.id, code: 'MU1', title: 'Rhythm', color: '#6b8f5e' });
  const crit = add(t.s, 'criteria', { outcomeId: outcome.id, title: 'Keeps a steady beat', gradeIds: [t.k.id], mainGradeId: null });
  const entry = lessonAt(t, t.beat);
  entry.criterionId = crit.id;
  lessonAt(t, t.song); // no eval: its outcome row is left out, its plain row stays
  const manual = { ...reportSettings(t.year).manual, fromWeek: 3, schoolIds: [t.schoolA.id], gradeIds: [t.k.id] };
  const look = { label: '', above: ['{{essential_outcome}}'], below: ['Eval: {{eval_criterion}}', 'Bring scarves'], copyOf: () => null };
  const [file] = manualReports(t.s, t.year.id, { manual, ...look });
  const rows = reportRows(file.tabs[0]).slice(5, -2).map((r) => r.map((c) => `${c.text}${c.style === 'extra' ? '*' : ''}`));
  assert.deepEqual(rows, [
    ['', 'MU1 · Rhythm*'], ['1', '1 - Beat'], ['', 'Eval: Keeps a steady beat*'], ['', 'Bring scarves*'],
    ['2', '2 - Song'], ['', 'Bring scarves*'],
  ]);
  const settings = reportSettings({ reports: { above: ['{{essential_outcome}}'] } });
  assert.deepEqual([settings.above, settings.below], [['{{essential_outcome}}'], []]);

  const [weeklyReport] = weeklyReports(t.s, t.year.id, {
    wants: wantedCopies(t.s, t.year.id, DRIVE), copyOf: () => null, rootKey: DRIVE.rootKey, label: '', above: ['{{essential_outcome}}'],
  });
  assert.deepEqual(weeklyReport.tabs[0].weeks[0].lessons[0].above, ['MU1 · Rhythm']);
  const cells = sheetRequests([0], [weeklyReport.tabs[0]], [5]).find((r) => r.updateCells).updateCells.rows;
  assert.equal(cells[5].values[1].userEnteredValue.stringValue, 'MU1 · Rhythm');
  assert.equal(cells[5].values[1].userEnteredFormat.textFormat.fontSize, 9);
});

test('columns can be added before and after the lesson, with titles at the top', () => {
  const t = setup();
  const outcome = add(t.s, 'outcomes', { yearId: t.year.id, code: 'MU1', title: 'Rhythm', color: '#6b8f5e' });
  const crit = add(t.s, 'criteria', { outcomeId: outcome.id, title: 'Keeps a steady beat', gradeIds: [t.k.id], mainGradeId: null });
  lessonAt(t, t.beat).criterionId = crit.id;
  lessonAt(t, t.song);
  const manual = { ...reportSettings(t.year).manual, fromWeek: 3, schoolIds: [t.schoolA.id], gradeIds: [t.k.id] };
  const look = {
    label: '', left: [{ name: 'Outcome', value: '{{essential_outcome}}' }],
    right: ['Eval: {{eval_criterion}}'], // an older plain-text column: named after its words
    below: ['Bring scarves'], copyOf: () => null,
  };
  const [file] = manualReports(t.s, t.year.id, { manual, ...look });
  const tab = file.tabs[0];
  assert.deepEqual(tab.columns, { left: ['Outcome'], right: ['Eval: Eval criterion'], names: true });
  const rows = reportRows(tab);
  const texts = rows.map((r) => r.map((c) => c.text));
  assert.deepEqual(texts[2], ['', 'Outcome', 'Lesson', 'Eval: Eval criterion']);
  assert.deepEqual(texts.slice(5, 9), [
    ['1', 'MU1 · Rhythm', '1 - Beat', 'Eval: Keeps a steady beat'],
    ['', '', 'Bring scarves', ''],
    ['2', '', '2 - Song', 'Eval:'],
    ['', '', 'Bring scarves', ''],
  ]);
  assert.equal(rows[0][0].span, 4, 'the title spans every column');
  assert.equal(rows[3][1].span, 3, 'the week dates span the rest of the row');

  const requests = sheetRequests([0], [tab], [7]);
  assert.equal(requests[0].addSheet.properties.gridProperties.columnCount, 4);
  assert.equal(requests[0].addSheet.properties.gridProperties.frozenRowCount, 3);
  const merged = requests.filter((r) => r.mergeCells).map((r) => r.mergeCells.range);
  assert.deepEqual(merged[0], { sheetId: 7, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 0, endColumnIndex: 4 });
  assert.ok(merged.some((m) => m.startRowIndex === 3 && m.startColumnIndex === 1 && m.endColumnIndex === 4));
  const widths = requests.filter((r) => r.updateDimensionProperties?.range.dimension === 'COLUMNS').map((r) => r.updateDimensionProperties.properties.pixelSize);
  assert.equal(widths.length, 4);

  const [unnamed] = manualReports(t.s, t.year.id, { manual, ...look, columnNames: false });
  assert.deepEqual(reportRows(unnamed.tabs[0])[2], [], 'column names can be hidden');
  assert.equal(sheetRequests([0], [unnamed.tabs[0]], [7])[0].addSheet.properties.gridProperties.frozenRowCount, 2);

  runCommand(t.s, 'setReportOptions', { columnsBefore: [{ name: 'Outcome', value: '{{essential_outcome}}' }] });
  assert.deepEqual(runCommand(t.s, 'reportSettings').columnsBefore, [{ name: 'Outcome', value: '{{essential_outcome}}' }]);
  assert.deepEqual(runCommand(t.s, 'previewReport')[0].tabs[0].rows[2], ['', 'Outcome', 'Lesson']);
  runCommand(t.s, 'setReportOptions', { columnNames: false });
  assert.deepEqual(runCommand(t.s, 'previewReport')[0].tabs[0].rows[2], []);
});

test('the title bar wears the grade’s color, with text that reads on it', () => {
  const t = setup();
  lessonAt(t, t.beat);
  const rowsFor = (color) => {
    update(t.s, 'grades', t.k.id, { color });
    const [file] = manualReports(t.s, t.year.id, { manual: { ...reportSettings(t.year).manual, fromWeek: 3, schoolIds: [t.schoolA.id], gradeIds: [t.k.id] }, copyOf: () => null });
    return reportRows(file.tabs[0]);
  };
  const [dark] = rowsFor('#3f6e8c');
  assert.equal(dark[0].color, '#3f6e8c');
  assert.equal(dark[0].ink, '#ffffff', 'a dark grade color gets white text');
  const [light, softLight] = rowsFor('#f2d98a');
  assert.equal(light[0].ink, '#3f3127', 'a light grade color gets dark text');
  assert.notEqual(softLight[0].color, '#f2d98a', 'the dates bar is a softer tint of the same color');
  const bar = sheetCell(light[0]).userEnteredFormat;
  assert.ok(Math.abs(bar.backgroundColor.red - 0xf2 / 255) < 0.001);
  assert.ok(bar.textFormat.foregroundColor.red < 0.3, 'dark text on a light bar');
  assert.equal(tint('#000000', 0.5), '#808080');
});

test('reports made on the Reports tab are kept up to date: made once, updated in place, never twice', async () => {
  const t = setup();
  lessonAt(t, t.beat);
  update(t.s, 'years', t.year.id, { output: { kind: 'drive', folderId: 'copiesRoot', name: 'Output' } });
  const g = fakeGoogle();
  const keeper = weeklyReportKeeper({ send: g.send, folderFor: async () => 'weekFolder' }, t.year.id);
  const context = () => ({ wants: wantedCopies(t.s, t.year.id, DRIVE), copies: [], rootKey: DRIVE.rootKey });
  const run = async () => {
    await keeper.sync(t.s);
    const steps = keeper.steps(t.s, context());
    await keeper.run(steps, { goOn: () => true, show: () => {}, problem: (e) => { throw e; }, stoppers: [] });
    return steps.map((s) => `${s.group}:${s.kind}`);
  };
  const keep = (manual) => update(t.s, 'years', t.year.id, { reports: { weekly: false, manual: { fromWeek: 3, schoolIds: [t.schoolA.id], gradeIds: [t.k.id], keepUpToDate: true, ...manual } } });

  update(t.s, 'years', t.year.id, { reports: { weekly: false, manual: { fromWeek: 3, schoolIds: [t.schoolA.id], gradeIds: [t.k.id] } } });
  await keeper.load(t.s);
  assert.deepEqual(await run(), [], 'off: nothing is made');

  keep({});
  assert.deepEqual(await run(), ['manual:create'], 'the folder defaults to the lesson copies folder');
  const [made] = [...g.files.values()];
  assert.deepEqual(made.parents, ['copiesRoot']);
  assert.equal(made.appProperties.reportKind, 'manual');
  assert.deepEqual(await run(), [], 'up to date: nothing to do');
  assert.deepEqual(keeper.manualFiles().map((f) => f.name), ['School A – Week 3 report']);

  lessonAt(t, t.song);
  assert.deepEqual(await run(), ['manual:update']);
  keep({ toWeek: 4 });
  assert.deepEqual(await run(), ['manual:update'], 'other weeks: the same file is updated and renamed');
  assert.equal(g.files.size, 1);
  assert.equal([...g.files.values()][0].name, 'School A – Weeks 3–4 report');

  keeper.manualHaves = []; // another computer made it meanwhile, and this one doesn't know yet
  assert.deepEqual(await run(), ['manual:create'], 'it thinks it must make it');
  assert.equal(g.files.size, 1, 'never made twice');

  keep({ folder: { folderId: 'otherFolder', name: 'Other' } });
  assert.deepEqual(keeper.steps(t.s, context()), [], 'a different folder is looked at first');
  assert.deepEqual(await run(), ['manual:create']);
  assert.equal(g.files.size, 2, 'the old one is left where it is');
});
