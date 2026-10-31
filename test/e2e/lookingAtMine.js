// Cases L9, L10 and L11 of lookingAt.e2e.js: my own work is never lost, undone or sent out by looking at someone else.

import * as workspace from '/js/workspace.js';
import { store, undo } from '/js/store.js';
import { check, commands } from './helpers.js';
import * as fakeDrive from './fakeDrive.js';
import { addResources, addSchedule, chooseInUi, goTo, LEE, PAT, seedMine, settled } from './lookingAtKit.js';

const MINE_LESSON = 'My Steady Beat Game';

export const CASES_MINE = {
  async L9() {
    const ids = await seedMine();
    const lee = addResources({ owner: LEE, role: 'writer', picture: true });
    const leeBefore = fakeDrive.revOf(lee);
    await goTo('images');
    await chooseInUi(LEE);
    // Looking at Lee's templates, I put one of them on MY Lesson Schedule.
    commands([{ command: 'addLessonToWeek', args: { school: 'Maple School', grade: 'Grade 3', week: 2, lesson: 'Lee Rhythm Game' } }]);
    await chooseInUi('Me');
    check(store.state.weekLessons.length === 2, `my new entry should be there, saw ${store.state.weekLessons.length} entries`);
    await settled();
    const saved = fakeDrive.read(ids.schedule).weekLessons;
    check(saved.length === 2 && saved.some((w) => w.lessonId === 'les-lee-placeholder'), `my schedule file should hold the new entry: ${JSON.stringify(saved.map((w) => w.lessonId))}`);
    check(fakeDrive.revOf(lee) === leeBefore && !fakeDrive.read(lee).weekLessons, 'Lee’s file must be untouched');
  },

  async L10() {
    const ids = await seedMine();
    const lee = addResources({ owner: LEE, role: 'writer', picture: true });
    const leeBefore = fakeDrive.revOf(lee);
    await goTo('images');
    commands([{ command: 'addTagCategory', args: { name: 'Undo Season' } }]);
    await chooseInUi(LEE);
    check(store.undoStack.length === 0 && document.getElementById('undo').disabled, 'the undo history starts again for the other person’s data');
    undo();
    document.getElementById('undo').click();
    const groups = store.state.tagGroups.map((g) => g.name);
    check(groups.join() === 'Lee Season', `Lee’s tags should be unchanged, saw ${groups}`);
    await chooseInUi('Me');
    check(store.state.tagGroups.some((g) => g.name === 'Undo Season'), 'my edit is still there after coming back');
    await settled();
    check(fakeDrive.read(ids.resources).tagGroups.some((g) => g.name === 'Undo Season'), 'my edit reached my file in the fake Drive');
    check(fakeDrive.revOf(lee) === leeBefore, 'Lee’s file must be untouched');
  },

  async L11() {
    const ids = await seedMine();
    addResources({ owner: LEE, picture: true });
    addSchedule({ owner: PAT, ids, resourcesFileId: addResources({ owner: PAT }) });
    check(workspace.copiesWaitFor() === null, 'copies are not waiting before looking at anyone');
    for (const [tab, person] of [['images', LEE], ['lessonSchedule', PAT]]) {
      await goTo(tab);
      await chooseInUi(person);
      check(workspace.copiesWaitFor()?.state === 'looking', `copies should wait while looking at ${person}`);
      const mine = workspace.myPlanState();
      const lessons = mine.lessons.map((l) => l.name);
      check(lessons.join() === MINE_LESSON, `my own templates only, saw ${lessons}`);
      check(mine.weekLessons.length === 1 && mine.weekLessons[0].id !== 'wk-pat-example', 'my own schedule only');
      check(mine !== store.state, 'what is on the page is not what exports use');
      await chooseInUi('Me');
    }
    check(workspace.copiesWaitFor() === null, 'copies go on again once back at Me');
  },
};
