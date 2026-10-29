// The folder tree on the left of "Lesson Templates" (the shared folderTree.js, set up for lesson decks):
// search, the "Lessons that use …" instrument filter, and how many evals teach each deck.

import { h } from '../dom.js';
import { find, lessonEvals } from '../model.js';
import { folderPath, LESSON_SHELF } from '../library.js';
import { store } from '../store.js';
import { current, year } from './common.js';
import { askName, folderTree, newTreeFolder, openTreeFolders, plural, treeTarget, visibleItems } from './folderTree.js';

export { askName };

function searchWords() {
  return (store.ui.lessonSearch || '').trim().toLowerCase().split(/\s+/).filter(Boolean);
}

/** Search looks at the deck's name, category and the folders it's in. */
function matches(lesson, words) {
  const folders = folderPath(store.state, lesson.folderId).map((f) => f.name).join(' ');
  const text = `${lesson.name} ${lesson.category} ${folders}`.toLowerCase();
  return words.every((word) => text.includes(word));
}

/** The instrument chosen with "Lessons that use …" (only those lessons are shown), if any. */
export function instrumentFilter() {
  const ins = find(store.state, 'instruments', store.ui.lessonInstrumentId);
  return ins && ins.yearId === year().id ? ins : null;
}

/** The decks that pass the search box and instrument filter (all of them when both are empty). */
function shownDecks() {
  const words = searchWords();
  const ins = instrumentFilter();
  return current('lessons').filter((l) => (!words.length || matches(l, words)) && (!ins || l.instrumentIds.includes(ins.id)));
}

function evalCount(lesson) {
  const evals = lessonEvals(store.state, lesson.id).length;
  return h('span', { class: 'uses', title: evals ? `Taught in ${plural(evals, 'eval')}` : 'Not in any eval yet' },
    evals ? plural(evals, 'eval') : '—');
}

const DECKS = {
  shelf: LESSON_SHELF,
  keys: { item: 'lessonId', folder: 'deckFolderId', open: 'openFolderIds' },
  noun: 'deck', icon: '🖼️', folderHint: 'e.g. Rhythm unit',
  shown: shownDecks,
  filtering: () => searchWords().length > 0 || Boolean(instrumentFilter()),
  extra: evalCount,
  emptyText: 'No lesson decks yet. Use “+ Add” above.',
  noMatchText: 'No lessons match your search.',
  afterRemove: ({ evalSteps }) => (evalSteps ? ` They were taken out of ${plural(evalSteps, 'eval lesson')}.` : ''),
};

export const deckTree = (selected) => folderTree(DECKS, selected);
export const visibleDecks = () => visibleItems(DECKS);
export const targetFolder = () => treeTarget(DECKS);
export const openFolders = (folderIds) => openTreeFolders(DECKS, folderIds);
export const newFolder = (parentId) => newTreeFolder(DECKS, parentId);
