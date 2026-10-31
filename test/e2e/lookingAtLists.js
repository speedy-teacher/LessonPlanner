// Cases L1-L5 and L12 of lookingAt.e2e.js: who each tab lists, what a choice shows, each tab's own memory.

import * as workspace from '/js/workspace.js';
import { store } from '/js/store.js';
import { check, startNewYear, waitFor } from './helpers.js';
import {
  addOtherYear, addResources, addSchedule, barText, chooseInUi, goTo, LEE, lookingAtLabel, names, pageText, pickerNames, PAT, SAM, seedMine, settled,
} from './lookingAtKit.js';

const MINE_LESSON = 'My Steady Beat Game';
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/** Pat shares schedule + resources, Sam a schedule for another School Year only, Lee only his Resources. */
function shareLikeTheSpec(ids) {
  const patResources = addResources({ owner: PAT });
  addSchedule({ owner: PAT, ids, resourcesFileId: patResources });
  addSchedule({ owner: SAM, ids, yearFileId: addOtherYear(ids, SAM), resourcesFileId: addResources({ owner: SAM, shared: false }) });
  return { patResources, lee: addResources({ owner: LEE, picture: true }) };
}

async function listOn(tab) {
  await goTo(tab);
  return (await pickerNames()).names;
}

async function expectList(tabs, expected) {
  for (const tab of tabs) {
    const got = await listOn(tab);
    check(same(got, expected), `${tab}: the list should be ${expected.join(' / ')}, was ${got.join(' / ')}`);
  }
}

// ---------- the cases ----------

export const CASES_LISTS = {
  async L1() {
    const ids = await seedMine();
    shareLikeTheSpec(ids);
    await expectList(['lessonSchedule', 'reports', 'outcomes'], ['Me', 'Pat Example']);
  },

  async L2() {
    const ids = await seedMine();
    shareLikeTheSpec(ids);
    addResources({ owner: LEE, name: 'Teacher Resources (older)' }); // a second file owned by the same person
    await expectList(['lessons', 'images'], ['Me', 'Lee Placeholder', 'Pat Example']);
  },

  async L3() {
    const ids = await seedMine();
    shareLikeTheSpec(ids);
    await goTo('images');
    await chooseInUi(LEE);
    check(store.state.images.some((i) => i.name === 'Lee Snowman') && pageText().includes('Lee Snowman'), 'Lee’s picture should show on Images');
    check(store.state.tags.some((t) => t.name === 'lee winter') && !store.state.tags.some((t) => t.name === 'my autumn'), 'Lee’s tags show, mine do not');
    await goTo('lessons');
    check(lookingAtLabel() === 'Me' && pageText().includes(MINE_LESSON), 'Lesson Templates should say Me and show my templates');
    await goTo('lessonSchedule');
    check(lookingAtLabel() === 'Me' && pageText().includes(MINE_LESSON), 'Lesson Schedule should show my own schedule');
    await goTo('plan');
    check(!document.querySelector('.people-picker'), 'the Calendar has no "Looking at"');
    check(store.state.outcomes.some((o) => o.code === 'MU1') && store.state.weekLessons.length === 1, 'the Calendar shows my plan');
  },

  async L4() {
    const ids = await seedMine();
    addSchedule({ owner: PAT, ids, resourcesFileId: addResources({ owner: PAT, shared: false }) }); // Resources not shared with me
    await goTo('lessonSchedule');
    await chooseInUi(PAT);
    await waitFor(() => workspace.pieces.missing.resources === 'no_access', 8000, 'Pat’s Teacher Resources to be found not shared');
    check(same(store.state.weekLessons.map((w) => w.id), ['wk-pat-example']), `only Pat's week entry should show, saw ${names(store, 'weekLessons')}`);
    check(store.state.lessons.length === 0 && !pageText().includes(MINE_LESSON), 'none of my templates may appear');
    // The page is redrawn a moment after the news (quietRefresh.js), so wait for the words to appear.
    await waitFor(() => [...document.querySelectorAll('main [data-tip]')].some((el) => el.dataset.tip.includes('Not shared with you')), 6000, 'a template name to say "Not shared with you"');
    check(/Can.t open Pat Example.s Teacher Resources/.test(barText()), `the bar should say Pat's Teacher Resources can't be opened: ${barText()}`);
  },

  async L5() {
    const ids = await seedMine();
    shareLikeTheSpec(ids);
    await goTo('lessonSchedule');
    await chooseInUi(PAT);
    await goTo('images');
    check(lookingAtLabel() === 'Me' && !store.state.images.some((i) => i.name === 'Lee Snowman'), 'Images starts at Me');
    await chooseInUi(LEE);
    await goTo('lessonSchedule');
    check(lookingAtLabel() === PAT && store.state.weekLessons.some((w) => w.id === 'wk-pat-example'), 'Lesson Schedule remembers Pat');
    await goTo('images');
    check(lookingAtLabel() === LEE && store.state.images.some((i) => i.name === 'Lee Snowman'), 'Images remembers Lee');
    await goTo('plan');
    check(!document.querySelector('.people-picker') && !store.state.weekLessons.some((w) => w.id === 'wk-pat-example') && store.state.weekLessons.length === 1, 'the Calendar shows mine');
    await settled().catch(() => {});
    await startNewYear({ name: 'Test Year 2031–32', start: '2031-08-25', end: '2032-06-11', copy: true });
    for (const tab of ['images', 'lessonSchedule']) {
      await goTo(tab);
      check(lookingAtLabel() === 'Me', `${tab} should be back to Me after opening another plan, was ${lookingAtLabel()}`);
    }
  },

  async L12() {
    const ids = await seedMine();
    shareLikeTheSpec(ids);
    await goTo('lessonSchedule');
    const bot = window.lessonPlanner;
    const forImages = await bot.people({ tab: 'images' });
    check(same(forImages, ['Lee Placeholder', 'Pat Example']), `people for images: ${JSON.stringify(forImages)}`);
    const forSchedule = await bot.people({ tab: 'lessonSchedule' });
    check(same(forSchedule, ['Pat Example']), `people for lessonSchedule: ${JSON.stringify(forSchedule)}`);
    check((await bot.people({ tab: 'plan' })).error, 'a tab with no "Looking at" should answer with an error');
    const refused = await bot.lookAt({ name: LEE, tab: 'lessonSchedule' });
    check(refused.error, 'Lee shared no Lesson Schedule, so looking at him there should be refused');
    const done = await bot.lookAt({ name: LEE, tab: 'images' });
    check(done.lookingAt === LEE && done.tab === 'images', `lookAt answered ${JSON.stringify(done)}`);
    const picks = bot.status().parts.lookingAt;
    check(picks.images === LEE && picks.lessonSchedule === 'me', `status should report each tab's choice: ${JSON.stringify(picks)}`);
    check(lookingAtLabel() === 'Me' && store.state.weekLessons.some((w) => w.lessonId !== 'les-lee-placeholder') && !store.state.images.some((i) => i.name === 'Lee Snowman'), 'Lesson Schedule stays on Me');
    await goTo('images');
    check(lookingAtLabel() === LEE && store.state.images.some((i) => i.name === 'Lee Snowman'), 'Images now shows Lee');
  },
};
