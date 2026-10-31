// Choosing a picture (e.g. a bitmoji) for a lesson copy from the dates it's shown, the holiday list
// and its instruments. Ported from the lesson-organizer project's pick_bitmoji tests, with made-up
// pictures that carry the same timing rules as the teacher's tagged ones.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { add, createYear, emptyState } from '../public/js/model.js';
import { addImage } from '../public/js/library.js';
import { addWeekLesson, schoolWeeks } from '../public/js/weekPlan.js';
import {
  imageUses, lessonPictures, pickImages, pictureForEntry, scoreImage, weekRanges, weeksImageFits,
} from '../public/js/imagePick.js';

const CALENDAR = [
  { name: 'First Day of School', startDate: '2026-08-19', endDate: '2026-08-19' },
  { name: 'Halloween', startDate: '2026-10-31', endDate: '2026-10-31' },
  { name: 'Veterans Day', startDate: '2026-11-11', endDate: '2026-11-11' },
  { name: 'Winter Break', startDate: '2026-12-21', endDate: '2027-01-01' },
];

const date = (from, to, startByEnd = false) => ({ type: 'date', from, to, startByEnd });
const around = (holiday, anchor, daysBefore, daysAfter, aliases = []) => ({ type: 'holiday', holiday, anchor, daysBefore, daysAfter, aliases });
const pic = (id, priority, windows, { anytime = false, instrumentIds = [] } = {}) => ({ id, instrumentIds, when: { anytime, priority, windows } });

const PICTURES = [
  pic('happy-december', 4, [date('12-01', '12-13', true)]),
  pic('happy-holidays', 3, [around('Winter Break', 'start', 21, 0, ['Christmas Break']), date('12-01', '12-24')]),
  pic('happy-january', 4, [date('01-01', '01-13', true)]),
  pic('happy-new-year', 4, [around('Winter Break', 'end', 0, 10), date('01-01', '01-13', true)]),
  pic('welcome', 4, [around('First Day of School', 'start', 0, 7), date('08-10', '08-31')]),
  pic('pumpkin-1', 3, [around('Halloween', 'start', 30, 0), date('10-01', '10-31')]),
  pic('pumpkin-2', 3, [around('Halloween', 'start', 30, 0), date('10-01', '10-31')]),
  pic('flag-1', 3, [around('Veterans Day', 'start', 3, 0), around('Memorial Day', 'start', 3, 0)], { anytime: true }),
  pic('flag-2', 3, [around('Veterans Day', 'start', 3, 0), around('Memorial Day', 'start', 3, 0)], { anytime: true }),
  pic('happy-november-1', 4, [date('11-01', '11-13', true)]),
  pic('happy-november-2', 4, [date('11-01', '11-13', true)]),
  pic('snowflake', 2, [date('12-01', '02-28')]),
  pic('sunshine', 2, [date('04-15', '08-31')]),
  pic('guitar', 1, [], { anytime: true, instrumentIds: ['ins-guitar'] }),
  pic('waving', 1, [], { anytime: true }),
];

const picked = (start, end, holidays = CALENDAR, more = {}) => pickImages(PICTURES, { start, end, holidays, ...more }).map((p) => p.id);

test('the first two weeks of December get “Happy December”', () => {
  assert.deepEqual(picked('2026-11-30', '2026-12-04'), ['happy-december']);
  assert.deepEqual(picked('2026-12-07', '2026-12-11'), ['happy-december']);
});

test('the week before winter break gets “Happy Holidays”', () => {
  assert.deepEqual(picked('2026-12-14', '2026-12-18'), ['happy-holidays']);
});

test('a holiday window follows the holiday list, not a fixed date', () => {
  const earlyBreak = [{ name: 'Winter Break', startDate: '2026-12-14', endDate: '2026-12-25' }];
  assert.deepEqual(picked('2026-11-23', '2026-11-25', earlyBreak), ['happy-holidays']);
  assert.ok(!picked('2026-11-23', '2026-11-25').includes('happy-holidays'), 'a Dec 21 break is too far away');
});

test('holiday names match ignoring capitals, and other names for the same break count too', () => {
  const differentName = [{ name: 'christmas break', startDate: '2026-12-14', endDate: '2026-12-25' }];
  assert.deepEqual(picked('2026-11-23', '2026-11-25', differentName), ['happy-holidays']);
});

test('the first week back from winter break', () => {
  assert.deepEqual(new Set(picked('2027-01-04', '2027-01-08')), new Set(['happy-january', 'happy-new-year']));
});

test('the first week of school gets the welcome picture', () => {
  assert.deepEqual(picked('2026-08-19', '2026-08-21'), ['welcome']);
});

test('late October gets the Halloween pictures', () => {
  assert.deepEqual(new Set(picked('2026-10-26', '2026-10-30')), new Set(['pumpkin-1', 'pumpkin-2']));
});

test('the flags are preferred near Memorial Day', () => {
  const memorial = [{ name: 'Memorial Day', startDate: '2027-05-31', endDate: '2027-05-31' }];
  assert.deepEqual(new Set(picked('2027-05-26', '2027-05-28', memorial)), new Set(['flag-1', 'flag-2']));
});

test('a month greeting beats a holiday picture', () => {
  assert.deepEqual(picked('2026-11-09', '2026-11-11'), ['happy-november-1', 'happy-november-2']);
});

test('a showing in February matches a window that wraps past New Year', () => {
  assert.equal(scoreImage(PICTURES.find((p) => p.id === 'snowflake'), '2027-02-22', '2027-02-26'), 2);
});

test('with nothing seasonal, any-time pictures are used — ones with the lesson’s instrument first', () => {
  assert.deepEqual(picked('2026-06-08', '2026-06-12', [], { instrumentIds: ['ins-guitar'] }), ['sunshine']);
  const result = picked('2026-09-14', '2026-09-18', [], { instrumentIds: ['ins-guitar'] });
  assert.equal(result[0], 'guitar');
  assert.deepEqual(new Set(result), new Set(['flag-1', 'flag-2', 'guitar', 'waving']));
});

test('a holiday missing from the list falls back to the picture’s date windows', () => {
  assert.deepEqual(picked('2026-12-14', '2026-12-18', []), ['happy-holidays']);
});

test('pictures shared with “anyone with the link” come first — but unshared ones are still used', () => {
  const sharing = (p) => (p.id === 'pumpkin-2' ? true : p.id === 'pumpkin-1' ? false : null);
  assert.deepEqual(picked('2026-10-26', '2026-10-30', CALENDAR, { sharing }), ['pumpkin-2', 'pumpkin-1']);
  const nothingShared = () => false;
  assert.deepEqual(picked('2026-12-14', '2026-12-18', CALENDAR, { sharing: nothingShared }), ['happy-holidays']);
});

test('sharing outranks instruments: a shared picture beats one showing the lesson’s instrument', () => {
  const sharing = (p) => p.id === 'waving';
  assert.equal(picked('2026-09-14', '2026-09-18', [], { instrumentIds: ['ins-guitar'], sharing })[0], 'waving');
});

test('a picture with no windows that isn’t for any time is never used', () => {
  assert.deepEqual(pickImages([pic('unused', 2, [])], { start: '2026-09-14', end: '2026-09-18' }), []);
});

// ---------- on the Lesson Schedule ----------

function planner() {
  const s = emptyState();
  const year = createYear(s, { name: 'Year A', startDate: '2026-08-19', endDate: '2027-06-10' });
  CALENDAR.forEach((h) => add(s, 'holidays', { yearId: year.id, ...h }));
  const school = add(s, 'schools', { yearId: year.id, name: 'School A' });
  const grade = add(s, 'grades', { yearId: year.id, name: 'Grade 1', short: '1' });
  const lesson = add(s, 'lessons', { yearId: year.id, name: 'Beat', autoFields: ['image'], instrumentIds: [], locations: [] });
  const plain = add(s, 'lessons', { yearId: year.id, name: 'Song', autoFields: ['school'], instrumentIds: [], locations: [] });
  const image = (name, when) => Object.assign(addImage(s, { yearId: year.id, name }), { when });
  const welcome = image('Welcome', { anytime: false, priority: 4, windows: [around('First Day of School', 'start', 0, 7)] });
  const waving = image('Waving', { anytime: true, priority: 2, windows: [] });
  const weeks = schoolWeeks(year);
  const cls = { yearId: year.id, schoolId: school.id, gradeId: grade.id };
  return { s, year, lesson, plain, welcome, waving, weeks, cls };
}

test('a lesson on the schedule gets the picture that fits its week', () => {
  const { s, lesson, welcome, waving, weeks, cls } = planner();
  const first = addWeekLesson(s, { ...cls, weekStart: weeks[0].weekStart, lessonId: lesson.id });
  const later = addWeekLesson(s, { ...cls, weekStart: weeks[5].weekStart, lessonId: lesson.id });
  assert.equal(pictureForEntry(s, first).image.id, welcome.id);
  assert.equal(pictureForEntry(s, later).image.id, waving.id);
  assert.deepEqual(lessonPictures(s, lesson.id).map((p) => p.image.id), [welcome.id, waving.id]);
  assert.deepEqual(imageUses(s, welcome.id).map((u) => u.entry.id), [first.id]);
});

test('every lesson on the schedule is offered a picture, with nothing to tick', () => {
  const { s, plain, welcome, weeks, cls } = planner();
  plain.autoFields = [];
  const entry = addWeekLesson(s, { ...cls, weekStart: weeks[0].weekStart, lessonId: plain.id });
  assert.equal(lessonPictures(s, plain.id)[0].image.id, welcome.id);
  assert.deepEqual(imageUses(s, welcome.id).map((u) => u.entry.id), [entry.id]);
});

test('the weeks a picture fits are listed for checking its rules', () => {
  const { s, welcome } = planner();
  const weeks = weeksImageFits(s, welcome).map((w) => w.number);
  assert.deepEqual(weeks, [1, 2]);
  assert.equal(weekRanges(weeks), 'Weeks 1–2');
  assert.equal(weekRanges([1, 3, 4, 9]), 'Weeks 1, 3–4 and 9');
  assert.equal(weekRanges([7]), 'Week 7');
});

test('each time a picture fits reads as a plain sentence', async () => {
  const { windowSentence } = await import('../public/js/imagePick.js');
  assert.equal(windowSentence(date('12-01', '12-13', true)), 'Dec 1 – Dec 13, every year (if the lesson starts by then)');
  assert.equal(windowSentence(around('Halloween', 'start', 30, 0)), '30 days before Halloween');
  assert.equal(windowSentence(around('Winter Break', 'end', 0, 10)), 'the end of Winter Break and 10 days after');
  assert.equal(windowSentence(around('Veterans Day', 'start', 3, 1)), '3 days before to 1 day after Veterans Day');
  assert.equal(windowSentence(around('Flag Day', 'start', 0, 0)), 'On Flag Day');
});

test('a lesson chosen by hand always gets that picture — even in weeks another picture fits better', async () => {
  const { chooseImageLesson } = await import('../public/js/library.js');
  const { remove } = await import('../public/js/model.js');
  const { s, plain, welcome, waving, weeks, cls } = planner();
  const first = addWeekLesson(s, { ...cls, weekStart: weeks[0].weekStart, lessonId: plain.id });
  assert.equal(chooseImageLesson(s, waving.id, plain.id), true, '“Picture” gets ticked for the lesson');
  assert.ok(plain.autoFields.includes('image'));
  assert.equal(pictureForEntry(s, first).image.id, waving.id, 'not the welcome picture, though it fits week 1');
  assert.deepEqual(imageUses(s, waving.id).map((u) => u.entry.id), [first.id]);
  chooseImageLesson(s, welcome.id, plain.id);
  assert.equal(pictureForEntry(s, first).image.id, welcome.id, 'with two chosen, the best fit for the week wins');
  chooseImageLesson(s, welcome.id, plain.id, false);
  assert.equal(pictureForEntry(s, first).image.id, waving.id);
  remove(s, 'lessons', plain.id);
  assert.deepEqual(waving.lessonIds, [], 'a removed lesson leaves the picture’s list');
});

test('pictures take turns week to week: none repeats until every picture that fits has been used', () => {
  const { s, year, lesson, welcome, waving, weeks, cls } = planner();
  const image = (name) => Object.assign(addImage(s, { yearId: year.id, name }), { when: { anytime: true, priority: 2, windows: [] } });
  const hello = image('Hello');
  const sunny = image('Sunny');
  const entries = [2, 3, 4, 5, 6, 7].map((n) => addWeekLesson(s, { ...cls, weekStart: weeks[n].weekStart, lessonId: lesson.id }));
  const names = entries.map((e) => pictureForEntry(s, e).image.name);
  assert.deepEqual(names.slice(0, 3).sort(), ['Hello', 'Sunny', 'Waving'], 'three weeks, three different pictures');
  assert.deepEqual(names.slice(3), names.slice(0, 3), 'then they come round again in the same order');
  assert.ok(![hello, sunny, waving].some((i) => i.id === welcome.id));
});

test('every class gets the same picture in the same week', () => {
  const { s, year, lesson, weeks, cls } = planner();
  Object.assign(addImage(s, { yearId: year.id, name: 'Hello' }), { when: { anytime: true, priority: 2, windows: [] } });
  const school = add(s, 'schools', { yearId: year.id, name: 'School B' });
  const a = addWeekLesson(s, { ...cls, weekStart: weeks[6].weekStart, lessonId: lesson.id });
  const b = addWeekLesson(s, { ...cls, schoolId: school.id, weekStart: weeks[6].weekStart, lessonId: lesson.id });
  assert.equal(pictureForEntry(s, a).image.id, pictureForEntry(s, b).image.id);
});

test('a greeting week still gets its greeting, even right after it was used', () => {
  const { s, lesson, welcome, weeks, cls } = planner();
  const one = addWeekLesson(s, { ...cls, weekStart: weeks[0].weekStart, lessonId: lesson.id });
  const two = addWeekLesson(s, { ...cls, weekStart: weeks[1].weekStart, lessonId: lesson.id });
  assert.equal(pictureForEntry(s, one).image.id, welcome.id);
  assert.equal(pictureForEntry(s, two).image.id, welcome.id, 'the only greeting that fits week 2 too');
});

test('a picture that is the only fit for next week isn’t used the week before when another fits', () => {
  const { s, year, lesson, weeks, cls } = planner();
  const image = (name, windows) => Object.assign(addImage(s, { yearId: year.id, name }), { when: { anytime: false, priority: 3, windows } });
  const span = (from, to) => ({ type: 'date', from, to });
  // Week 5 fits both; week 6 fits only "Heritage".
  const fiveStart = weeks[4].days[0].slice(5);
  const sixEnd = weeks[5].days.at(-1).slice(5);
  const heritage = image('Heritage', [span(fiveStart, sixEnd)]);
  const flag = image('Flag', [span(fiveStart, weeks[4].days.at(-1).slice(5))]);
  const five = addWeekLesson(s, { ...cls, weekStart: weeks[4].weekStart, lessonId: lesson.id });
  const six = addWeekLesson(s, { ...cls, weekStart: weeks[5].weekStart, lessonId: lesson.id });
  assert.equal(pictureForEntry(s, six).image.id, heritage.id);
  assert.equal(pictureForEntry(s, five).image.id, flag.id, 'the flag, so Heritage isn’t shown two weeks running');
});

test('the picture for a week doesn’t change with which pictures happen to be shared right now', () => {
  const { s, year, lesson, weeks, cls } = planner();
  ['Hello', 'Sunny'].forEach((name) => Object.assign(addImage(s, { yearId: year.id, name }), { when: { anytime: true, priority: 2, windows: [] } }));
  const entry = addWeekLesson(s, { ...cls, weekStart: weeks[6].weekStart, lessonId: lesson.id });
  const plain = pictureForEntry(s, entry).image.id;
  for (const id of s.images.map((i) => i.id)) {
    assert.equal(pictureForEntry(s, entry, (i) => i.id === id).image.id, plain);
  }
});

test('lessons in a row get different pictures — also two lessons in the same week', () => {
  const { s, year, lesson, weeks, cls } = planner();
  ['Hello', 'Sunny'].forEach((name) => Object.assign(addImage(s, { yearId: year.id, name }), { when: { anytime: true, priority: 2, windows: [] } }));
  const one = addWeekLesson(s, { ...cls, weekStart: weeks[6].weekStart, lessonId: lesson.id, position: 0 });
  const two = addWeekLesson(s, { ...cls, weekStart: weeks[6].weekStart, lessonId: lesson.id, position: 1 });
  const three = addWeekLesson(s, { ...cls, weekStart: weeks[7].weekStart, lessonId: lesson.id, position: 0 });
  const names = [one, two, three].map((e) => pictureForEntry(s, e).image.name);
  assert.equal(new Set(names).size, 3, `three lessons in a row, three pictures: ${names}`);
});

test('a special period rotates through its themed pictures, lesson to lesson', () => {
  const { s, year, lesson, weeks, cls } = planner();
  const span = { type: 'date', from: weeks[8].days[0].slice(5), to: weeks[9].days.at(-1).slice(5) };
  const themed = ['Pumpkin', 'Bat'].map((name) => Object.assign(addImage(s, { yearId: year.id, name }), { when: { anytime: false, priority: 3, windows: [span] } }));
  const entries = [[8, 0], [8, 1], [9, 0], [9, 1]].map(([w, position]) => addWeekLesson(s, { ...cls, weekStart: weeks[w].weekStart, lessonId: lesson.id, position }));
  const ids = entries.map((e) => pictureForEntry(s, e).image.id);
  assert.ok(ids.every((id) => themed.some((t) => t.id === id)), 'only the themed pictures in that period');
  assert.ok(ids.every((id, i) => !i || id !== ids[i - 1]), 'never the same twice in a row');
});

test('each grade has its own sequence; both schools teaching a grade share it', () => {
  const { s, year, lesson, weeks, cls } = planner();
  ['Hello', 'Sunny'].forEach((name) => Object.assign(addImage(s, { yearId: year.id, name }), { when: { anytime: true, priority: 2, windows: [] } }));
  const other = add(s, 'grades', { yearId: year.id, name: 'Grade 2', short: '2' });
  const school = add(s, 'schools', { yearId: year.id, name: 'School B' });
  // Grade 1 has two lessons in week 7; Grade 2 has one. Grade 2's next lesson (week 8) still differs from its week-7 one.
  const g1 = [0, 1].map((position) => addWeekLesson(s, { ...cls, weekStart: weeks[6].weekStart, lessonId: lesson.id, position }));
  const g2 = [6, 7].map((w) => addWeekLesson(s, { ...cls, gradeId: other.id, weekStart: weeks[w].weekStart, lessonId: lesson.id, position: 0 }));
  const g1b = addWeekLesson(s, { ...cls, schoolId: school.id, weekStart: weeks[6].weekStart, lessonId: lesson.id, position: 0 });
  assert.notEqual(pictureForEntry(s, g1[0]).image.id, pictureForEntry(s, g1[1]).image.id);
  assert.notEqual(pictureForEntry(s, g2[0]).image.id, pictureForEntry(s, g2[1]).image.id);
  assert.equal(pictureForEntry(s, g1b).image.id, pictureForEntry(s, g1[0]).image.id, 'same grade, same lesson number, same picture');
});

test('a special period uses every picture whose time fits — the strongest first, then the others take turns', () => {
  const { s, year, lesson, weeks, cls } = planner();
  const span = { type: 'date', from: weeks[8].days[0].slice(5), to: weeks[9].days.at(-1).slice(5) };
  const greeting = Object.assign(addImage(s, { yearId: year.id, name: 'Greeting' }), { when: { anytime: false, priority: 4, windows: [span] } });
  const season = Object.assign(addImage(s, { yearId: year.id, name: 'Season' }), { when: { anytime: false, priority: 2, windows: [span] } });
  const entries = [[8, 0], [8, 1], [9, 0]].map(([w, position]) => addWeekLesson(s, { ...cls, weekStart: weeks[w].weekStart, lessonId: lesson.id, position }));
  const ids = entries.map((e) => pictureForEntry(s, e).image.id);
  assert.deepEqual(ids, [greeting.id, season.id, greeting.id], 'the greeting first, then the season picture, then round again');
});

test('lessons added without a picture spot ticked never move the pictures already planned', () => {
  const { s, lesson, plain, weeks, cls } = planner();
  const first = addWeekLesson(s, { ...cls, weekStart: weeks[0].weekStart, lessonId: lesson.id });
  const before = pictureForEntry(s, first).image.id;
  addWeekLesson(s, { ...cls, weekStart: weeks[0].weekStart, lessonId: plain.id, position: 0 });
  assert.equal(pictureForEntry(s, first).image.id, before);
});
