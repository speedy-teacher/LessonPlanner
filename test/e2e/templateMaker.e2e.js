// Browser test: the Template Maker window, through its buttons, on a pretend Google Drive (see README.md).
// In the browser at http://127.0.0.1:5178 (fresh computer: reset + reload first):
//   const t = await import('/e2e/templateMaker.e2e.js'); await t.run();
// Made-up data only; no request ever reaches the real Google (the pretend Drive answers every Google address).

import { DRIVE_SCOPE, google } from '/js/google.js';
import { addFolder } from '/js/library.js';
import { driveLocation } from '/js/locations.js';
import { activeYear } from '/js/model.js';
import { commit, setUi, store } from '/js/store.js';
import { usePicker } from '/js/views/templateMaker.js';
import { fakeGoogle } from './templateMaker/fakeGoogle.js';
import { check, click, find, guardHost, modal, sleep, startNewYear, text, waitFor, watchErrors } from './helpers.js';

export { reset } from './helpers.js';

const YEAR = { name: 'Test Year 2030–31', start: '2030-08-26', end: '2031-06-13' };
const SLIDES = 'application/vnd.google-apps.presentation';
const FOLDER = 'application/vnd.google-apps.folder';
const GOOGLE = /(^|\.)(googleapis\.com|google\.com)$/;

const emu = (magnitude) => ({ magnitude, unit: 'EMU' });
const shape = (id, words) => ({
  objectId: id, size: { width: emu(100), height: emu(50) }, transform: { scaleX: 1, scaleY: 1, translateX: 0, translateY: 0, unit: 'EMU' },
  shape: { text: { textElements: [{ startIndex: 0, endIndex: words.length + 1, textRun: { content: `${words}\n` } }] } },
});

/** A pretend Drive with a templates folder and one made-up slide deck; Google addresses go to it. */
function pretendDrive() {
  const g = fakeGoogle();
  g.add({ id: 'tplFolder', name: 'My Templates', mimeType: FOLDER });
  g.add({
    id: 'deck1', name: 'Week 2 - Rhythm Tree Lesson 3', mimeType: SLIDES,
    content: { slides: [{ objectId: 'slide1', pageElements: [shape('t1', 'Rhythm Tree'), shape('t2', 'Lesson 3 · Week 2')] }] },
  });
  const realFetch = window.fetch;
  window.fetch = (input, init) => {
    const url = String(input?.url ?? input);
    return GOOGLE.test(new URL(url, location.href).hostname) ? g.fetch(url, init) : realFetch(input, init);
  };
  return { g, undo: () => { window.fetch = realFetch; } };
}

async function openWindow() {
  setUi({ tab: 'lessons' });
  await sleep(50);
  const menu = await waitFor(() => document.querySelector('[data-tour="deck-add"]'), 4000, 'the + Add menu');
  menu.open = true;
  await click('Make templates from my lessons');
  return waitFor(() => modal()?.querySelector('.tm'), 4000, 'the Template Maker window');
}

/** Run the case. Returns { passed, errors }. */
export async function run() {
  guardHost();
  const stopWatching = watchErrors();
  const drive = pretendDrive();
  const signedIn = { ...google };
  const codes = window.PLANNER_CONFIG;
  window.PLANNER_CONFIG = { googleClientId: '123-pretend.apps.googleusercontent.com', googleApiKey: 'pretend-key' };
  try {
    if (!store.state) await startNewYear({ ...YEAR, copy: false });
    const yearId = activeYear(store.state).id;
    commit((s) => { addFolder(s, { yearId, name: 'My Templates', watch: true, locations: [driveLocation({ fileId: 'tplFolder', mimeType: FOLDER })] }); });
    Object.assign(google, { status: 'connected', token: 'pretend', scope: DRIVE_SCOPE });
    usePicker(async () => [{ id: 'deck1', name: 'Week 2 - Rhythm Tree Lesson 3', mimeType: SLIDES }]);

    const tm = await openWindow();
    await waitFor(() => tm.querySelector('[data-tour="tm-folders"]'), 6000, 'the folders to be checked');
    check(text(tm.querySelector('[data-tour="tm-folders"]')).includes('My Templates'), 'the templates folder should be the plan’s Drive folder');
    await click('Choose lessons from Google Drive');
    const card = await waitFor(() => tm.querySelector('.tm-file.ready'), 6000, 'the lesson to be read');
    check(card.querySelector('.tm-name-input').value === 'Rhythm Tree', 'the template name should leave out the numbers');
    check(card.querySelectorAll('.tm-match input:checked').length === 2, 'the lesson and week numbers should both be ticked');
    await click('[data-tour="tm-make"]');
    await waitFor(() => find('Show me'), 6000, 'the templates to be made');

    const lesson = store.state.lessons.find((l) => l.name === 'Rhythm Tree');
    check(lesson?.isNew && lesson.yearId === yearId, 'the template should be in Lesson Templates, marked new');
    const copy = drive.g.get(lesson.locations[0].fileId);
    check(copy.parents.includes('tplFolder'), 'the template copy should be in the templates folder');
    check(drive.g.get('deck1').content.slides[0].pageElements[1].shape.text.textElements[0].textRun.content.startsWith('Lesson 3'), 'the teacher’s own file must not change');
    await click('Show me');
    await waitFor(() => !modal(), 3000, 'the window to close');
    check(store.ui.lessonId === lesson.id, 'the new template should be selected');
    const errors = stopWatching();
    return { passed: errors.length === 0, errors };
  } catch (err) {
    return { passed: false, errors: [err.message, ...stopWatching()] };
  } finally {
    usePicker(null);
    window.PLANNER_CONFIG = codes;
    Object.assign(google, signedIn);
    drive.undo();
  }
}

/** Open the window with one lesson read, and leave it open (to look at it). Reload the page afterwards. */
export async function preview() {
  guardHost();
  pretendDrive();
  window.PLANNER_CONFIG = { googleClientId: '123-pretend.apps.googleusercontent.com', googleApiKey: 'pretend-key' };
  if (!store.state) await startNewYear({ ...YEAR, copy: false });
  const yearId = activeYear(store.state).id;
  commit((s) => { addFolder(s, { yearId, name: 'My Templates', watch: true, locations: [driveLocation({ fileId: 'tplFolder', mimeType: FOLDER })] }); });
  Object.assign(google, { status: 'connected', token: 'pretend', scope: DRIVE_SCOPE });
  usePicker(async () => [{ id: 'deck1', name: 'Week 2 - Rhythm Tree Lesson 3', mimeType: SLIDES }]);
  const tm = await openWindow();
  await waitFor(() => tm.querySelector('[data-tour="tm-folders"]'), 6000, 'the folders to be checked');
  await click('Choose lessons from Google Drive');
  await waitFor(() => tm.querySelector('.tm-file.ready'), 6000, 'the lesson to be read');
  return 'Open. Reload the page when done.';
}
