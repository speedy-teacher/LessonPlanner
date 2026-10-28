// The folder tree on the left of "Lesson Decks": folders open and close,
// decks and folders can be dragged into other folders, and a ❗ marks decks
// newly pulled in from Google Drive — on the deck and every folder above it.

import { h, openModal, toast } from '../dom.js';
import { find, lessonEvals } from '../model.js';
import {
  addFolder, decksIn, folderAndInside, folderPath, foldersIn, hasNewInside, moveDeck, moveFolder, removeFolder,
} from '../library.js';
import { commit, setUi, store, undo } from '../store.js';
import { current, emptyNote, menuItem, popMenu, year } from './common.js';

const DECK_TYPE = 'application/x-planner-deck';
const FOLDER_TYPE = 'application/x-planner-folder';
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

// ---------- what's shown ----------

function searchWords() {
  return (store.ui.lessonSearch || '').trim().toLowerCase().split(/\s+/).filter(Boolean);
}

/** Search looks at the deck's name, category and the folders it's in. */
function matches(lesson, words) {
  const folders = folderPath(store.state, lesson.folderId).map((f) => f.name).join(' ');
  const text = `${lesson.name} ${lesson.category} ${folders}`.toLowerCase();
  return words.every((word) => text.includes(word));
}

/** The decks that pass the search box (all of them when it's empty). */
function shownDecks() {
  const words = searchWords();
  return current('lessons').filter((l) => !words.length || matches(l, words));
}

function isOpen(folderId) {
  return searchWords().length > 0 || (store.ui.openFolderIds || []).includes(folderId);
}

/** Decks in the order they appear in the tree (only inside open folders) — for ↑ ↓. */
export function visibleDecks() {
  const shown = new Set(shownDecks());
  const walk = (folderId) => [
    ...foldersIn(store.state, year().id, folderId).flatMap((f) => (isOpen(f.id) ? walk(f.id) : [])),
    ...decksIn(store.state, year().id, folderId).filter((l) => shown.has(l)),
  ];
  return walk(null);
}

/** Where new and imported decks go: the folder you last clicked (or the selected deck's folder). */
export function targetFolder() {
  const folder = find(store.state, 'deckFolders', store.ui.deckFolderId);
  return folder && folder.yearId === year().id ? folder : null;
}

/** Open these folders (and the folders they're in) in the tree. */
export function openFolders(folderIds) {
  const ids = new Set(store.ui.openFolderIds || []);
  folderIds.forEach((id) => folderPath(store.state, id).forEach((f) => ids.add(f.id)));
  setUi({ openFolderIds: [...ids] });
}

function toggleFolder(folder) {
  const ids = store.ui.openFolderIds || [];
  const openNow = ids.includes(folder.id);
  setUi({ openFolderIds: openNow ? ids.filter((id) => id !== folder.id) : [...ids, folder.id], deckFolderId: folder.id });
}

// ---------- the tree ----------

export function deckTree(selected) {
  const shown = new Set(shownDecks());
  if (!current('lessons').length && !current('deckFolders').length) return emptyNote('No lesson decks yet. Use “+ Add” above.');
  if (!shown.size && searchWords().length) return emptyNote('No lessons match your search.');
  const tree = h('div', { class: 'deck-tree' },
    h('div', { class: 'tree-top-drop', ...dropTarget(null) }, '⤒ Drop here to move to the top level'),
    h('ul', { class: 'tree-list' }, branch(null, 0, { shown, selected })));
  tree.addEventListener('dragstart', () => tree.classList.add('dragging'));
  tree.addEventListener('dragend', () => tree.classList.remove('dragging'));
  return tree;
}

function branch(folderId, depth, ctx) {
  const folders = foldersIn(store.state, year().id, folderId)
    .filter((f) => !searchWords().length || [...ctx.shown].some((l) => folderAndInside(store.state, f.id).includes(l.folderId)));
  const decks = decksIn(store.state, year().id, folderId).filter((l) => ctx.shown.has(l));
  return [...folders.map((f) => folderItem(f, depth, ctx)), ...decks.map((l) => deckItem(l, depth, ctx.selected))];
}

function newMark(tip) {
  return h('span', { class: 'new-mark', 'data-tip': tip, 'aria-label': tip }, '!');
}

function folderItem(folder, depth, ctx) {
  const open = isOpen(folder.id);
  const count = folderAndInside(store.state, folder.id).reduce((n, id) => n + decksIn(store.state, year().id, id).length, 0);
  return h('li', { class: 'tree-folder' },
    h('div', {
      class: `folder-row ${targetFolder()?.id === folder.id ? 'current' : ''}`,
      style: { '--depth': depth }, draggable: 'true',
      ondragstart: (e) => e.dataTransfer.setData(FOLDER_TYPE, folder.id),
      ...dropTarget(folder.id),
    },
    h('button', { class: 'folder-toggle', 'aria-expanded': open ? 'true' : 'false', onclick: () => toggleFolder(folder) },
      h('span', { class: 'caret', 'aria-hidden': 'true' }, open ? '▾' : '▸'),
      h('span', { class: 'folder-icon', 'aria-hidden': 'true' }, open ? '📂' : '📁'),
      h('span', { class: 'template-name' }, folder.name),
      hasNewInside(store.state, folder.id) ? newMark('Newly added decks are in here') : null,
      folder.watch ? h('span', { class: 'watch-mark', 'data-tip': 'Watching this Google Drive folder for new decks' }, '☁') : null),
    h('span', { class: 'count-badge' }, count),
    folderMenu(folder)),
  open ? h('ul', { class: 'tree-list' }, branch(folder.id, depth + 1, ctx)) : null);
}

function deckItem(l, depth, selected) {
  const evals = lessonEvals(store.state, l.id).length;
  return h('li', {}, h('button', {
    class: `template-row ${l.id === selected?.id ? 'selected' : ''}`,
    style: { '--depth': depth }, draggable: 'true',
    ondragstart: (e) => e.dataTransfer.setData(DECK_TYPE, l.id),
    onclick: () => setUi({ lessonId: l.id, deckFolderId: l.folderId }),
  },
  h('span', { class: 'deck-icon', 'aria-hidden': 'true' }, '🖼️'),
  h('span', { class: 'template-name' }, l.name),
  l.isNew ? newMark('Newly added from Google Drive. Change any of its details to mark it as seen.') : null,
  h('span', { class: 'uses', title: evals ? `Taught in ${plural(evals, 'eval')}` : 'Not in any eval yet' },
    evals ? plural(evals, 'eval') : '—')));
}

// ---------- drag and drop ----------

function dropTarget(folderId) {
  const accepts = (e) => e.dataTransfer.types.includes(DECK_TYPE) || e.dataTransfer.types.includes(FOLDER_TYPE);
  return {
    ondragover: (e) => { if (accepts(e)) { e.preventDefault(); e.currentTarget.classList.add('drop-over'); } },
    ondragleave: (e) => e.currentTarget.classList.remove('drop-over'),
    ondrop: (e) => {
      e.preventDefault();
      e.stopPropagation();
      e.currentTarget.classList.remove('drop-over');
      dropInto(folderId, e.dataTransfer.getData(DECK_TYPE), e.dataTransfer.getData(FOLDER_TYPE));
    },
  };
}

function dropInto(folderId, deckId, movingFolderId) {
  if (deckId) commit((s) => moveDeck(s, deckId, folderId));
  if (movingFolderId && movingFolderId !== folderId) {
    const moved = commit((s) => moveFolder(s, movingFolderId, folderId));
    if (!moved) toast('A folder can’t go inside itself.');
  }
  if (folderId) openFolders([folderId]);
}

// ---------- folder actions ----------

function folderMenu(folder) {
  return popMenu({ label: '⋯', title: `Options for ${folder.name}`, menuClass: 'folder-menu' },
    menuItem('Rename', () => askName('Rename folder', folder.name, (name) => commit((s) => { find(s, 'deckFolders', folder.id).name = name; })), { icon: '✏️' }),
    menuItem('New folder inside', () => newFolder(folder.id), { icon: '📁' }),
    folder.source?.kind === 'drive' ? menuItem(folder.watch ? 'Stop watching Drive' : 'Watch Drive for new decks',
      () => commit((s) => { find(s, 'deckFolders', folder.id).watch = !folder.watch; }), { icon: '☁️' }) : null,
    menuItem('Delete folder', () => deleteFolder(folder), { icon: '🗑️' }));
}

/** Ask for a name in a little dialog. */
export function askName(title, initial, onSave, placeholder = '') {
  openModal(title, (close) => {
    const input = h('input', { class: 'modal-input', value: initial, placeholder });
    const save = () => { const name = input.value.trim(); if (name) { close(); onSave(name); } };
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') save(); if (e.key === 'Escape') close(); });
    setTimeout(() => input.select());
    return h('div', { class: 'modal-body' }, input,
      h('div', { class: 'modal-actions' },
        h('button', { class: 'btn light', onclick: close }, 'Cancel'),
        h('button', { class: 'btn', onclick: save }, 'Save')));
  });
}

export function newFolder(parentId) {
  askName('New folder', '', (name) => {
    const folder = commit((s) => addFolder(s, { yearId: year().id, name, parentId }));
    if (parentId) openFolders([parentId]);
    setUi({ deckFolderId: folder.id });
  }, 'e.g. Rhythm unit');
}

function deleteFolder(folder) {
  const parent = find(store.state, 'deckFolders', folder.parentId);
  commit((s) => removeFolder(s, folder.id));
  setUi({ deckFolderId: folder.parentId });
  toast(`Deleted the folder “${folder.name}”. What was in it moved to ${parent ? `“${parent.name}”` : 'the top level'}.`,
    { label: 'Undo', run: undo });
}
