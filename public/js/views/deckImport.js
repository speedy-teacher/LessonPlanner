// "+ Add" on the Lesson Templates tab: a new blank deck, decks from the computer
// (single files or a whole folder), or from Google Drive. Also keeps watched
// Drive folders up to date: new decks there are pulled in and marked ❗.
// Everything happens in the browser; only deck details are saved.
// The Images tab uses the same Drive import and watching (`importFromDrive(IMAGE_KIND)`).

import { h } from '../dom.js';
import {
  addDeck, DECK_EXTENSIONS, DRIVE_FOLDER, IMAGE_SHELF, importDriveItems, importLocalFiles, LESSON_SHELF, syncWatchedFolders, watchedFolders,
} from '../library.js';
import { canReadFolders, connectDrive, google } from '../google.js';
import { apiKey, clientId } from '../deviceSettings.js';
import { listFolderTree, pickFromDrive } from '../drive.js';
import { driveFileId } from '../locations.js';
import { dismissNotice, showNotice } from '../notices.js';
import { commit, setUi, store } from '../store.js';
import { menuItem, popMenu, year } from './common.js';
import { askName, newFolder, openFolders, targetFolder } from './deckTree.js';

const WATCH_EVERY_MS = 10 * 60 * 1000;
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** What's being brought in: lesson decks, or pictures for the Images tab. */
export const LESSON_KIND = {
  shelf: LESSON_SHELF, noun: 'lesson deck', tab: 'lessons', pickTitle: 'Pick lesson files or folders', where: 'Lesson Templates',
  target: () => targetFolder(), open: (ids) => openFolders(ids), select: (item) => setUi({ lessonId: item.id, lessonSearch: '' }),
};
let IMAGE_KIND = null;
/** The Images tab hands in how it opens folders and selects pictures. */
export function setImageKind(kind) {
  IMAGE_KIND = { shelf: IMAGE_SHELF, noun: 'picture', tab: 'images', pickTitle: 'Pick pictures or folders of pictures', where: 'Images', ...kind };
  return IMAGE_KIND;
}

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
    menuItem('Files or folders…', () => importFromDrive(LESSON_KIND), { icon: '☁️', tip: 'Any kind of Drive file (Docs, Sheets, Slides, PDFs…). Folders are watched: new files added there show up here' }));
}

function newDeck() {
  const folderId = targetFolder()?.id ?? null;
  askName('New lesson deck', '', (name) => {
    const l = commit((s) => addDeck(s, { yearId: year().id, name, folderId }));
    setUi({ lessonId: l.id, lessonSearch: '' });
  }, 'e.g. Steady beat warm-up');
}

/** After bringing decks in: open their folders, select the first new deck, say what happened. */
function showResult(result, where, kind = LESSON_KIND) {
  const { added, folders, skipped } = result;
  kind.open([...folders.map((f) => f.id), ...added.map((l) => l.folderId).filter(Boolean)]);
  if (added[0]) kind.select(added[0]);
  const parts = [`Added ${plural(added.length, kind.noun)}`];
  if (folders.length) parts.push(`and ${plural(folders.length, 'folder')}`);
  const skippedNote = skipped.length ? ` Skipped ${plural(skipped.length, 'file')} of a kind the planner doesn’t add (${skipped.slice(0, 3).join(', ')}${skipped.length > 3 ? '…' : ''}).` : '';
  const nothing = !added.length && !folders.length;
  showNotice({
    id: 'deck-import', tone: nothing ? 'info' : 'success', title: where,
    message: nothing ? `Nothing new to add — those are already here.${skippedNote}` : `${parts.join(' ')}.${skippedNote}`,
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
  const googleClientId = clientId();
  const googleApiKey = apiKey();
  if (!googleClientId || !googleApiKey) {
    showNotice({ id: 'drive-import', tone: 'warn', title: 'Google Drive isn’t switched on', message: 'This website was published without the Google codes (see docs/hosting.md).' });
    return false;
  }
  if (google.status !== 'connected') {
    showNotice({ id: 'drive-import', tone: 'warn', title: 'Connect Google Drive first', message: 'Sign in to Google Drive, then try again.', actions: [{ label: 'Sign in', run: () => connectDrive(googleClientId) }] });
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
    actions: [{ label: 'Sign in again', run: () => connectDrive(clientId()) }],
    seconds: null,
  });
}

export async function importFromDrive(kind) {
  if (!driveReady({ needFolders: false })) return;
  try {
    const picked = await pickFromDrive({ token: google.token, apiKey: apiKey(), clientId: clientId() }, { title: kind.pickTitle });
    if (!picked.length) return;
    const hasFolder = picked.some((p) => p.mimeType === DRIVE_FOLDER);
    if (hasFolder && !canReadFolders()) { askForFolderAccess(); return; }
    if (hasFolder) showNotice({ id: 'drive-import', tone: 'info', title: 'Google Drive', message: 'Reading your folders…', seconds: null });
    const nodes = await Promise.all(picked.map(async (p) => (p.mimeType === DRIVE_FOLDER ? { ...p, children: await listFolderTree(google.token, p.id) } : p)));
    const parentId = kind.target()?.id ?? null;
    showResult(commit((s) => importDriveItems(s, { yearId: year().id, parentId, nodes, shelf: kind.shelf })), 'From Google Drive', kind);
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
  checking = true;
  lastCheck = Date.now();
  try {
    for (const kind of [LESSON_KIND, IMAGE_KIND].filter(Boolean)) await checkKind(kind);
  } catch (err) {
    console.warn('Checking watched Drive folders failed', err);
  } finally {
    checking = false;
  }
}

async function checkKind(kind) {
  const y = year();
  const folders = watchedFolders(store.state, y.id, kind.shelf);
  if (!folders.length) return;
  const trees = {};
  for (const f of folders) trees[f.id] = await listFolderTree(google.token, driveFileId(f));
  const added = commit((s) => syncWatchedFolders(s, y.id, trees, undefined, kind.shelf));
  if (added.length) announceNew(added, kind);
}

function announceNew(added, kind) {
  const id = `drive-new-${kind.tab}`;
  showNotice({
    id, tone: 'info', title: 'New files from Google Drive',
    message: `${plural(added.length, `new ${kind.noun}`)} ${added.length === 1 ? 'was' : 'were'} added. Follow the ❗ in ${kind.where} to find ${added.length === 1 ? 'it' : 'them'}.`,
    actions: [{ label: 'Show me', run: () => { dismissNotice(id); kind.open(added.map((l) => l.folderId).filter(Boolean)); setUi({ tab: kind.tab }); kind.select(added[0]); } }],
    seconds: 30,
  });
}

/** Check watched folders now and then while the planner is open. */
export function startWatchingDrive() {
  setInterval(() => checkWatchedFolders(), 60 * 1000);
}
