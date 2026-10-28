// Placeholder starter data, used the very first time the app opens.
// Everything here is made up.

import { PALETTE, add, addStep, createYear, emptyState, paintInstrument, placeCriterion } from './model.js';
import { weekdaysBetween } from './dates.js';

const SCHOOLS = ['Acorn Elementary', 'Bluebird Elementary', 'Cedar Grove Elementary', 'Dandelion Elementary'];
const GRADES = [
  ['Kindergarten', 'K'], ['Grade 1', '1'], ['Grade 2', '2'],
  ['Grade 3', '3'], ['Grade 4', '4'], ['Grade 5', '5'],
];
const INSTRUMENTS = [['Ukulele', '#b5654a'], ['Recorder', '#6b8f5e'], ['Xylophone', '#6a4c93']];
// Lesson decks: [name, category, auto-filled fields, instrument #s].
const LESSONS = [
  ['Beat walk', 'Movement', ['school', 'grade', 'date']],
  ['Body percussion', 'Movement', ['grade', 'date', 'criterion']],
  ['Strum the beat', 'Ukulele', ['grade', 'date', 'instrument', 'criterion'], [0]],
  ['Echo songs', 'Singing', ['school', 'grade', 'date']],
  ['Hello song', 'Singing', ['grade', 'date']],
  ['B-A-G songs', 'Recorder', ['grade', 'date', 'instrument', 'outcome'], [1]],
  ['Melody practice', 'Recorder', ['grade', 'date', 'instrument'], [1]],
  ['Pattern game', 'Creating', ['grade', 'date', 'criterion']],
  ['Make a pattern', 'Xylophone', ['grade', 'date', 'instrument'], [2]],
  ['Phrase builder', 'Xylophone', ['grade', 'date', 'instrument', 'criterion'], [2]],
  ['Listening map', 'Listening', ['grade', 'date', 'outcome']],
  ['Feelings words', 'Listening', ['grade', 'criterion']],
  ['Ensemble warm-up', 'Ukulele', ['school', 'grade', 'date', 'instrument'], [0]],
  ['Group piece', 'Ukulele', ['grade', 'date', 'instrument', 'outcome'], [0]],
  ['Show me', 'Check-ins', ['grade', 'criterion']],
  ['Share it', 'Check-ins', ['grade', 'criterion']],
];

// [code, title, [[criterion, grade shorts, [lesson names in teaching order]]]]
const OUTCOMES = [
  ['MU1', 'Keep a steady beat', [
    ['Moves to a steady beat', 'K12', ['Beat walk', 'Body percussion']],
    ['Plays a steady beat on an instrument', '345', ['Strum the beat', 'Show me']],
  ]],
  ['MU2', 'Sing and play melodies', [
    ['Matches pitch', 'K12', ['Echo songs', 'Hello song']],
    ['Plays a simple melody', '2345', ['B-A-G songs', 'Melody practice', 'Show me']],
  ]],
  ['MU3', 'Create musical ideas', [
    ['Makes up a short pattern', 'K123', ['Pattern game', 'Make a pattern']],
    ['Composes a 4-beat phrase', '45', ['Phrase builder', 'Share it']],
  ]],
  ['MU4', 'Listen and respond', [
    ['Describes music with words', 'K12345', ['Listening map', 'Feelings words']],
  ]],
  ['MU5', 'Perform with others', [
    ['Plays a part in a group', '345', ['Ensemble warm-up', 'Group piece']],
  ]],
];

export function seedState() {
  const state = emptyState();
  const year = createYear(state, { name: '2026–2027', startDate: '2026-08-24', endDate: '2027-06-11' });
  const ids = {
    schools: SCHOOLS.map((name) => add(state, 'schools', { yearId: year.id, name }).id),
    grades: GRADES.map(([name, short]) => add(state, 'grades', { yearId: year.id, name, short })),
    instruments: INSTRUMENTS.map(([name, color]) => add(state, 'instruments', { yearId: year.id, name, color }).id),
  };
  ids.lessons = new Map(LESSONS.map(([name, category, autoFields, ins = []]) => [name, add(state, 'lessons', {
    yearId: year.id, name, category, autoFields, instrumentIds: ins.map((i) => ids.instruments[i]),
  }).id]));
  OUTCOMES.forEach((o, i) => seedOutcome(state, year.id, ids, o, PALETTE[i]));
  seedSchedule(state, year.id, ids);
  seedPlacements(state, year.id, ids);
  return state;
}

function seedOutcome(state, yearId, ids, [code, title, criteria], color) {
  const outcome = add(state, 'outcomes', { yearId, code, title, color });
  for (const [critTitle, shorts, lessons] of criteria) {
    const gradeIds = ids.grades.filter((g) => shorts.includes(g.short)).map((g) => g.id);
    const crit = add(state, 'criteria', { outcomeId: outcome.id, title: critTitle, gradeIds });
    lessons.forEach((name) => addStep(state, crit.id, ids.lessons.get(name)));
  }
}

// Each school gets each instrument for a stretch of the year, rotating.
const ROTATION = [['2026-09-08', '2026-11-20'], ['2026-11-30', '2027-02-19'], ['2027-03-01', '2027-05-14']];

function seedSchedule(state, yearId, ids) {
  ids.schools.forEach((schoolId, s) => {
    ROTATION.forEach(([start, end], r) => {
      const instrumentId = ids.instruments[(s + r) % ids.instruments.length];
      paintInstrument(state, { yearId, schoolId, instrumentId, dates: weekdaysBetween(start, end), on: true });
    });
  });
}

// Grade 3 at the first two schools, plus a little Kindergarten; [criterion title, start, end].
const PLAN = {
  3: [
    ['Plays a steady beat on an instrument', '2026-09-14', '2026-09-18'],
    ['Plays a simple melody', '2026-10-05', '2026-10-09'],
    ['Describes music with words', '2026-10-19', '2026-10-21'],
    ['Plays a part in a group', '2026-11-02', '2026-11-06'],
    ['Makes up a short pattern', '2026-12-07', '2026-12-09'],
  ],
  0: [
    ['Moves to a steady beat', '2026-09-08', '2026-09-11'],
    ['Describes music with words', '2026-10-12', '2026-10-14'],
  ],
};

function seedPlacements(state, yearId, ids) {
  const critId = (title) => state.criteria.find((c) => c.title === title).id;
  for (const [gradeIndex, rows] of Object.entries(PLAN)) {
    const gradeId = ids.grades[gradeIndex].id;
    const schools = gradeIndex === '3' ? ids.schools.slice(0, 2) : ids.schools.slice(0, 1);
    for (const schoolId of schools) {
      for (const [title, startDate, endDate] of rows) {
        placeCriterion(state, { yearId, schoolId, gradeId, criterionId: critId(title), startDate, endDate });
      }
    }
  }
}
