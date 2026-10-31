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
  copyFinder, instrumentText, lessonLabel, manualReports, REPORT_NOTE, reportRows, reportSettings, reportSteps, weeklyReports,
} from '../public/js/reportPlan.js';
import { driveReports, REPORT_LABEL, SHEETS, sheetRequests } from '../public/js/reportSheets.js';
import { runCommand } from '../public/js/agentCommands.js';

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

test('weekly reports show the instruments at the school that week', () => {
  const t = setup();
  lessonAt(t, t.beat);
  paintInstrument(t.s, { yearId: t.year.id, schoolId: t.schoolA.id, instrumentId: t.drum.id, dates: ['2026-09-07', '2026-09-08', '2026-09-09', '2026-09-10', '2026-09-11'], on: true });
  paintInstrument(t.s, { yearId: t.year.id, schoolId: t.schoolA.id, instrumentId: t.bells.id, dates: ['2026-09-08', '2026-09-09'], on: true });
  paintInstrument(t.s, { yearId: t.year.id, schoolId: t.schoolB.id, instrumentId: t.bells.id, dates: ['2026-09-07'], on: true });
  const [report] = weekly(t);
  assert.deepEqual(report.tabs[0].weeks[0].instruments, ['Bells (available Sep 8 - Sep 9)', 'Drum (all week)']);
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
});

test('a tab shows the school and grade at the top, then each week, its instruments and its lessons', () => {
  const t = setup();
  lessonAt(t, t.beat);
  const [file] = manualReports(t.s, t.year.id, { manual: { ...reportSettings(t.year).manual, fromWeek: 3, schoolIds: [t.schoolA.id], gradeIds: [t.k.id] }, label: '', copyOf: () => ({ name: 'Copy', url: 'https://example.test/c' }) });
  const rows = reportRows(file.tabs[0]).map((r) => r.map((c) => c.text));
  assert.deepEqual(rows, [
    ['School A · Kindergarten'], ['Week 3 · Sep 7 – Sep 11'], [],
    ['Week 3', 'Sep 7 – Sep 11'], ['Instruments', 'None scheduled'], ['1', 'Copy'], [],
    [REPORT_NOTE],
  ]);
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
    return json({ files: [...files.values()].filter((f) => !f.trashed) });
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
    lessonText: '{{template_name}}', weeklyReports: false, fromWeek: 3, toWeek: 4,
    schools: ['School A'], grades: ['Kindergarten'], oneFilePer: 'grade', folder: null,
  });
  const [preview] = runCommand(t.s, 'previewReport');
  assert.equal(preview.file, 'School A – Kindergarten – Weeks 3–4 report');
  assert.deepEqual(preview.tabs[0].rows[5], ['1', 'Beat']);
  assert.throws(() => runCommand(t.s, 'setupReport', { fromWeek: 4, toWeek: 3 }), /after the first week/);
  runCommand(t.s, 'setupReport', { schools: 'all' });
  assert.equal(runCommand(t.s, 'reportSettings').schools, 'all');
});
