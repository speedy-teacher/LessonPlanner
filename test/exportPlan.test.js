// Lesson copies (the export bridge): what the Lesson Schedule asks for, and what's done about the
// copies that already exist — make, move, refill or remove — so the output folder follows the schedule.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { add, createYear, emptyState, update } from '../public/js/model.js';
import { addWeekLesson, moveWeekLesson, removeWeekLesson, schoolWeeks } from '../public/js/weekPlan.js';
import { canFillIn, driveFileId, driveLocation, driveOpenLabel } from '../public/js/locations.js';
import { entryValues, keysToDo, nextStep, safeName, sparesFor, wantedCopies } from '../public/js/exportPlan.js';
import { addImage } from '../public/js/library.js';

const SLIDES = 'application/vnd.google-apps.presentation';

function setup() {
  const s = emptyState();
  const year = createYear(s, { name: 'Year A', startDate: '2026-08-26', endDate: '2026-10-06' });
  const school = add(s, 'schools', { yearId: year.id, name: 'School A' });
  const grade = add(s, 'grades', { yearId: year.id, name: 'Kindergarten', short: 'K' });
  const deck = (name, autoFields, mimeType = SLIDES) => add(s, 'lessons', {
    yearId: year.id, name, category: '', autoFields, instrumentIds: [],
    locations: [driveLocation({ fileId: `tmpl-${name}`, mimeType })],
  });
  const weekly = deck('Beat', ['week', 'school']);
  const plain = deck('Song', ['school']);
  const numbered = deck('Count', ['lessonNumber']);
  const pdf = deck('Sheet', ['school'], 'application/pdf');
  const cls = { yearId: year.id, schoolId: school.id, gradeId: grade.id };
  const weeks = schoolWeeks(year);
  return { s, year, school, grade, weekly, plain, numbered, pdf, cls, weeks };
}

const DRIVE = { rootKey: 'drive:fakeRoot', yearFolder: 'Music 2026-27', templateOf: driveFileId, canFill: canFillIn };
const wants = (s, yearId, target = DRIVE) => wantedCopies(s, yearId, target);

// What each step does to the pretend folder's copies.
const APPLY = {
  create: (haves, step, made) => haves.push(made),
  adopt: (haves, step) => Object.assign(step.have, { ...step.want, id: step.have.id }),
  refill: (haves, step, made) => haves.splice(haves.indexOf(step.have), 1, made),
  move: (haves, step) => Object.assign(step.have, { place: step.want.place, name: step.want.name, path: step.want.path }),
  remove: (haves, step) => haves.splice(haves.indexOf(step.have), 1),
};

/** A pretend output folder that does what nextStep says, like the bridge does. */
function syncFolder(s, yearId, haves, target = DRIVE) {
  const done = [];
  let n = haves.length;
  for (let guard = 0; guard < 100; guard += 1) {
    const list = wants(s, yearId, target);
    const [key] = keysToDo(list, haves);
    if (!key) return done;
    const want = list.find((w) => w.key === key) ?? null;
    const spares = want ? sparesFor(want, haves, new Set(list.map((w) => w.key))) : [];
    const step = nextStep(want, haves.filter((h) => h.entryId === key), spares);
    done.push(step.kind);
    n += 1;
    APPLY[step.kind](haves, step, { id: `copy${n}`, ...step.want });
  }
  throw new Error('never settled');
}

test('a lesson on the schedule wants a copy in <plan>/<school>/<grade>/Week n, named by its order in the week', () => {
  const { s, year, weekly, plain, cls, weeks } = setup();
  addWeekLesson(s, { ...cls, weekStart: weeks[1].weekStart, lessonId: weekly.id });
  addWeekLesson(s, { ...cls, weekStart: weeks[1].weekStart, lessonId: plain.id });
  const [a, b] = wants(s, year.id);
  assert.deepEqual(a.path, ['Music 2026-27', 'School A', 'Kindergarten', 'Week 2']);
  assert.equal(a.name, '1 - Beat');
  assert.equal(b.name, '2 - Song');
  assert.equal(a.template, 'tmpl-Beat');
});

test('the grade folder uses the grade name from Setup', () => {
  const { s, year, grade, plain, cls, weeks } = setup();
  update(s, 'grades', grade.id, { name: 'Grade 1' });
  addWeekLesson(s, { ...cls, weekStart: weeks[0].weekStart, lessonId: plain.id });
  assert.equal(wants(s, year.id)[0].path[2], 'Grade 1');
});

test('only the details a lesson asks for are filled in, as the placeholders typed in its file', () => {
  const { s, year, weekly, cls, weeks } = setup();
  addWeekLesson(s, { ...cls, weekStart: weeks[2].weekStart, lessonId: weekly.id });
  assert.deepEqual(wants(s, year.id)[0].values, { '{{school}}': 'School A', '{{week_number}}': '3' });
});

test('files that can’t be filled in (e.g. PDFs) are still copied, just without details', () => {
  const { s, year, pdf, cls, weeks } = setup();
  addWeekLesson(s, { ...cls, weekStart: weeks[0].weekStart, lessonId: pdf.id });
  const [want] = wants(s, year.id);
  assert.equal(want.name, '1 - Sheet');
  assert.deepEqual(want.values, {});
});

test('lessons with no template file get no copy', () => {
  const { s, year, cls, weeks } = setup();
  const empty = add(s, 'lessons', { yearId: year.id, name: 'No file', autoFields: [], instrumentIds: [], locations: [] });
  addWeekLesson(s, { ...cls, weekStart: weeks[0].weekStart, lessonId: empty.id });
  assert.equal(wants(s, year.id).length, 0);
});

test('a folder on the computer copies files as they are (nothing filled in)', () => {
  const { s, year, weekly, cls, weeks } = setup();
  addWeekLesson(s, { ...cls, weekStart: weeks[0].weekStart, lessonId: weekly.id });
  const [want] = wants(s, year.id, { ...DRIVE, rootKey: 'local:x', canFill: () => false });
  assert.deepEqual(want.values, {});
});

test('lesson numbers run through the class’s whole schedule; dates are the school days of the week', () => {
  const { s, year, plain, numbered, cls, weeks } = setup();
  addWeekLesson(s, { ...cls, weekStart: weeks[0].weekStart, lessonId: plain.id });
  addWeekLesson(s, { ...cls, weekStart: weeks[1].weekStart, lessonId: plain.id });
  const third = addWeekLesson(s, { ...cls, weekStart: weeks[1].weekStart, lessonId: numbered.id });
  const values = entryValues(s, third, weeks[1]);
  assert.equal(values.lessonNumber, '3');
  assert.equal(values.week, '2');
  assert.equal(values.date, 'Aug 31 – Sep 4');
  assert.equal(entryValues(s, third, weeks[0]).school, 'School A');
  assert.equal(wants(s, year.id).at(-1).values['{{lesson_number}}'], '3');
});

test('names are safe for folders on the computer', () => {
  assert.equal(safeName('Rhythm: 1/2 notes?'), 'Rhythm- 1-2 notes-');
  assert.equal(safeName('  '), 'Untitled');
});

test('adding a lesson to the schedule makes a copy; nothing more happens when nothing changes', () => {
  const { s, year, weekly, cls, weeks } = setup();
  const haves = [];
  addWeekLesson(s, { ...cls, weekStart: weeks[0].weekStart, lessonId: weekly.id });
  assert.deepEqual(syncFolder(s, year.id, haves), ['create']);
  assert.deepEqual(syncFolder(s, year.id, haves), []);
});

test('moving a lesson to another week moves its copy — and remakes it when its details change', () => {
  const { s, year, weekly, plain, cls, weeks } = setup();
  const haves = [];
  const song = addWeekLesson(s, { ...cls, weekStart: weeks[0].weekStart, lessonId: plain.id });
  const beat = addWeekLesson(s, { ...cls, weekStart: weeks[0].weekStart, lessonId: weekly.id });
  syncFolder(s, year.id, haves);
  moveWeekLesson(s, song.id, weeks[3].weekStart, 0); // fills in only {{school}}: same contents
  assert.deepEqual(syncFolder(s, year.id, haves), ['move', 'move'], 'Song moves; Beat is renamed "1 - Beat" in its week');
  assert.deepEqual(haves.find((h) => h.entryId === song.id).path.at(-1), 'Week 4');
  moveWeekLesson(s, beat.id, weeks[2].weekStart, 0); // fills in {{week_number}}: it changes
  assert.deepEqual(syncFolder(s, year.id, haves), ['refill']);
  assert.equal(haves.length, 2);
});

test('removing a lesson from the schedule removes its copy', () => {
  const { s, year, plain, cls, weeks } = setup();
  const haves = [];
  const entry = addWeekLesson(s, { ...cls, weekStart: weeks[0].weekStart, lessonId: plain.id });
  syncFolder(s, year.id, haves);
  removeWeekLesson(s, entry.id);
  assert.deepEqual(syncFolder(s, year.id, haves), ['remove']);
  assert.equal(haves.length, 0);
});

test('copies whose details don’t change are left alone (only lesson-number copies follow an earlier insert)', () => {
  const { s, year, plain, numbered, cls, weeks } = setup();
  const haves = [];
  addWeekLesson(s, { ...cls, weekStart: weeks[2].weekStart, lessonId: plain.id });
  addWeekLesson(s, { ...cls, weekStart: weeks[3].weekStart, lessonId: numbered.id });
  syncFolder(s, year.id, haves);
  addWeekLesson(s, { ...cls, weekStart: weeks[0].weekStart, lessonId: plain.id });
  assert.deepEqual(syncFolder(s, year.id, haves).sort(), ['create', 'refill'], 'Song in week 3 untouched; Count becomes lesson 3');
});

test('a spare copy of the same entry (e.g. made twice) is removed', () => {
  const { s, year, plain, cls, weeks } = setup();
  const haves = [];
  addWeekLesson(s, { ...cls, weekStart: weeks[0].weekStart, lessonId: plain.id });
  syncFolder(s, year.id, haves);
  haves.push({ ...haves[0], id: 'twin' });
  assert.deepEqual(syncFolder(s, year.id, haves), ['remove']);
});

test('choosing another output folder moves every copy there', () => {
  const { s, year, plain, cls, weeks } = setup();
  const haves = [];
  addWeekLesson(s, { ...cls, weekStart: weeks[0].weekStart, lessonId: plain.id });
  syncFolder(s, year.id, haves);
  assert.deepEqual(syncFolder(s, year.id, haves, { ...DRIVE, rootKey: 'drive:otherRoot' }), ['move']);
});

test('the template link says it opens the template', () => {
  assert.equal(driveOpenLabel(driveLocation({ fileId: 'x', mimeType: SLIDES }), 'Template'), 'Open Template in Google Slides');
  assert.equal(driveOpenLabel(driveLocation({ fileId: 'x', mimeType: SLIDES })), 'Open in Google Slides');
});

test('the picture spot (IMAGE_ANCHOR) is never replaced as text in lesson copies', () => {
  const { s, year, plain, cls, weeks } = setup();
  plain.autoFields.push('image');
  addWeekLesson(s, { ...cls, weekStart: weeks[0].weekStart, lessonId: plain.id });
  assert.deepEqual(Object.keys(wants(s, year.id)[0].values), ['{{school}}']);
});

test('taking a lesson off the schedule and putting it in another week reuses its copy (nothing to the trash)', () => {
  const { s, year, plain, cls, weeks } = setup();
  const haves = [];
  const first = addWeekLesson(s, { ...cls, weekStart: weeks[0].weekStart, lessonId: plain.id });
  syncFolder(s, year.id, haves);
  const copyId = haves[0].id;
  removeWeekLesson(s, first.id);
  const again = addWeekLesson(s, { ...cls, weekStart: weeks[3].weekStart, lessonId: plain.id });
  assert.deepEqual(syncFolder(s, year.id, haves), ['adopt']);
  assert.equal(haves.length, 1);
  assert.equal(haves[0].id, copyId, 'the same file');
  assert.equal(haves[0].entryId, again.id);
});

test('a lesson with a picture spot gets the week’s picture in its copy; a new picture means an update', () => {
  const { s, year, weekly, cls, weeks } = setup();
  weekly.autoFields.push('image');
  const pic = (name, fileId, when) => Object.assign(addImage(s, { yearId: year.id, name, locations: [driveLocation({ fileId, mimeType: 'image/png' })] }), { when });
  pic('Waving', 'fakeWave', { anytime: true, priority: 2, windows: [] });
  pic('Leaves', 'fakeLeaves', { anytime: false, priority: 2, windows: [{ type: 'date', from: '09-14', to: '09-30' }] });
  const slidesTarget = { ...DRIVE, canPicture: () => true };
  const entry = addWeekLesson(s, { ...cls, weekStart: weeks[0].weekStart, lessonId: weekly.id });
  const haves = [];
  syncFolder(s, year.id, haves, slidesTarget);
  assert.equal(haves[0].picture, 'fakeWave');
  moveWeekLesson(s, entry.id, weeks[3].weekStart, 0); // mid-September
  assert.equal(wants(s, year.id, slidesTarget)[0].picture, 'fakeLeaves');
  assert.deepEqual(syncFolder(s, year.id, haves, slidesTarget), ['refill']);
  assert.equal(wants(s, year.id)[0].picture, '', 'no picture where pictures can’t go (e.g. not Google Slides)');
});

test('a picture that couldn’t be placed is on hold: copies are made without it, once, and get it when it’s let go', () => {
  const { s, year, weekly, cls, weeks } = setup();
  weekly.autoFields.push('image');
  Object.assign(addImage(s, { yearId: year.id, name: 'Waving', locations: [driveLocation({ fileId: 'fakeWave', mimeType: 'image/png' })] }),
    { when: { anytime: true, priority: 2, windows: [] } });
  [0, 1, 2].forEach((i) => addWeekLesson(s, { ...cls, weekStart: weeks[i].weekStart, lessonId: weekly.id }));
  const held = new Set(['fakeWave']);
  const target = { ...DRIVE, canPicture: () => true, pictureOnHold: (id) => held.has(id) };
  const haves = [];
  assert.deepEqual(syncFolder(s, year.id, haves, target), ['create', 'create', 'create']);
  assert.deepEqual(haves.map((h) => h.picture), ['', '', '']);
  assert.deepEqual(syncFolder(s, year.id, haves, target), [], 'no trying again over and over');
  held.clear();
  assert.deepEqual(syncFolder(s, year.id, haves, target), ['refill', 'refill', 'refill'], 'let go: the picture goes in');
  assert.deepEqual(haves.map((h) => h.picture), ['fakeWave', 'fakeWave', 'fakeWave']);
  held.add('fakeWave');
  assert.deepEqual(syncFolder(s, year.id, haves, target), [], 'copies that already have the picture are left as they are');
});

test('copies wait a minute after the last change before updating; a change near an update pushes it back', async () => {
  const { updateTime, SETTLE_MS } = await import('../public/js/exportPlan.js');
  assert.equal(SETTLE_MS, 60 * 1000);
  assert.equal(updateTime({ now: 10_000, lastEdit: 0, delay: 1500 }), 11_500, 'no changes: just the short delay (e.g. after signing in)');
  assert.equal(updateTime({ now: 10_000, lastEdit: 10_000, delay: 1500 }), 70_000, 'a minute after the change');
  assert.equal(updateTime({ now: 69_000, lastEdit: 68_000, delay: 1500 }), 128_000, 'another change just before: a minute after that one');
  assert.equal(updateTime({ now: 200_000, lastEdit: 10_000, delay: 1500 }), 201_500, 'long settled');
});
