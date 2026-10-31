// Cases L6, L7, L8 and L13 of lookingAt.e2e.js: Editor files merge both ways, Viewer files stay view only,
// and losing access (and getting it back) never breaks the page.

import * as workspace from '/js/workspace.js';
import { commit, store } from '/js/store.js';
import { check, commands, sleep, waitFor } from './helpers.js';
import * as fakeDrive from './fakeDrive.js';
import {
  addResources, addSchedule, barText, chooseInUi, goTo, LEE, lookingAtLabel, pageText, pictureRecord, PAT, seedMine, syncUntil, WEEK_ONE,
} from './lookingAtKit.js';

export const CASES_ACCESS = {
  async L6() {
    const ids = await seedMine();
    const lee = addResources({ owner: LEE, role: 'writer' });
    const mineBefore = fakeDrive.revOf(ids.resources);
    await goTo('images');
    await chooseInUi(LEE);
    // Both sides change before either is sent: I rename a tag, Lee adds a picture in Drive.
    commands([{ command: 'renameTagOrCategory', args: { tag: 'lee winter', name: 'lee deep winter' } }]);
    fakeDrive.edit(lee, (d) => { d.images.push(pictureRecord('lee-placeholder', 'Lee Snowman')); });
    await syncUntil(() => {
      const d = fakeDrive.read(lee);
      return d.tags[0].name === 'lee deep winter' && d.images.length === 1;
    }, 'Lee’s file in the fake Drive to hold both my renamed tag and the new picture');
    check(store.state.images.some((i) => i.name === 'Lee Snowman') && store.state.tags.some((t) => t.name === 'lee deep winter'), 'the page should show both');
    check(pageText().includes('Lee Snowman'), 'the Images page should list the new picture');
    check(fakeDrive.revOf(ids.resources) === mineBefore, 'my own Teacher Resources file must not have been touched');
  },

  async L7() {
    const ids = await seedMine();
    const resources = addResources({ owner: PAT });
    const patFile = addSchedule({ owner: PAT, ids, resourcesFileId: resources, role: 'writer' });
    const mineBefore = fakeDrive.revOf(ids.schedule);
    await goTo('lessonSchedule');
    await chooseInUi(PAT);
    commands([{ command: 'addLessonToWeek', args: { school: 'Maple School', grade: 'Grade 3', week: 2, lesson: 'Pat Rhythm Game' } }]);
    fakeDrive.edit(patFile, (d) => {
      d.weekLessons.push({ ...d.weekLessons[0], id: 'wk-pat-later', weekStart: '2030-09-09', position: 0 });
    });
    await syncUntil(() => fakeDrive.read(patFile).weekLessons.length === 3, 'Pat’s file to hold my new entry and the one added in Drive');
    const entries = fakeDrive.read(patFile).weekLessons.map((w) => `${w.id}@${w.weekStart}`);
    check(entries.some((e) => e.startsWith('wk-pat-later')) && entries.some((e) => e.startsWith('wk-pat-example@' + WEEK_ONE)), `both of Pat's entries must stay: ${entries}`);
    check(store.state.weekLessons.length === 3, `the page should show 3 entries, shows ${store.state.weekLessons.length}`);
    check(fakeDrive.revOf(ids.schedule) === mineBefore, 'my own Lesson Schedule file must not have been touched');
  },

  async L8() {
    const ids = await seedMine();
    const lee = addResources({ owner: LEE, role: 'reader', picture: true });
    const before = fakeDrive.revOf(lee);
    await goTo('images');
    await chooseInUi(LEE);
    const main = document.querySelector('main');
    check(main.classList.contains('view-only') && /View only/.test(barText()), `Images should say view only: ${barText()}`);
    const hidden = [...main.querySelectorAll('.danger, .icon-btn.add-icon')];
    check(hidden.length > 0 && hidden.every((el) => el.offsetParent === null), 'edit buttons (Remove, add) should be hidden');
    check([...main.querySelectorAll('input.inline-edit')].every((el) => el.disabled), 'name boxes should be turned off');
    const refused = window.lessonPlanner.run('addTagCategory', { name: 'Not Allowed' });
    check(refused.error, 'a change through the assistant should be refused');
    commit((s) => { s.tagGroups.push({ id: 'tgrp-sneaky', yearId: s.activeYearId, name: 'Sneaky' }); });
    check(!store.state.tagGroups.some((g) => g.name === 'Sneaky' || g.name === 'Not Allowed'), 'view-only data must not change');
    await workspace.syncNow();
    await sleep(500);
    check(fakeDrive.revOf(lee) === before, 'Lee’s file in the fake Drive must be unchanged');
    check(fakeDrive.read(ids.resources).lessons.length === 1, 'my own file is as it was');
  },

  async L13() {
    const ids = await seedMine();
    const lee = addResources({ owner: LEE, role: 'writer', picture: true });
    await goTo('images');
    await chooseInUi(LEE);
    fakeDrive.share(lee, null);
    await syncUntil(() => workspace.pieces.access('resources') === 'view', 'the page to treat Lee’s file as view only after it was unshared');
    check(lookingAtLabel() === LEE && store.state.images.some((i) => i.name === 'Lee Snowman'), 'the page keeps showing the copy it has');
    await waitFor(() => /View only/.test(barText()) && /Not shared with you/.test(barText()), 6000, 'the bar to say view only and not shared');
    const refused = window.lessonPlanner.run('addTagCategory', { name: 'Not Allowed' });
    check(refused.error, 'changes are refused while it is not shared');
    fakeDrive.share(lee, 'writer');
    await syncUntil(() => workspace.pieces.access('resources') === 'edit' && !workspace.pieces.stale.resources, 'Lee’s file to be editable again');
    await waitFor(() => !/View only/.test(barText()), 6000, 'the view-only note to go away');
    check(fakeDrive.read(ids.resources).lessons.length === 1, 'my own file is as it was');
  },
};
