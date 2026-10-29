// A folder tree for the left side of a library page (Lesson Templates, Images): folders open and close,
// items and folders can be dragged into other folders, and a ❗ marks items newly pulled in from
// Google Drive — on the item and every folder above it. Each page describes itself with a `tree`:
//
//   { shelf,                                   // LESSON_SHELF / IMAGE_SHELF (library.js)
//     keys: { item, folder, open },            // where the page keeps its choices in store.ui
//     noun: 'deck',                            // what the items are called ("3 decks")
//     icon: '🖼️', shown: () => [items], filtering: () => bool, extra: (item) => node | null,
//     emptyText, noMatchText, onPick?: (item) => void, afterRemove?: (counts) => text }

import { h, openModal, toast } from '../dom.js';
import { find } from '../model.js';
import { addFolder, decksIn, driveLink, folderAndInside, folderPath, foldersIn, hasNewInside, moveDeck, moveFolder, removeFolder } from '../library.js';
import { driveFileId } from '../locations.js';
import { commit, setUi, store, undo } from '../store.js';
import { emptyNote, menuItem, popMenu, year } from './common.js';

export const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
const dragType = (tree, what) => `application/x-planner-${tree.shelf.items}-${what}`;

function isOpen(tree, folderId) {
  return tree.filtering() || (store.ui[tree.keys.open] || []).includes(folderId);
}

/** Items in the order they appear in the tree (only inside open folders) — for ↑ ↓. */
export function visibleItems(tree) {
  const shown = new Set(tree.shown());
  const walk = (folderId) => [
    ...foldersIn(store.state, year().id, folderId, tree.shelf).flatMap((f) => (isOpen(tree, f.id) ? walk(f.id) : [])),
    ...decksIn(store.state, year().id, folderId, tree.shelf).filter((l) => shown.has(l)),
  ];
  return walk(null);
}

/** Where new and imported items go: the folder last clicked (or the selected item's folder). */
export function treeTarget(tree) {
  const folder = find(store.state, tree.shelf.folders, store.ui[tree.keys.folder]);
  return folder && folder.yearId === year().id ? folder : null;
}

/** Open these folders (and the folders they're in) in the tree. */
export function openTreeFolders(tree, folderIds) {
  const ids = new Set(store.ui[tree.keys.open] || []);
  folderIds.forEach((id) => folderPath(store.state, id, tree.shelf).forEach((f) => ids.add(f.id)));
  setUi({ [tree.keys.open]: [...ids] });
}

function toggleFolder(tree, folder) {
  const ids = store.ui[tree.keys.open] || [];
  const openNow = ids.includes(folder.id);
  setUi({ [tree.keys.open]: openNow ? ids.filter((id) => id !== folder.id) : [...ids, folder.id], [tree.keys.folder]: folder.id });
}

// ---------- the tree ----------

export function folderTree(tree, selected) {
  const shown = new Set(tree.shown());
  const all = store.state[tree.shelf.items].some((i) => i.yearId === year().id) || store.state[tree.shelf.folders].some((f) => f.yearId === year().id);
  if (!all) return emptyNote(tree.emptyText);
  if (!shown.size && tree.filtering()) return emptyNote(tree.noMatchText);
  const el = h('div', { class: 'deck-tree' },
    h('div', { class: 'tree-top-drop', ...dropTarget(tree, null) }, '⤒ Drop here to move to the top level'),
    h('ul', { class: 'tree-list' }, branch(tree, null, 0, { shown, selected })));
  el.addEventListener('dragstart', () => el.classList.add('dragging'));
  el.addEventListener('dragend', () => el.classList.remove('dragging'));
  return el;
}

function branch(tree, folderId, depth, ctx) {
  const folders = foldersIn(store.state, year().id, folderId, tree.shelf)
    .filter((f) => !tree.filtering() || [...ctx.shown].some((l) => folderAndInside(store.state, f.id, tree.shelf).includes(l.folderId)));
  const items = decksIn(store.state, year().id, folderId, tree.shelf).filter((l) => ctx.shown.has(l));
  return [...folders.map((f) => folderItem(tree, f, depth, ctx)), ...items.map((l) => itemRow(tree, l, depth, ctx.selected))];
}

// A cloud for folders from Google Drive; a cracked one when watching is turned off.
const CLOUD_PATH = 'M5.5 14h10a3.5 3.5 0 0 0 .4-7A5 5 0 0 0 6.3 6.2 4 4 0 0 0 5.5 14z';
const CLOUD_SVG = {
  watching: `<svg viewBox="0 0 20 16" aria-hidden="true"><path d="${CLOUD_PATH}" fill="currentColor"/></svg>`,
  'not-watching': `<svg viewBox="0 0 20 16" aria-hidden="true"><mask id="cloud-crack"><rect width="20" height="16" fill="#fff"/>
      <polyline points="11.5,2 9,7.5 12,9.5 9.5,15" fill="none" stroke="#000" stroke-width="1.8" stroke-linejoin="round"/></mask>
      <path d="${CLOUD_PATH}" fill="currentColor" mask="url(#cloud-crack)"/></svg>`,
};

function cloudMark(tree, link) {
  if (!link) return null;
  const tip = link === 'watching'
    ? `Watching this Google Drive folder for new ${tree.noun}s`
    : `From Google Drive, but not watching for new ${tree.noun}s. Turn watching back on in the ⋯ menu.`;
  const el = h('span', { class: `watch-mark ${link}`, 'data-tip': tip, role: 'img', 'aria-label': tip });
  el.innerHTML = CLOUD_SVG[link];
  return el;
}

export function newMark(tip) {
  return h('span', { class: 'new-mark', 'data-tip': tip, 'aria-label': tip }, '!');
}

function folderItem(tree, folder, depth, ctx) {
  const open = isOpen(tree, folder.id);
  const count = folderAndInside(store.state, folder.id, tree.shelf).reduce((n, id) => n + decksIn(store.state, year().id, id, tree.shelf).length, 0);
  return h('li', { class: 'tree-folder' },
    h('div', {
      class: `folder-row ${treeTarget(tree)?.id === folder.id ? 'current' : ''}`,
      style: { '--depth': depth }, draggable: 'true',
      ondragstart: (e) => e.dataTransfer.setData(dragType(tree, 'folder'), folder.id),
      ...dropTarget(tree, folder.id),
    },
    h('button', { class: 'folder-toggle', 'aria-expanded': open ? 'true' : 'false', onclick: () => toggleFolder(tree, folder) },
      h('span', { class: 'caret', 'aria-hidden': 'true' }, open ? '▾' : '▸'),
      h('span', { class: 'folder-icon', 'aria-hidden': 'true' }, open ? '📂' : '📁'),
      h('span', { class: 'template-name' }, folder.name),
      hasNewInside(store.state, folder.id, tree.shelf) ? newMark(`Newly added ${tree.noun}s are in here`) : null,
      cloudMark(tree, driveLink(store.state, folder, tree.shelf))),
    h('span', { class: 'count-badge' }, count),
    folderMenu(tree, folder)),
  open ? h('ul', { class: 'tree-list' }, branch(tree, folder.id, depth + 1, ctx)) : null);
}

function itemRow(tree, item, depth, selected) {
  const pick = () => {
    setUi({ [tree.keys.item]: item.id, [tree.keys.folder]: item.folderId });
    tree.onPick?.(item);
  };
  return h('li', {}, h('button', {
    class: `template-row ${item.id === selected?.id ? 'selected' : ''}`,
    style: { '--depth': depth }, draggable: 'true',
    ondragstart: (e) => e.dataTransfer.setData(dragType(tree, 'item'), item.id),
    onclick: pick,
  },
  h('span', { class: 'deck-icon', 'aria-hidden': 'true' }, tree.icon),
  h('span', { class: 'template-name' }, item.name),
  item.isNew ? newMark('Newly added from Google Drive. Change any of its details to mark it as seen.') : null,
  tree.extra(item)));
}

// ---------- drag and drop ----------

function dropTarget(tree, folderId) {
  const accepts = (e) => e.dataTransfer.types.includes(dragType(tree, 'item')) || e.dataTransfer.types.includes(dragType(tree, 'folder'));
  return {
    ondragover: (e) => { if (accepts(e)) { e.preventDefault(); e.currentTarget.classList.add('drop-over'); } },
    ondragleave: (e) => e.currentTarget.classList.remove('drop-over'),
    ondrop: (e) => {
      e.preventDefault();
      e.stopPropagation();
      e.currentTarget.classList.remove('drop-over');
      dropInto(tree, folderId, e.dataTransfer.getData(dragType(tree, 'item')), e.dataTransfer.getData(dragType(tree, 'folder')));
    },
  };
}

function dropInto(tree, folderId, itemId, movingFolderId) {
  if (itemId) commit((s) => moveDeck(s, itemId, folderId, tree.shelf));
  if (movingFolderId && movingFolderId !== folderId) {
    const moved = commit((s) => moveFolder(s, movingFolderId, folderId, tree.shelf));
    if (!moved) toast('A folder can’t go inside itself.');
  }
  if (folderId) openTreeFolders(tree, [folderId]);
}

// ---------- folder actions ----------

function folderMenu(tree, folder) {
  const rename = (name) => commit((s) => { find(s, tree.shelf.folders, folder.id).name = name; });
  return popMenu({ label: '⋯', title: `Options for ${folder.name}`, menuClass: 'folder-menu' },
    menuItem('Rename', () => askName('Rename folder', folder.name, rename), { icon: '✏️' }),
    menuItem('New folder inside', () => newTreeFolder(tree, folder.id), { icon: '📁' }),
    driveFileId(folder) ? menuItem(folder.watch ? 'Stop watching Drive' : `Watch Drive for new ${tree.noun}s`,
      () => commit((s) => { find(s, tree.shelf.folders, folder.id).watch = !folder.watch; }), { icon: '☁️' }) : null,
    menuItem('Remove from Planner', () => removeFromPlanner(tree, folder), { icon: '🗑️', tip: 'Removes this folder and everything in it from the planner. Your files stay where they are.' }));
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

export function newTreeFolder(tree, parentId) {
  askName('New folder', '', (name) => {
    const folder = commit((s) => addFolder(s, { yearId: year().id, name, parentId, shelf: tree.shelf }));
    if (parentId) openTreeFolders(tree, [parentId]);
    setUi({ [tree.keys.folder]: folder.id });
  }, tree.folderHint ?? 'e.g. Holidays');
}

function removeFromPlanner(tree, folder) {
  const counts = commit((s) => removeFolder(s, folder.id, tree.shelf));
  setUi({ [tree.keys.folder]: folder.parentId });
  const inside = counts.decks ? ` and its ${plural(counts.decks, tree.noun)}` : '';
  const more = tree.afterRemove?.(counts) ?? '';
  toast(`Removed “${folder.name}”${inside} from the planner. Your files weren’t touched.${more}`, { label: 'Undo', run: undo });
}
