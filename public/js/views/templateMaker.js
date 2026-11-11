// "✨ Make templates from my lessons…" (Lesson Templates → + Add): the Template Maker window.
// The teacher picks lessons they already have (Google Slides/Docs/Sheets, or PowerPoint/Word/Excel kept
// in Drive); the window finds the lesson and week numbers, swaps them for the planner's placeholders, saves
// a template copy in the templates folder and adds it here (❗ new). Their own files are never changed.
// What's going on lives in templateMaker/session.js; this file only draws it. Work goes on if the window
// is closed meanwhile (for this visit), and reopening it shows how far along it is.

import { h, tour } from '../dom.js';
import { canReadFolders, google } from '../google.js';
import { apiKey, clientId } from '../deviceSettings.js';
import { pickFilesFromDrive } from '../drive.js';
import { copyPace } from '../copyPace.js';
import { showNotice } from '../notices.js';
import { commit, setUi, store } from '../store.js';
import { pickableTypes } from '../templateMaker/fileKinds.js';
import { googleClient } from '../templateMaker/googleApi.js';
import { driveCalls } from '../templateMaker/makerDrive.js';
import { createSession } from '../templateMaker/session.js';
import { addTemplates } from '../templateMaker/addToPlan.js';
import { year } from './common.js';
import { driveReady, LESSON_KIND } from './deckImport.js';
import { makeBar } from './templateMakerBar.js';
import { fileCard } from './templateMakerFile.js';

let session = null;
let body = null;
let openFor = null; // the school year the session was made for
let pickFiles = pickFilesFromDrive; // Google's file picker (the browser test hands in a pretend one)

/** For the browser test (test/e2e/templateMaker.e2e.js) only: choose files without Google's picker. */
export function usePicker(fn) {
  pickFiles = fn ?? pickFilesFromDrive;
}

function sessionNow() {
  const key = year()?.id ?? null;
  if (session && openFor === key) return session;
  if (session?.busy()) return session; // still working on the plan it started with
  const pace = copyPace();
  session = createSession({
    calls: driveCalls(googleClient({ token: () => google.token, onSlowDown: () => pace.slowDown() })),
    pace,
    storage: window.localStorage,
    plan: {
      state: () => store.state,
      yearId: () => year().id,
      add: addToPlan,
    },
  });
  openFor = key;
  session.onChange(redraw);
  return session;
}

/** Add what was made (one Undo step). Throws when the plan wouldn't take it (a library shared as view-only). */
function addToPlan(made) {
  const added = commit((s) => addTemplates(s, made, { yearId: year().id }));
  const ids = new Set(store.state.lessons.map((l) => l.id));
  if (added.lessons.some((l) => !ids.has(l.id))) throw new Error('not_added');
  return added;
}

/** Open the window (from the "+ Add" menu, a tutorial or the assistant). */
export function openTemplateMaker() {
  if (!year() || !driveReady({ needFolders: true })) return;
  const s = sessionNow();
  body = h('div', { class: 'tm', 'data-tour': 'template-maker' });
  openModalWide('✨ Make templates from my lessons', body);
  if (s.state.setup.status !== 'ready' && s.state.setup.status !== 'checking') s.checkSetup();
  draw();
}

function openModalWide(title, content) {
  const layer = document.getElementById('modal');
  const close = () => { layer.classList.remove('show'); layer.replaceChildren(); body = null; };
  const card = h('div', { class: 'modal-card tm-card', role: 'dialog', 'aria-label': title },
    h('div', { class: 'tm-title' }, h('h2', {}, title), h('button', { class: 'tm-close', title: 'Close', 'aria-label': 'Close', onclick: close }, '×')),
    content);
  layer.replaceChildren(card);
  layer.classList.add('show');
  layer.onclick = (e) => { if (e.target === layer) close(); };
  card.querySelector('button')?.focus();
}

let drawing = false;
/** Draw soon (many changes at once are drawn together). */
function redraw() {
  if (drawing || !body) return;
  drawing = true;
  setTimeout(() => { drawing = false; draw(); }, 30);
}

function draw() {
  if (!body?.isConnected) { body = null; return; }
  const focus = keepFocus();
  body.replaceChildren(...page(session).filter(Boolean));
  focus();
}

/** Typing in a name box must survive the window being drawn again. */
function keepFocus() {
  const el = document.activeElement;
  const key = el?.dataset?.focus;
  if (!key) return () => {};
  const [start, end] = [el.selectionStart, el.selectionEnd];
  return () => {
    const again = body?.querySelector(`[data-focus="${key}"]`);
    if (!again) return;
    again.focus();
    again.setSelectionRange?.(start, end);
  };
}

function page(s) {
  const ready = s.state.setup.status === 'ready';
  return [
    h('p', { class: 'tm-hint' }, 'Pick lessons you already have — Google Slides, Docs or Sheets, or PowerPoint, Word and Excel files in your Drive. The planner finds the lesson and week numbers, swaps them for placeholders, saves a template copy in your templates folder and adds it to your Lesson Templates. Your own files are never changed.'),
    setupPart(s),
    ready ? filesPart(s) : null,
    makeBar(s, { onShow: showMade }),
  ];
}

// ---------- where things go ----------

function setupPart(s) {
  const { setup, files } = s.state;
  if (setup.status === 'checking' || setup.status === 'idle') return h('div', { class: 'tm-status' }, h('span', { class: 'tm-spinner' }), 'Checking your Drive folders…');
  if (setup.status === 'problem') {
    return h('div', {},
      h('div', { class: 'tm-notice problem' }, setup.message),
      h('button', { class: 'btn small light', onclick: () => s.checkSetup() }, '🔄 Check again'));
  }
  const { chosen } = setup;
  const locked = files.length > 0;
  return h('div', { class: 'tm-setup', 'data-tour': 'tm-folders' },
    setupRow('📁', 'Templates go in', folderPick(s, 'templateFolder', chosen.templateFolders, chosen.templateFolder, locked), chosen.several.templateFolder),
    setupRow('🖼️', 'Pictures go in', picturesPick(s, chosen, locked), chosen.several.imageFolder),
    locked ? h('p', { class: 'tm-hint small' }, 'To change these, take the files below out first.') : null);
}

function setupRow(icon, what, control, several) {
  return h('div', { class: 'tm-setup-row' },
    h('span', {}, icon), h('span', { class: 'tm-what' }, what), control,
    several ? h('span', { class: 'tm-several' }, 'You have more than one — check this is the right one.') : null);
}

function select(options, value, onPick, locked) {
  return h('select', { disabled: locked, onchange: (e) => onPick(e.target.value) },
    options.map(([id, label]) => h('option', { value: id, selected: id === value }, label)));
}

function folderPick(s, part, folders, current, locked) {
  if (folders.length === 1) return h('span', {}, `✓ ${current.path}`);
  return select(folders.map((f) => [f.id, f.path]), current?.id, (id) => s.choose(part, id), locked);
}

function picturesPick(s, chosen, locked) {
  const folders = chosen.imageFolders;
  if (!folders.length) return h('span', { class: 'tm-hint' }, 'No pictures folder yet — pictures won’t be offered. (Bring one in on the Images tab.)');
  const options = [...folders.map((f) => [f.id, f.path]), ['none', 'Don’t save pictures']];
  return select(options, chosen.imageFolder?.id ?? 'none', (id) => s.choose('imageFolder', id), locked);
}

// ---------- the files ----------

function filesPart(s) {
  const { files, phase } = s.state;
  return h('div', {},
    phase === 'choose' ? h('div', { class: 'tm-row' },
      tour('tm-choose', h('button', { class: 'btn', onclick: () => chooseFiles(s) }, files.length ? '📂 Choose more files…' : '📂 Choose lessons from Google Drive…')),
      h('span', { class: 'tm-hint small' }, 'Tip: hold Ctrl to pick several.')) : null,
    files.length ? h('div', { class: 'tm-files' }, files.map((f) => fileCard(f, s, { editable: phase === 'choose' }))) : null);
}

async function chooseFiles(s) {
  if (!driveReady({ needFolders: false })) return;
  try {
    const picked = await pickFiles({ token: google.token, apiKey: apiKey(), clientId: clientId() },
      { mimeTypes: pickableTypes(), title: 'Choose the lessons to make into templates' });
    if (picked.length) await s.addFiles(picked);
  } catch {
    showNotice({ id: 'template-maker', tone: 'error', title: 'Google Drive', message: 'Google’s file picker didn’t open. Check the internet connection and try again.' });
  }
}

/** "Show me": close the window and open the folder + first new template. */
function showMade() {
  const { firstLessonId } = session.state.save;
  const layer = document.getElementById('modal');
  layer.classList.remove('show');
  layer.replaceChildren();
  body = null;
  const lesson = store.state.lessons.find((l) => l.id === firstLessonId);
  if (lesson?.folderId) LESSON_KIND.open([lesson.folderId]);
  setUi({ tab: 'lessons', lessonId: firstLessonId ?? store.ui.lessonId, lessonSearch: '' });
}

/** Can the window open now? (null = yes, else why not — for the menu's tip and the tutorial.) */
export function templateMakerBlocked() {
  if (!year()) return 'Set up a school year first.';
  if (google.status !== 'connected') return 'Sign in to Google Drive first.';
  if (!canReadFolders()) return 'The planner needs one more Google permission first.';
  return null;
}
