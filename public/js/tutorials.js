// Every tutorial in the 🎓 menu, in the order a teacher should do them. Each ends by offering the next.
// What a tutorial and a step are: see tutorialPlan.js. Steps point at parts of the page by their
// `data-tour` name (`tour('name', el)` in dom.js, or `'data-tour': 'name'`, or `tour: 'name'` for
// popMenu/menuItem). test/tutorials.test.js checks every name used here exists in the page code.
//
// `ctx` (made in views/tutorialGuide.js):
//   hasPlan, tab, ui, state, year, google ('connected', 'idle'…), driveAvailable (the website has its Google codes),
//   count(collection) (this year's records),
//   isOpen(name) (a menu or list with that data-tour name is open), exists(name), modal (open dialog's title or null)
//
// Adding a feature? Add a tutorial (or steps) for it here, in the place a teacher would learn it.

import { TAB_INFO } from './tabInfo.js';

const MODAL = '#modal.show .modal-card';
const onTab = (id) => (ctx) => ctx.hasPlan && ctx.tab === id;
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
const needsPlan = (ctx) => (ctx.hasPlan ? null : 'First open a plan, or start one — the “Welcome” tutorial shows how.');

/** Steps that take the teacher to a page: its tab, or "Setup ▾" and then the page. Skipped when already there. */
export function goTo(tabId) {
  const tab = TAB_INFO.find((t) => t.id === tabId);
  if (!tab.menu) {
    return [{ target: `tab-${tabId}`, text: `Click the “${tab.label}” tab.`, skipIf: onTab(tabId), until: onTab(tabId) }];
  }
  return [{
    target: ['setup-menu', `menu-${tabId}`],
    text: `Click “⚙️ Setup” at the top, then choose “${tab.label}”.`,
    skipIf: onTab(tabId),
    until: onTab(tabId),
  }];
}

/** "Add your schools": add as many as you like, then Next (once there is at least one). */
function addSome(collection) {
  return { nextWhen: (ctx) => ctx.count(collection) > 0 };
}

/** A step that waits for one more record (an outcome, an eval…), with "Next" once there is at least one. */
function addOne(collection) {
  return {
    remember: (ctx) => ctx.count(collection),
    until: (ctx, before) => ctx.count(collection) > before,
    nextWhen: (ctx) => ctx.count(collection) > 0,
  };
}

/**
 * Clicking days on a calendar after picking something to place (`armedKey` in the view): done once
 * at least one day was added and "Done" was clicked; back to picking if it was stopped with no days.
 */
function placeDays(collection, armedKey) {
  return {
    remember: (ctx) => ctx.count(collection),
    until: (ctx, before) => ctx.count(collection) > before && !ctx.ui[armedKey],
    backIf: (ctx) => !ctx.ui[armedKey],
  };
}

const already = (ctx, collection, word) => {
  const n = ctx.count(collection);
  return n ? ` You have ${plural(n, word)} already — add another, or click Next.` : '';
};

const soFar = (ctx, collection, word) => {
  const n = ctx.count(collection);
  return n ? ` (${plural(n, word)} so far.)` : '';
};

const welcome = {
  id: 'welcome',
  icon: '👋',
  title: 'Welcome: find your way around',
  about: 'Start (or open) your plan and meet the buttons at the top.',
  steps: [
    {
      target: 'welcome-drive',
      title: 'Your plan lives in Google Drive',
      text: 'Each school year is one plan. Connect Google Drive first so your plan is saved there and you can use it on any computer. (You can also click Next to keep it on this computer for now.)',
      skipIf: (ctx) => ctx.hasPlan || ctx.google === 'connected' || !ctx.driveAvailable,
      until: (ctx) => ctx.google === 'connected',
      nextWhen: () => true,
    },
    {
      target: 'start-year',
      text: 'Click “Start a new school year”.',
      skipIf: (ctx) => ctx.hasPlan,
      until: (ctx) => ctx.hasPlan || ctx.modal === 'Start a new school year',
    },
    {
      selector: MODAL,
      text: 'Give the year a name (like “2026-27”), check its first and last day, then click “Create year”.',
      skipIf: (ctx) => ctx.hasPlan,
      until: (ctx) => ctx.hasPlan,
      backIf: (ctx) => !ctx.modal,
    },
    {
      target: 'plan-button',
      title: 'Your plan',
      text: 'This is the plan you have open — one school year. Click it any time to switch plans, start next year, or download a copy.',
    },
    {
      target: 'tabs',
      title: 'The main pages',
      text: 'These tabs are where you plan: the calendars, the Lesson Schedule, pictures and reports.',
    },
    {
      target: 'setup-menu',
      title: 'Setup',
      text: 'Under “⚙️ Setup” are the pages you fill in first: the School Year, your outcomes and evals, and your lesson templates.',
    },
    {
      selector: '#undo, #redo', pick: 'all',
      title: 'Oops? Undo!',
      text: 'Made a mistake? ↶ undoes it and ↷ puts it back (or press Ctrl+Z and Ctrl+Y).',
    },
    {
      selector: '#save-status',
      text: 'Everything saves by itself — this says when it’s saved. There’s no Save button to remember.',
    },
    {
      target: 'tutorials',
      title: 'Come back any time',
      text: 'The 🎓 menu has a tutorial for each part of the planner. Doing them in order sets up your whole year.',
    },
  ],
};

const googleDrive = {
  id: 'google-drive',
  icon: '☁️',
  title: 'Connect Google Drive',
  about: 'Keep your plan in your Drive so it’s safe and on every computer.',
  ready: needsPlan,
  steps: [
    ...goTo('setup'),
    {
      target: 'google-card',
      text: (ctx) => (ctx.google === 'connected'
        ? 'You’re connected to Google Drive. Click Next.'
        : 'Click “Connect Google Drive”. A Google window opens — choose your school account and allow the planner.'),
      until: (ctx) => ctx.google === 'connected',
      nextWhen: () => true,
    },
    {
      target: 'drive-pill',
      text: 'This little sign always shows whether Drive is connected. Google asks the planner to check in every hour — if it says “click to reconnect”, just click anywhere.',
    },
    {
      target: 'plan-button',
      text: 'Click your plan’s name.',
      until: (ctx) => ctx.modal === 'Your plans',
    },
    {
      selector: MODAL,
      text: 'Plans under “☁ In Google Drive” are saved there. If yours says “this computer only”, click “☁ Save to Google Drive”. Close this window when you’re done.',
      until: (ctx) => !ctx.modal,
      nextWhen: () => true,
    },
  ],
};

const schoolYear = {
  id: 'school-year',
  icon: '🧺',
  title: 'Set up your school year',
  about: 'Dates, schools, grades, instruments and school events.',
  ready: needsPlan,
  steps: [
    ...goTo('setup'),
    {
      target: 'year-card',
      title: 'The year’s dates',
      text: 'Check the year’s name and its first and last day of school. Both calendars and the Lesson Schedule use them.',
    },
    {
      target: 'list-schools',
      text: (ctx) => `Type the name of each school you teach at, pressing Enter after each one. Click Next when they’re all in.${soFar(ctx, 'schools', 'school')}`,
      ...addSome('schools'),
    },
    {
      target: 'list-grades',
      text: (ctx) => `Add each grade you teach (like “Kindergarten” or “Grade 1”). The short label (K, 1, 2…) shows on buttons, and the color marks the grade.${soFar(ctx, 'grades', 'grade')}`,
      ...addSome('grades'),
    },
    {
      target: 'list-instruments',
      text: (ctx) => `Add each instrument your lessons use (like “Ukulele”), and pick a color for each.${soFar(ctx, 'instruments', 'instrument')}`,
      ...addSome('instruments'),
    },
    {
      target: 'events-card',
      text: 'Add breaks and other school events here (a name, then the first and last day). Holidays are already listed under “Built-in events”. Click Next when you’re done.',
    },
  ],
};

const lessonTemplates = {
  id: 'lesson-templates',
  icon: '🖼️',
  title: 'Add your lesson templates',
  about: 'Bring in your slide decks — each lesson is one deck.',
  ready: needsPlan,
  steps: [
    ...goTo('lessons'),
    {
      target: 'deck-add',
      text: (ctx) => `Click “+ Add”. Choose “New lesson deck” to type one in, or “From Google Drive › Files or folders…” to bring in your slides.${already(ctx, 'lessons', 'lesson')}`,
      ...addOne('lessons'),
    },
    {
      target: 'deck-side',
      text: 'Your lessons are listed here, in folders. Click a lesson to see its details. Drag lessons onto a folder to tidy them.',
      skipIf: (ctx) => !ctx.count('lessons'),
    },
    {
      target: 'deck-instruments',
      text: 'Click the instruments this lesson uses. The calendars warn you when one isn’t at the school that week.',
      skipIf: (ctx) => !ctx.exists('deck-instruments'),
    },
    {
      target: 'auto-fields',
      title: 'Filled in automatically',
      text: 'Type these codes (like {{school}}) into your slides. Each lesson copy gets the real school, grade, week and more typed in. Click a code to copy it.',
      skipIf: (ctx) => !ctx.exists('auto-fields'),
    },
    {
      target: 'used-in',
      text: 'This shows which evals teach this lesson. You can add it to an eval right here, too.',
      skipIf: (ctx) => !ctx.exists('used-in'),
    },
  ],
};

const outcomes = {
  id: 'outcomes',
  icon: '🌱',
  title: 'Outcomes, evals & lesson order',
  about: 'Your essential outcomes, their evals, and the lessons that teach them.',
  ready: needsPlan,
  steps: [
    ...goTo('outcomes'),
    {
      target: 'outcome-side',
      text: (ctx) => `Type an essential outcome and press Enter.${already(ctx, 'outcomes', 'outcome')}`,
      ...addOne('outcomes'),
    },
    {
      target: 'outcome-head',
      text: 'Give it a short code (like MU1) and a color. All of its evals share this color on the calendar.',
      skipIf: (ctx) => !ctx.exists('outcome-head'),
    },
    {
      target: 'add-criterion',
      text: (ctx) => `Type an eval criterion for this outcome and press Enter.${already(ctx, 'criteria', 'eval')}`,
      ...addOne('criteria'),
      skipIf: (ctx) => !ctx.exists('add-criterion'),
    },
    {
      target: 'crit-grades', pick: 'last',
      text: 'Click the grades this eval is for. (Hover a chosen grade and click ☆ to make it the main grade.)',
      until: (ctx) => ctx.state.criteria.some((c) => c.gradeIds.length),
      nextWhen: () => true,
      skipIf: (ctx) => !ctx.exists('crit-grades'),
    },
    {
      target: 'crit-lessons', pick: 'last',
      text: 'Click “Lessons, in teaching order” to open the eval’s lesson list.',
      until: (ctx) => ctx.isOpen('crit-lessons'),
      nextWhen: () => true,
      skipIf: (ctx) => !ctx.exists('crit-lessons'),
    },
    {
      target: 'crit-add-lesson', pick: 'last',
      text: 'Pick a lesson from your decks (or type a new one) to add it. Drag ⠿ to put the lessons in teaching order. Each grade can have its own order.',
      ...addOne('criterionLessons'),
      skipIf: (ctx) => !ctx.exists('crit-add-lesson'),
    },
  ],
};

const instrumentSchedule = {
  id: 'instrument-schedule',
  icon: '🎶',
  title: 'The Instrument Schedule',
  about: 'Mark when each instrument is at each school.',
  ready: (ctx) => needsPlan(ctx)
    ?? (ctx.count('schools') && ctx.count('instruments') ? null : 'First add a school and an instrument — the “Set up your school year” tutorial shows how.'),
  steps: [
    ...goTo('schedule'),
    {
      target: 'schedule-side',
      text: 'Click an instrument under a school.',
      until: (ctx) => Boolean(ctx.ui.armedBlock),
      nextWhen: () => true,
    },
    {
      target: 'calendar',
      text: 'Now click each day the instrument is at that school (the month buttons at the top jump around). Click “Done” when you’ve clicked them all.',
      ...placeDays('instrumentBlocks', 'armedBlock'),
    },
    {
      target: 'calendar',
      title: 'Handy moves',
      text: 'Drag either end of a bar to stretch it over more days, drag the bar to move it (hold Ctrl to copy), and click a bar for its menu. You can also drag an instrument straight onto a day.',
    },
  ],
};

const evalCalendar = {
  id: 'eval-calendar',
  icon: '📅',
  title: 'The Outcome & Eval Calendar',
  about: 'Put each eval on the days you’ll teach it, for each school and grade.',
  ready: (ctx) => needsPlan(ctx)
    ?? (ctx.state.criteria.some((c) => c.gradeIds.length) ? null : 'First add an eval with a grade — the “Outcomes, evals & lesson order” tutorial shows how.'),
  steps: [
    ...goTo('plan'),
    {
      target: ['plan-school', 'plan-grade'],
      text: 'Pick a school and a grade. Switching keeps the same month, so it’s easy to compare classes.',
    },
    {
      target: 'eval-palette',
      text: 'Click an eval to start placing it. (If this list is empty, pick a grade that has evals.)',
      until: (ctx) => Boolean(ctx.ui.armedCriterionId),
      nextWhen: () => true,
    },
    {
      target: 'calendar',
      text: 'Click each day you’ll teach it. Click “Done” when you’ve clicked them all.',
      ...placeDays('placements', 'armedCriterionId'),
    },
    {
      target: 'calendar',
      text: 'Click a bar on the calendar to see its lessons. Drag its ends to stretch it. ⚠ means a lesson needs an instrument that isn’t at the school that day — hover it to see why.',
      until: (ctx) => Boolean(ctx.ui.placementId),
      nextWhen: () => true,
    },
    {
      target: 'placement-detail',
      text: 'Here are the eval’s lessons, in teaching order. Click × to close.',
      skipIf: (ctx) => !ctx.exists('placement-detail'),
    },
    {
      target: 'plan-grade',
      text: '“All” shows every grade at once, each in its grade’s color.',
    },
  ],
};

const lessonSchedule = {
  id: 'lesson-schedule',
  icon: '📖',
  title: 'The Lesson Schedule',
  about: 'Put lessons in order, week by week, for each class.',
  ready: (ctx) => needsPlan(ctx)
    ?? (ctx.count('schools') && ctx.count('grades') ? null : 'First add a school and a grade — the “Set up your school year” tutorial shows how.'),
  steps: [
    ...goTo('lessonSchedule'),
    {
      target: 'ls-class',
      text: 'Each row is one school week. Pick the school and grade (the class) to plan.',
    },
    {
      target: 'ls-fill',
      text: 'The quickest start: click “✨ Fill from Outcome & Eval Calendar”, then choose which classes. Each eval’s lessons go into the weeks it’s on the calendar. (Or click Next to place lessons yourself.)',
      until: (ctx) => ctx.modal === 'Fill from the Outcome & Eval Calendar',
      nextWhen: () => true,
    },
    {
      selector: MODAL,
      text: 'Choose “Just” this class, or “Every school & grade”. You can always undo.',
      skipIf: (ctx) => ctx.modal !== 'Fill from the Outcome & Eval Calendar',
      until: (ctx) => !ctx.modal,
    },
    {
      target: ['ls-palette', 'ls-weeks'],
      text: 'Drag a lesson from the list on the right into a week (or click it, then click weeks). Drag lessons to reorder them, or back to the list to take them off.',
      ...addSome('weekLessons'),
    },
    {
      target: 'ls-weeks',
      text: 'Each week shows its evals and the instruments at the school. The ✨ at a week’s top right fills just that week. Click a lesson for its menu.',
    },
  ],
};

const images = {
  id: 'images',
  icon: '🌄',
  title: 'Pictures for your lessons',
  about: 'Add pictures (like bitmojis) and say when each one fits.',
  ready: needsPlan,
  steps: [
    ...goTo('images'),
    {
      target: 'image-add',
      text: (ctx) => `Click “+ Add”, then “Pictures or folders…” to bring in pictures from Google Drive.${already(ctx, 'images', 'picture')}`,
      ...addOne('images'),
    },
    {
      target: 'image-gallery',
      text: 'Click a picture to tag it.',
      skipIf: (ctx) => !ctx.count('images'),
    },
    {
      target: 'image-details',
      text: 'Give it tags, instruments and a time it fits (like around Halloween, or “OK any time”). Each week’s lesson copy gets the picture that fits best — lessons need the picture spot from “Filled in automatically”.',
      skipIf: (ctx) => !ctx.count('images'),
    },
  ],
};

const lessonCopies = {
  id: 'lesson-copies',
  icon: '📁',
  title: 'Lesson copies',
  about: 'Every lesson on the schedule gets its own filled-in copy.',
  ready: needsPlan,
  steps: [
    ...goTo('setup'),
    {
      target: 'copies-card',
      text: (ctx) => (ctx.year?.output
        ? 'Your copies go in the folder shown here. Click Next.'
        : 'Click “Choose a Google Drive folder…” and pick where the copies should go. (Connect Google Drive first.)'),
      until: (ctx) => Boolean(ctx.year?.output),
      nextWhen: () => true,
    },
    {
      target: 'copies-card',
      text: 'The planner makes a copy of each lesson on the Lesson Schedule, sorted into School › Grade › Week folders, with the details typed in. Your templates are never changed. It works in the background — watch the corner panel at the bottom right.',
    },
  ],
};

/** The report's extra columns after the lesson (Reports › "What each lesson shows"). */
const columnsAfter = (ctx) => ctx.year?.reports?.right ?? [];
const lastColumn = (ctx) => columnsAfter(ctx).at(-1);
const INSTRUMENT_WORD = '{{instrument}}';
const hasInstrumentColumn = (ctx) => columnsAfter(ctx).some((c) => c.value?.includes(INSTRUMENT_WORD));

/** Reports: add a column that shows each lesson's instruments (skipped if there is one already). */
function instrumentColumn() {
  return [
    {
      target: 'report-add-after',
      title: 'Add an Instrument column',
      text: 'Let’s add a column that shows the instruments each lesson uses. Click “+ Column after”.',
      skipIf: hasInstrumentColumn,
      remember: (ctx) => columnsAfter(ctx).length,
      until: (ctx, before) => columnsAfter(ctx).length > before,
    },
    {
      target: 'report-column-name', pick: 'last',
      text: 'Type Instrument as the column’s name, then press Enter.',
      skipIf: (ctx) => hasInstrumentColumn(ctx) || !lastColumn(ctx),
      until: (ctx) => Boolean(lastColumn(ctx)?.name),
      nextWhen: () => true,
    },
    {
      selector: `[data-tour="report-words"] [data-word="${INSTRUMENT_WORD}"]`,
      text: `Now click ${INSTRUMENT_WORD}. In the report, it becomes the lesson’s instruments (like “Drum, Ukulele”).`,
      skipIf: (ctx) => hasInstrumentColumn(ctx) || !lastColumn(ctx),
      until: hasInstrumentColumn,
      nextWhen: () => true,
    },
    {
      target: 'report-label',
      text: 'That’s it: “Instrument” : {{instrument}}. Add other columns the same way (like the essential outcome), and take one out with ✕.',
      skipIf: (ctx) => !hasInstrumentColumn(ctx),
    },
  ];
}

const reports = {
  id: 'reports',
  icon: '📊',
  title: 'Reports',
  about: 'A Google Sheet of each week’s lessons, linked to their copies.',
  ready: needsPlan,
  steps: [
    ...goTo('reports'),
    {
      target: 'report-form',
      text: 'Choose the weeks, schools and grades, and the Drive folder to save in.',
    },
    {
      target: 'report-label',
      text: 'Choose what each lesson shows, and add columns before or after it (like its essential outcome).',
    },
    ...instrumentColumn(),
    {
      target: 'report-preview',
      text: (ctx) => `The preview shows the report as it will look${hasInstrumentColumn(ctx) ? ' — with your Instrument column next to each lesson' : ''}.`,
    },
    {
      target: 'report-make',
      text: 'Click “Make the report” to save it as a Google Sheet. Making it again updates the same file.',
      click: true,
      nextWhen: () => true,
    },
    {
      target: 'report-weekly',
      text: 'Tick this to get a “Week n report” in every week folder of your lesson copies, kept up to date for you.',
    },
  ],
};

const plans = {
  id: 'plans',
  icon: '📒',
  title: 'Your plans & next year',
  about: 'Share, download, and start the next school year.',
  ready: needsPlan,
  steps: [
    {
      target: 'plan-button',
      text: 'Click your plan’s name.',
      until: (ctx) => ctx.modal === 'Your plans',
    },
    {
      selector: MODAL,
      title: 'Your plans',
      text: 'Switch to another year’s plan here. “Download a copy” keeps a file of it. “Share or see past versions in Drive” lets a colleague use it too.',
      backIf: (ctx) => !ctx.modal,
    },
    {
      target: 'plans-actions',
      text: 'When next school year comes, click “🌱 Start a new school year”. It copies your schools, grades, instruments, lessons and outcomes — the calendars start empty, and this year stays just as it is.',
      backIf: (ctx) => !ctx.modal,
    },
  ],
};

export const TUTORIALS = [
  welcome, googleDrive, schoolYear, lessonTemplates, outcomes, instrumentSchedule, evalCalendar,
  lessonSchedule, images, lessonCopies, reports, plans,
];
