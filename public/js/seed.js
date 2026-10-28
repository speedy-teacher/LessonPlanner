// Placeholder starter data, used the very first time the app opens.
// Everything here is made up.

import { add, addSlide, createYear, emptyState, paintInstrument, placeOutcome } from './model.js';
import { weekdaysBetween } from './dates.js';

const SCHOOLS = ['Acorn Elementary', 'Bluebird Elementary', 'Cedar Grove Elementary', 'Dandelion Elementary'];
const GRADES = [
  ['Kindergarten', 'K'], ['Grade 1', '1'], ['Grade 2', '2'],
  ['Grade 3', '3'], ['Grade 4', '4'], ['Grade 5', '5'],
];
const INSTRUMENTS = [['Ukulele', '#b5654a'], ['Recorder', '#6b8f5e'], ['Xylophone', '#6a4c93']];
const TEMPLATES = [
  ['Warm-up', ['school', 'grade', 'date']],
  ['Main lesson', ['grade', 'date', 'outcome', 'criterion', 'instrument']],
  ['Exit ticket', ['grade', 'criterion']],
];

// [code, title, [[criterion, grade shorts, [[slide, template#, instrument#?]]]]]
const OUTCOMES = [
  ['MU1', 'Keep a steady beat', [
    ['Moves to a steady beat', 'K12', [['Beat walk', 0], ['Body percussion', 1]]],
    ['Plays a steady beat on an instrument', '345', [['Strum the beat', 1, 0], ['Beat check', 2]]],
  ]],
  ['MU2', 'Sing and play melodies', [
    ['Matches pitch', 'K12', [['Echo songs', 0], ['Hello song', 1]]],
    ['Plays a simple melody', '2345', [['B-A-G songs', 1, 1], ['Melody practice', 1, 1], ['Show me', 2]]],
  ]],
  ['MU3', 'Create musical ideas', [
    ['Makes up a short pattern', 'K123', [['Pattern game', 0], ['Make a pattern', 1, 2]]],
    ['Composes a 4-beat phrase', '45', [['Phrase builder', 1, 2], ['Share it', 2]]],
  ]],
  ['MU4', 'Listen and respond', [
    ['Describes music with words', 'K12345', [['Listening map', 1], ['Feelings words', 2]]],
  ]],
  ['MU5', 'Perform with others', [
    ['Plays a part in a group', '345', [['Ensemble warm-up', 0, 0], ['Group piece', 1, 0]]],
  ]],
];

export function seedState() {
  const state = emptyState();
  const year = createYear(state, { name: '2026–2027', startDate: '2026-08-24', endDate: '2027-06-11' });
  const ids = {
    schools: SCHOOLS.map((name) => add(state, 'schools', { yearId: year.id, name }).id),
    grades: GRADES.map(([name, short]) => add(state, 'grades', { yearId: year.id, name, short })),
    instruments: INSTRUMENTS.map(([name, color]) => add(state, 'instruments', { yearId: year.id, name, color }).id),
    templates: TEMPLATES.map(([name, autoFields]) => add(state, 'templates', { yearId: year.id, name, autoFields }).id),
  };
  const outcomes = OUTCOMES.map((o) => seedOutcome(state, year.id, ids, o));
  seedSchedule(state, year.id, ids);
  seedPlacements(state, year.id, ids, outcomes);
  return state;
}

function seedOutcome(state, yearId, ids, [code, title, criteria]) {
  const outcome = add(state, 'outcomes', { yearId, code, title });
  for (const [critTitle, shorts, slides] of criteria) {
    const gradeIds = ids.grades.filter((g) => shorts.includes(g.short)).map((g) => g.id);
    const crit = add(state, 'criteria', { outcomeId: outcome.id, title: critTitle, gradeIds });
    for (const [slideTitle, tpl, ins] of slides) {
      addSlide(state, crit.id, {
        title: slideTitle,
        templateId: ids.templates[tpl],
        instrumentId: ins === undefined ? null : ids.instruments[ins],
      });
    }
  }
  return outcome.id;
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

function seedPlacements(state, yearId, ids, outcomes) {
  const grade3 = ids.grades[3].id;
  const plan = [['2026-09-14', 0], ['2026-10-05', 1], ['2026-11-02', 4], ['2026-12-07', 2]];
  ids.schools.slice(0, 2).forEach((schoolId) => {
    plan.forEach(([date, o]) => placeOutcome(state, { yearId, schoolId, gradeId: grade3, outcomeId: outcomes[o], date }));
  });
  const k = ids.grades[0].id;
  placeOutcome(state, { yearId, schoolId: ids.schools[0], gradeId: k, outcomeId: outcomes[0], date: '2026-09-09' });
  placeOutcome(state, { yearId, schoolId: ids.schools[0], gradeId: k, outcomeId: outcomes[3], date: '2026-10-14' });
}
