// "+ Add" on the Lesson Decks tab: a new blank deck, decks from the computer
// (single files or a whole folder), or from Google Drive. Also keeps watched
// Drive folders up to date: new decks there are pulled in and marked ❗.
// Everything happens in the browser; only deck details are saved.

import { h } from '../dom.js';
import { addDeck, DECK_EXTENSIONS, DRIVE_FOLDER, importDriveItems, importLocalFiles, syncWatchedFolders, watchedFolders } from '../library.js';
import { canReadFolders, connectDrive, google } from '../google.js';
import { listFolderTree, pickFromDrive } from '../drive.js';
import { driveFileId } from '../locations.js';
import { dismissNotice, showNotice } from '../notices.js';
import { commit, setUi, store } from '../store.js';
import { menuItem, popMenu, year } from './common.js';
import { askName, newFolder, openFolders, targetFolder } from './deckTree.js';

const WATCH_EVERY_MS = 10 * 60 * 1000;
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** The "+ Add" button and its menu. */
export function addMenu() {
  const target = targetFolder();
  return popMenu({ label: '+ Add ▾', title: 'Add lesson decks', summaryClass: 'btn small', menuClass: 'add-menu' },
    h('p', { class: 'menu-note' }, 'Adds to: ', h('strong', {}, target ? `📁 ${target.name}` : 'the top level')),
    menuItem('New lesson deck', newDeck, { icon: '✏️' }),
    menuItem('New folder', () => newFolder(target?.id ?? null), { icon: '📁' }),
    h('div', { class: 'menu-group' }, 'From computer'),
    menuItem('Slide files…', () => pickLocal(false), { icon: '📄', tip: 'Pick one or more slide decks' }),
    menuItem('A folder of slides…', () => pickLocal(true), { icon: '🗂️', tip: 'Brings in every deck, including folders inside folders' }),
    h('div', { class: 'menu-group' }, 'From Google Drive'),
    menuItem('Decks or folders…', importFromDrive, { icon: '☁️', tip: 'Folders are watched: new decks added there show up here' }));
}

function newDeck() {
  const folderId = targetFolder()?.id ?? null;
  askName('New lesson deck', '', (name) => {
    const l = commit((s) => addDeck(s, { yearId: year().id, name, folderId }));
    setUi({ lessonId: l.id, lessonSearch: '' });
  }, 'e.g. Steady beat warm-up');
}

/** After bringing decks in: open their folders, select the first new deck, say what happened. */
function showResult(result, where) {
  const { added, folders, skipped } = result;
  openFolders([...folders.map((f) => f.id), ...added.map((l) => l.folderId).filter(Boolean)]);
  if (added[0]) setUi({ lessonId: added[0].id, lessonSearch: '' });
  const parts = [`Added ${plural(added.length, 'lesson deck')}`];
  if (folders.length) parts.push(`and ${plural(folders.length, 'folder')}`);
  const skippedNote = skipped.length ? ` Skipped ${plural(skipped.length, 'file')} that ${skipped.length === 1 ? 'isn’t a slide deck' : 'aren’t slide decks'}.` : '';
  const nothing = !added.length && !folders.length;
  showNotice({
    id: 'deck-import', tone: nothing ? 'info' : 'success', title: where,
    message: nothing ? `Nothing new to add — those decks are already here.${skippedNote}` : `${parts.join(' ')}.${skippedNote}`,
  });
}

// ---------- from the computer ----------

function pickLocal(folder) {
  const input = h('input', {
    type: 'file', multiple: true, hidden: true,
    accept: folder ? null : DECK_EXTENSIONS.map((ext) => `.${ext}`).join(','),
    webkitdirectory: folder ? true : null,
  });
  input.addEventListener('change', () => {
    const files = [...input.files].map((f) => ({ path: f.webkitRelativePath || f.name, size: f.size, modifiedTime: new Date(f.lastModified).toISOString() }));
    input.remove();
    if (!files.length) return;
    const parentId = targetFolder()?.id ?? null;
    showResult(commit((s) => importLocalFiles(s, { yearId: year().id, parentId, files })), 'From your computer');
  });
  document.body.append(input);
  input.click();
}

// ---------- from Google Drive ----------

/** Make sure Drive is connected (and can read folders); otherwise explain and offer to sign in. */
function driveReady({ needFolders }) {
  const { googleClientId, googleApiKey } = store.state.settings;
  const goSetup = { label: 'Open Setup', run: () => setUi({ tab: 'setup' }) };
  if (!googleClientId || !googleApiKey) {
    showNotice({ id: 'drive-import', tone: 'warn', title: 'Google Drive isn’t set up yet', message: 'Fill in the Google Drive card on the Setup tab first (including the API key).', actions: [goSetup] });
    return false;
  }
  if (google.status !== 'connected') {
    showNotice({ id: 'drive-import', tone: 'warn', title: 'Connect Google Drive first', message: 'Sign in to Google Drive, then try again.', actions: [{ label: 'Sign in', run: () => connectDrive(googleClientId.trim()) }] });
    return false;
  }
  if (needFolders && !canReadFolders()) {
    askForFolderAccess();
    return false;
  }
  return true;
}

function askForFolderAccess() {
  showNotice({
    id: 'drive-folder-access', tone: 'warn', title: 'One more Google permission',
    message: 'To bring in folders and watch them for new decks, Google needs you to sign in again and allow the planner to see your Drive files (it never changes them).',
    actions: [{ label: 'Sign in again', run: () => connectDrive(store.state.settings.googleClientId.trim()) }],
    seconds: null,
  });
}

async function importFromDrive() {
  if (!driveReady({ needFolders: false })) return;
  const { googleClientId, googleApiKey } = store.state.settings;
  try {
    const picked = await pickFromDrive({ token: google.token, apiKey: googleApiKey.trim(), clientId: googleClientId });
    if (!picked.length) return;
    const hasFolder = picked.some((p) => p.mimeType === DRIVE_FOLDER);
    if (hasFolder && !canReadFolders()) { askForFolderAccess(); return; }
    if (hasFolder) showNotice({ id: 'drive-import', tone: 'info', title: 'Google Drive', message: 'Reading your folders…', seconds: null });
    const nodes = await Promise.all(picked.map(async (p) => (p.mimeType === DRIVE_FOLDER ? { ...p, children: await listFolderTree(google.token, p.id) } : p)));
    const parentId = targetFolder()?.id ?? null;
    showResult(commit((s) => importDriveItems(s, { yearId: year().id, parentId, nodes })), 'From Google Drive');
  } catch (err) {
    showNotice({ id: 'drive-import', tone: 'error', title: 'Google Drive', message: driveProblem(err) });
  }
}

function driveProblem(err) {
  if (err.message === 'signed_out') return 'Google signed you out. Sign in again from the Drive button at the top.';
  if (err.message === 'offline') return 'Couldn’t reach Google. Check the internet connection and try again.';
  return 'Google Drive didn’t answer as expected. Try again in a minute.';
}

// ---------- watched folders ----------

let lastCheck = 0;
let checking = false;

function readyToCheck(now) {
  if (!store.state || !year() || checking) return false;
  if (google.status !== 'connected' || !canReadFolders()) return false;
  return now || Date.now() - lastCheck >= WATCH_EVERY_MS;
}

/** Look for new decks in watched Drive folders (quietly; at most every 10 minutes unless `now`). */
export async function checkWatchedFolders({ now = false } = {}) {
  if (!readyToCheck(now)) return;
  const y = year();
  const folders = watchedFolders(store.state, y.id);
  if (!folders.length) return;
  checking = true;
  lastCheck = Date.now();
  try {
    const trees = {};
    for (const f of folders) trees[f.id] = await listFolderTree(google.token, driveFileId(f));
    const added = commit((s) => syncWatchedFolders(s, y.id, trees));
    if (added.length) announceNew(added);
  } catch (err) {
    console.warn('Checking watched Drive folders failed', err);
  } finally {
    checking = false;
  }
}

function announceNew(added) {
  showNotice({
    id: 'drive-new-decks', tone: 'info', title: 'New lesson decks from Google Drive',
    message: `${plural(added.length, 'new deck')} ${added.length === 1 ? 'was' : 'were'} added. Follow the ❗ in Lesson Decks to find ${added.length === 1 ? 'it' : 'them'}.`,
    actions: [{ label: 'Show me', run: () => { dismissNotice('drive-new-decks'); openFolders(added.map((l) => l.folderId).filter(Boolean)); setUi({ tab: 'lessons', lessonId: added[0].id, lessonSearch: '' }); } }],
    seconds: 30,
  });
}

/** Check watched folders now and then while the planner is open. */
export function startWatchingDrive() {
  setInterval(() => checkWatchedFolders(), 60 * 1000);
}
