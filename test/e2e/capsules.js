// Case C1 of lookingAt.e2e.js: the sharing capsules say which file a page's things are in and whether
// it's shared in Google Drive ("Only you" → "Shared" once I share it, "Shared with you" for a colleague's),
// and "Just yours" marks my own settings on the shared School Year's Setup page.

import { syncNow } from '/js/workspace.js';
import { check, text, waitFor } from './helpers.js';
import { addResources, barText, chooseInUi, goTo, LEE, seedMine } from './lookingAtKit.js';
import * as fakeDrive from './fakeDrive.js';

const capsule = (name) => text(document.querySelector(`[data-tour="capsule-${name}"]`) ?? { textContent: '(none)' });

export const CASES_CAPSULES = {
  async C1() {
    const ids = await seedMine();
    addResources({ owner: LEE, picture: true });
    await goTo('setup');
    await waitFor(() => capsule('schoolYear').includes('Only you'), 5000, 'the School Year capsule to say "Only you"');
    check(/Colors: just yours/.test(text(document.querySelector('[data-tour="list-grades"]'))), 'grade colors are marked "just yours"');
    check(/Just yours/.test(text(document.querySelector('[data-tour="copies-card"]'))), 'the lesson-copies folder is marked "just yours"');
    fakeDrive.shareMine(ids.year, true);
    syncNow();
    await waitFor(() => capsule('schoolYear').includes('Shared'), 5000, 'the School Year capsule to say "Shared" once shared');
    await goTo('lessonSchedule');
    check(capsule('schedule').includes('Lesson Schedule') && capsule('schedule').includes('Only you'), `Lesson Schedule capsule: ${capsule('schedule')}`);
    check(capsule('resources').includes('Teacher Resources'), 'the Lesson Schedule page also shows the Teacher Resources capsule');
    await goTo('images');
    await chooseInUi(LEE);
    await waitFor(() => capsule('resources').includes(`${LEE}’s Teacher Resources`) && capsule('resources').includes('Shared with you'), 5000, 'Lee’s capsule to say "Shared with you"');
    check(barText().includes('Shared with you'), 'the bar shows whose file it is');
  },
};
