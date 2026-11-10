// "Keep these reports up to date automatically": a report made for some weeks stays about those weeks.
// Making the next week's report must not change an earlier week's Google Sheet.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { add, createYear, emptyState, update } from '../public/js/model.js';
import { addWeekLesson } from '../public/js/weekPlan.js';
import { driveLocation } from '../public/js/locations.js';
import { manualReports, reportSettings, watchedEntry, withWatched } from '../public/js/reportPlan.js';
import { makeReports } from '../public/js/reportMaker.js';
import { weeklyReportKeeper } from '../public/js/reportBridge.js';
import { fakeGoogle } from './fixtures/fakeGoogle.js';

const SLIDES = 'application/vnd.google-apps.presentation';
const FOLDER = { folderId: 'reportsFolder', name: 'Reports' };
const WEEK3 = '2026-09-07';
const WEEK4 = '2026-09-14';

function setup() {
  const s = emptyState();
  const year = createYear(s, { name: 'Year A', startDate: '2026-08-24', endDate: '2026-10-30' });
  const school = add(s, 'schools', { yearId: year.id, name: 'School A' });
  const k = add(s, 'grades', { yearId: year.id, name: 'Kindergarten', short: 'K' });
  const deck = (name) => add(s, 'lessons', {
    yearId: year.id, name, category: '', autoFields: [], instrumentIds: [], locations: [driveLocation({ fileId: `tmpl-${name}`, mimeType: SLIDES })],
  });
  update(s, 'years', year.id, { output: { kind: 'drive', folderId: 'copiesRoot', name: 'Output' }, reports: { weekly: false } });
  const t = { s, year, school, k, g: fakeGoogle() };
  t.lesson = (name, weekStart) => addWeekLesson(s, { yearId: year.id, schoolId: school.id, gradeId: k.id, weekStart, lessonId: deck(name).id });
  return t;
}

const settingsOf = (t) => reportSettings(t.s.years.find((y) => y.id === t.year.id));

/** What the Reports tab does on "Make and keep up to date" for the weeks chosen. */
async function makeAndKeep(t, fromWeek, toWeek = fromWeek) {
  const manual = { ...settingsOf(t).manual, fromWeek, toWeek, schoolIds: [t.school.id], gradeIds: [t.k.id], keepUpToDate: true };
  update(t.s, 'years', t.year.id, { reports: { ...t.s.years.find((y) => y.id === t.year.id).reports, manual } });
  const files = manualReports(t.s, t.year.id, { ...settingsOf(t), manual, copyOf: () => null });
  await makeReports({ send: t.g.send, yearId: t.year.id, files, folderId: FOLDER.folderId });
  const { watched } = settingsOf(t);
  update(t.s, 'years', t.year.id, { reports: { ...t.s.years.find((y) => y.id === t.year.id).reports, watched: withWatched(watched, files.map((f) => watchedEntry(manual, f, FOLDER))) } });
}

/** The export bridge keeping the watched reports up to date (a minute after a schedule change). */
async function keepUpToDate(t) {
  const keeper = weeklyReportKeeper({ send: t.g.send, folderFor: async () => 'weekFolder' }, t.year.id);
  await keeper.load(t.s);
  await keeper.sync(t.s);
  const steps = keeper.steps(t.s, { wants: [], copies: [], rootKey: 'drive:copiesRoot' });
  await keeper.run(steps, { goOn: () => true, show: () => {}, problem: (e) => { throw e; }, stoppers: [] });
}

/** The lessons each Sheet in Drive lists now, by the Sheet's name (from the last time it was written). */
function sheets(t) {
  const lessonsIn = (id) => {
    const writes = t.g.calls.filter((c) => c.url.pathname.includes(id) && c.url.pathname.endsWith(':batchUpdate'));
    const text = JSON.stringify(writes.at(-1)?.body ?? {});
    return ['Beat', 'Song', 'Dance'].filter((name) => text.includes(name));
  };
  return Object.fromEntries([...t.g.files.values()].filter((f) => !f.trashed).map((f) => [f.name, lessonsIn(f.id)]));
}

test('making next week\'s report keeps last week\'s Google Sheet as it was', async () => {
  const t = setup();
  t.lesson('Beat', WEEK3);
  t.lesson('Song', WEEK4);
  await makeAndKeep(t, 3);
  assert.deepEqual(sheets(t), { 'School A – Week 3 report': ['Beat'] });

  await makeAndKeep(t, 4);
  assert.deepEqual(sheets(t), {
    'School A – Week 3 report': ['Beat'],
    'School A – Week 4 report': ['Song'],
  }, 'week 3 is still there, unchanged, and week 4 has a Sheet of its own');
  assert.deepEqual(settingsOf(t).watched.map((w) => w.name), ['School A – Week 3 report', 'School A – Week 4 report'], 'both are kept up to date');
});

test('a lesson added to a week updates only that week\'s Sheet', async () => {
  const t = setup();
  t.lesson('Beat', WEEK3);
  t.lesson('Song', WEEK4);
  await makeAndKeep(t, 3);
  await makeAndKeep(t, 4);
  t.lesson('Dance', WEEK4);
  await keepUpToDate(t);
  assert.deepEqual(sheets(t), {
    'School A – Week 3 report': ['Beat'],
    'School A – Week 4 report': ['Song', 'Dance'],
  });
});

test('a month-long report stays about its own weeks too', async () => {
  const t = setup();
  t.lesson('Beat', WEEK3);
  t.lesson('Song', WEEK4);
  await makeAndKeep(t, 1, 3);
  await makeAndKeep(t, 4, 7);
  t.lesson('Dance', WEEK3);
  await keepUpToDate(t);
  assert.deepEqual(sheets(t), {
    'School A – Weeks 1–3 report': ['Beat', 'Dance'],
    'School A – Weeks 4–7 report': ['Song'],
  });
});

test('a Sheet made before reports were kept per week is still found for its own weeks, never for others', async () => {
  const t = setup();
  t.lesson('Beat', WEEK3);
  t.lesson('Song', WEEK4);
  // Made by the older planner: labelled without its weeks, and on the list with a fromWeek/toWeek only.
  const manual = { ...settingsOf(t).manual, fromWeek: 4, toWeek: 4, schoolIds: [t.school.id], gradeIds: [t.k.id] };
  const [file] = manualReports(t.s, t.year.id, { ...settingsOf(t), manual, copyOf: () => null });
  await makeReports({ send: t.g.send, yearId: t.year.id, files: [{ ...file, key: file.oldKey }], folderId: FOLDER.folderId });
  const older = { ...watchedEntry(manual, file, FOLDER), id: 'olderEntry' };
  update(t.s, 'years', t.year.id, { reports: { weekly: false, watched: [older] } });

  t.lesson('Dance', WEEK4);
  await keepUpToDate(t);
  assert.equal(t.g.files.size, 1, 'the same Sheet is updated, not a second one made');
  assert.deepEqual(sheets(t), { 'School A – Week 4 report': ['Song', 'Dance'] });

  await makeAndKeep(t, 3);
  assert.deepEqual(sheets(t), { 'School A – Week 3 report': ['Beat'], 'School A – Week 4 report': ['Song', 'Dance'] });
});
