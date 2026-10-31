// Behavior tests: an assistant can change every part of the planner by name —
// School Year setup, outcomes & evals, lesson templates & folders, and the Images tab.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { add, createYear, emptyState } from '../public/js/model.js';
import { addImage } from '../public/js/library.js';
import { COMMANDS, describeCommands, runCommand, runCommands } from '../public/js/agentCommands.js';

function setup() {
  const s = emptyState();
  const year = createYear(s, { name: 'Year A', startDate: '2026-08-24', endDate: '2027-05-28' });
  add(s, 'schools', { yearId: year.id, name: 'Test School' });
  add(s, 'grades', { yearId: year.id, name: 'Grade 3', short: '3' });
  add(s, 'instruments', { yearId: year.id, name: 'Ukulele', color: '#b5654a' });
  addImage(s, { yearId: year.id, name: 'Waving Teacher' });
  return s;
}

const run = (s, name, args) => runCommand(s, name, args);

test('help lists every command with its area', () => {
  const list = describeCommands();
  assert.equal(list.length, Object.keys(COMMANDS).length);
  const areas = new Set(list.map((c) => c.area));
  assert.equal(areas.size, 7);
  assert.ok(list.every((c) => c.summary && c.area));
});

test('School Year: dates, schools, grades, instruments and events can be changed', () => {
  const s = setup();
  run(s, 'setYear', { name: 'Year B', endDate: '2027-06-04' });
  assert.equal(run(s, 'overview').year, 'Year B');
  assert.throws(() => run(s, 'setYear', { startDate: '2027-07-01' }), /before the last day/);

  run(s, 'addSetupItem', { list: 'schools', name: 'Second School' });
  run(s, 'addSetupItem', { list: 'grades', name: 'Grade 4' });
  run(s, 'addSetupItem', { list: 'instruments', name: 'Drums', color: '#3f6e8c' });
  run(s, 'editSetupItem', { list: 'grades', item: '4', name: 'Fourth Grade', short: '4th' });
  run(s, 'removeSetupItem', { list: 'schools', item: 'Test School' });
  const o = run(s, 'overview');
  assert.deepEqual(o.schools, ['Second School']);
  assert.deepEqual(o.grades, ['Grade 3', 'Fourth Grade']);
  assert.deepEqual(o.instruments, ['Ukulele', 'Drums']);

  run(s, 'addEvent', { name: 'Winter Break', startDate: '2026-12-21', endDate: '2027-01-01' });
  run(s, 'editEvent', { event: 'winter break', endDate: '2027-01-04' });
  const events = run(s, 'listEvents');
  assert.ok(events.some((e) => e.name === 'First Day of School' && e.builtIn));
  assert.deepEqual(events.find((e) => e.name === 'Winter Break'), { name: 'Winter Break', startDate: '2026-12-21', endDate: '2027-01-04', id: s.holidays[0].id });
  run(s, 'deleteEvent', { event: 'Winter Break' });
  assert.equal(s.holidays.length, 0);
});

test('Outcomes and evals: added with grades and lessons, reordered, edited and deleted', () => {
  const s = setup();
  run(s, 'addOutcome', { code: 'MU1', title: 'Steady beat' });
  run(s, 'addLesson', { name: 'Alpha' });
  const ev = run(s, 'addEval', { outcome: 'MU1', title: 'Keeps the beat', grades: ['Grade 3'], lessons: ['Alpha', 'Brand New Song'] });
  assert.deepEqual(ev.lessons, ['Alpha', 'Brand New Song'], 'a lesson not found yet is made');
  assert.equal(run(s, 'listLessons', {}).length, 2);

  run(s, 'addLessonToEval', { eval: 'Keeps the beat', lesson: 'Brand New Song', position: 1 });
  assert.deepEqual(run(s, 'listEvals', { grade: '3' })[0].lessons, ['Brand New Song', 'Alpha', 'Brand New Song']);
  run(s, 'removeLessonFromEval', { eval: 'Keeps the beat', lesson: 'Brand New Song' });
  run(s, 'setEvalLessons', { eval: 'Keeps the beat', lessons: ['Alpha', 'Gamma'], createMissing: true });
  assert.throws(() => run(s, 'setEvalLessons', { eval: 'Keeps the beat', lessons: ['Zulu'] }), /No lesson called "Zulu"/);

  run(s, 'editEval', { eval: 'Keeps the beat', title: 'Plays the beat', removeGrades: ['Grade 3'] });
  run(s, 'editOutcome', { outcome: 'Steady beat', code: 'MU9', color: '#6a4c93' });
  const [outcome] = run(s, 'listOutcomes');
  assert.equal(outcome.code, 'MU9');
  assert.deepEqual(outcome.evals[0], { id: outcome.evals[0].id, title: 'Plays the beat', outcome: 'MU9 · Steady beat', grades: [], lessons: ['Alpha', 'Gamma'] });
  run(s, 'deleteEval', { eval: 'Plays the beat' });
  run(s, 'deleteOutcome', { outcome: 'MU9' });
  assert.deepEqual(run(s, 'listOutcomes'), []);
  assert.equal(run(s, 'listLessons', {}).length, 3, 'lesson templates are kept');
});

test('Lesson templates and folders: edit, copy, move, delete', () => {
  const s = setup();
  run(s, 'addFolder', { name: 'Rhythm' });
  run(s, 'addFolder', { name: 'Week 1', parent: 'Rhythm' });
  run(s, 'addLesson', { name: 'Alpha', folder: 'Week 1' });
  run(s, 'editLesson', { lesson: 'Alpha', category: 'Ukulele', instruments: ['Ukulele'], filledIn: ['school', 'Week number', 'image'] });
  const alpha = run(s, 'getLesson', { lesson: 'alpha' });
  assert.equal(alpha.folder, 'Rhythm › Week 1');
  assert.deepEqual(alpha.instruments, ['Ukulele']);
  assert.deepEqual(alpha.filledIn.map((f) => f.typeInSlides), ['{{school}}', '{{week_number}}', 'IMAGE_ANCHOR']);
  assert.throws(() => run(s, 'editLesson', { lesson: 'Alpha', filledIn: ['shoe size'] }), /isn't a detail/);

  run(s, 'duplicateLesson', { lesson: 'Alpha' });
  run(s, 'moveToFolder', { items: ['Alpha (copy)'], folder: 'top' });
  run(s, 'editFolder', { folder: 'Week 1', name: 'Week One', parent: 'top', watchDrive: true });
  assert.throws(() => run(s, 'editFolder', { folder: 'Rhythm', parent: 'Rhythm' }), /inside itself/);
  const tree = run(s, 'listFolders', {});
  assert.deepEqual(tree.map((f) => [f.name, f.items, f.watchedInDrive]), [['Rhythm', 0, false], ['Week One', 1, true]]);

  assert.equal(run(s, 'deleteFolder', { folder: 'Week One' }).decks, 1);
  run(s, 'deleteLesson', { lesson: 'Alpha (copy)' });
  assert.deepEqual(run(s, 'listLessons', {}), []);
});

test('Images: tags, instruments, chosen lessons and when to use a picture', () => {
  const s = setup();
  run(s, 'addTagCategory', { name: 'Season' });
  run(s, 'addTag', { category: 'Season', name: 'winter' });
  run(s, 'addLesson', { name: 'Alpha' });
  run(s, 'editImage', { image: 'Waving Teacher', description: 'Says hi', addTags: ['winter'], instruments: ['Ukulele'], alwaysForLessons: ['Alpha'] });
  assert.ok(run(s, 'getLesson', { lesson: 'Alpha' }).filledIn.some((f) => f.detail === 'image'), 'choosing a lesson ticks its Picture detail');

  run(s, 'addImageTime', { image: 'Waving Teacher', from: '12-01', to: '12-13' });
  run(s, 'addImageTime', { image: 'Waving Teacher', event: 'first day of school', daysAfter: 4 });
  run(s, 'setImageTiming', { image: 'Waving Teacher', priority: 'Greeting', alsoAnyOtherWeek: true });
  let pic = run(s, 'getImage', { image: 'Waving Teacher' });
  assert.deepEqual(pic.tags, ['Season: winter']);
  assert.deepEqual(pic.alwaysForLessons, ['Alpha']);
  assert.deepEqual(pic.times.map((t) => t.inWords), ['Dec 1 – Dec 13, every year', 'First Day of School and 4 days after']);
  assert.equal(pic.priority, 'Greeting');
  assert.equal(pic.fitsWeeks, 'Weeks 1 and 15–16');
  assert.throws(() => run(s, 'addImageTime', { image: 'Waving Teacher', event: 'Talk Like a Pirate Day' }), /No event called/);

  run(s, 'removeImageTime', { image: 'Waving Teacher', number: 1 });
  run(s, 'renameTagOrCategory', { tag: 'Season: winter', name: 'snow' });
  assert.equal(run(s, 'listImages', { tag: 'snow' }).length, 1);
  run(s, 'deleteTagOrCategory', { category: 'Season' });
  pic = run(s, 'getImage', { image: 'Waving Teacher' });
  assert.deepEqual([pic.times.length, pic.tags], [1, []]);
  run(s, 'deleteImage', { image: 'Waving Teacher' });
  assert.deepEqual(run(s, 'listImages', {}), []);
});

test('raw records can be read when no command shows them, and one request can span areas', () => {
  const s = setup();
  const { state } = runCommands(s, [
    { command: 'addOutcome', args: { title: 'Pitch' } },
    { command: 'addEval', args: { outcome: 'Pitch', title: 'Sings in tune', grades: ['Grade 3'], lessons: ['Echo Song'] } },
    { command: 'placeEval', args: { school: 'Test School', grade: 'Grade 3', eval: 'Sings in tune', startDate: '2026-09-14' } },
    { command: 'fillScheduleFromCalendar', args: {} },
  ]);
  const week = runCommand(state, 'getWeek', { week: '2026-09-15' });
  assert.deepEqual(week.classes.map((c) => c.lessons.map((l) => l.lesson)), [['Echo Song']]);
  assert.equal(runCommand(state, 'findRecords', { collection: 'weekLessons' }).length, 1);
  assert.throws(() => runCommand(state, 'findRecords', { collection: 'secrets' }), /Collections:/);
});

test('a week shows every class, says when nothing is planned, and lists that week\'s holidays', () => {
  const s = setup();
  run(s, 'addEvent', { name: 'Fake Field Day', startDate: '2026-09-11' });
  const week = run(s, 'getWeek', { week: '2026-09-09' });
  assert.deepEqual(week.classes.map((c) => [c.school, c.grade, c.lessons]), [['Test School', 'Grade 3', []]]);
  assert.match(week.note, /Nothing is scheduled/);
  assert.equal(week.weekEnd, '2026-09-11');
  assert.deepEqual(week.events.map((e) => e.name), ['Labor Day', 'Fake Field Day']);
});
