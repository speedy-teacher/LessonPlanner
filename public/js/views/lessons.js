// "Lesson Decks": the library of lessons. Each lesson is one slide deck.
// Built for dozens of decks: search, categories, and which evals use each one.

import { editable, h, toast } from '../dom.js';
import {
  AUTO_FIELDS, duplicateLesson, editLesson, find, lessonEvals, lessonUsageByGrade, outcomeLabel, remove,
} from '../model.js';
import { addDeck, foldersIn, moveDeck } from '../library.js';
import { commit, setUi, store, undo } from '../store.js';
import { current, emptyNote, year } from './common.js';
import { lessonPreview } from './lessonPreview.js';
import { deckTree, openFolders, visibleDecks } from './deckTree.js';
import { addMenu } from './deckImport.js';

function selectedLesson() {
  const l = find(store.state, 'lessons', store.ui.lessonId);
  return l && l.yearId === year().id ? l : visibleDecks()[0] || null;
}

/** A new lesson deck with the usual details filled in (used by the Outcomes tab too). */
export function newLesson(state, name, category = '') {
  return addDeck(state, { yearId: year().id, name, category });
}

export function renderLessons() {
  const selected = selectedLesson();
  return h('div', { class: 'outcomes-layout templates-layout' },
    h('aside', { class: 'side card deck-side' },
      h('div', { class: 'deck-side-head' },
        h('h3', {}, 'Lesson decks', h('span', { class: 'count-badge' }, current('lessons').length)),
        addMenu()),
      h('input', {
        class: 'search', type: 'search', placeholder: '🔍 Search lessons…', value: store.ui.lessonSearch || '',
        dataset: { key: 'lesson-search' },
        oninput: (e) => setUi({ lessonSearch: e.target.value }),
      }),
      deckTree(selected)),
    h('section', { class: 'main-col card' },
      selected ? lessonEditor(selected) : emptyNote('Add a lesson deck to get started.')),
  );
}

function lessonEditor(l) {
  const categories = [...new Set(current('lessons').filter((x) => x.category).map((x) => x.category))].sort();
  const fields = l.autoFields.map((key) => ({ key, label: AUTO_FIELDS[key], value: '' }));
  return h('div', { class: 'template-editor' },
    h('div', { class: 'editor-head' },
      h('label', { class: 'field grow' }, h('span', {}, 'Lesson name'),
        editable(l.name, (name) => commit((s) => editLesson(s, l.id, { name })))),
      h('label', { class: 'field' }, h('span', {}, 'Category'),
        editable(l.category, (category) => commit((s) => editLesson(s, l.id, { category })), { list: 'lesson-categories', placeholder: 'e.g. Ukulele', allowEmpty: true }),
        h('datalist', { id: 'lesson-categories' }, categories.map((c) => h('option', { value: c })))),
      folderPicker(l),
      h('button', { class: 'btn light', onclick: () => duplicate(l) }, 'Duplicate'),
      h('button', {
        class: 'btn light danger', onclick: () => deleteLesson(l),
        title: l.locations.length ? 'Only the planner’s deck goes. The slide file stays where it is.' : null,
      }, l.locations.length ? 'Remove from Planner' : 'Delete')),
    newBanner(l),
    locationList(l),
    h('div', { class: 'template-body' },
      h('div', { class: 'template-preview' }, lessonPreview(l.id, { fields })),
      h('div', {},
        h('h3', {}, 'Instruments this lesson uses'),
        h('p', { class: 'hint' }, 'The Lesson Calendar warns you if one isn’t at the school that week.'),
        instrumentToggles(l),
        h('h3', {}, 'Filled in automatically'),
        h('p', { class: 'hint' }, 'When this lesson is on the Lesson Calendar, these details are added for you.'),
        h('div', { class: 'auto-fields big' }, Object.entries(AUTO_FIELDS).map(([key, label]) => autoFieldToggle(l, key, label))))),
    usedIn(l),
  );
}

/** Which folder the deck is in (decks can also be dragged onto folders on the left). */
function folderPicker(l) {
  const options = [];
  const walk = (parentId, depth) => foldersIn(store.state, year().id, parentId).forEach((f) => {
    options.push(h('option', { value: f.id, selected: f.id === l.folderId }, `${'  '.repeat(depth)}📁 ${f.name}`));
    walk(f.id, depth + 1);
  });
  walk(null, 0);
  return h('label', { class: 'field' }, h('span', {}, 'Folder'),
    h('select', {
      class: 'inline-edit',
      onchange: (e) => {
        const folderId = e.target.value || null;
        commit((s) => moveDeck(s, l.id, folderId));
        if (folderId) openFolders([folderId]);
        setUi({ deckFolderId: folderId });
      },
    }, h('option', { value: '', selected: !l.folderId }, 'Top level'), options));
}

function newBanner(l) {
  if (!l.isNew) return null;
  return h('div', { class: 'new-banner' },
    h('span', { class: 'new-mark' }, '!'),
    h('span', {}, 'Newly added from a watched Google Drive folder. Change any of its details below — or click “Got it” — to mark it as seen.'),
    h('button', { class: 'btn small light', onclick: () => commit((s) => editLesson(s, l.id, {})) }, 'Got it'));
}

/** Where the deck's slides live (it can be in more than one place). */
function locationList(l) {
  if (!l.locations.length) return null;
  return h('ul', { class: 'deck-source' }, l.locations.map((loc) => h('li', {}, locationLabel(loc))));
}

function locationLabel(loc) {
  if (loc.kind === 'drive') {
    return ['☁️ Google Drive · ', h('a', { href: loc.uri, target: '_blank', rel: 'noopener' }, 'Open in Drive ↗')];
  }
  const root = find(store.state, 'localRoots', loc.rootId);
  const path = root ? [root.name, loc.path].filter(Boolean).join('/') : loc.path;
  return ['💻 On the computer: ', h('code', {}, path)];
}

function instrumentToggles(l) {
  const instruments = current('instruments');
  if (!instruments.length) return emptyNote('Add instruments on the Setup tab.');
  return h('div', { class: 'grade-toggles' }, instruments.map((i) => {
    const on = l.instrumentIds.includes(i.id);
    return h('button', {
      class: `grade-toggle ins-toggle ${on ? 'on' : ''}`,
      style: { '--ins': i.color },
      'aria-pressed': on ? 'true' : 'false',
      title: `${on ? 'Remove' : 'Add'} ${i.name}`,
      onclick: () => commit((s) => editLesson(s, l.id, {
        instrumentIds: on ? l.instrumentIds.filter((x) => x !== i.id) : [...l.instrumentIds, i.id],
      })),
    }, i.name);
  }));
}

function autoFieldToggle(l, key, label) {
  return h('label', { class: 'check' },
    h('input', {
      type: 'checkbox',
      checked: l.autoFields.includes(key),
      onchange: (e) => commit((s) => editLesson(s, l.id, {
        autoFields: e.target.checked ? [...l.autoFields, key] : l.autoFields.filter((k) => k !== key),
      })),
    }), label);
}

/** Grade → essential outcome → eval, for every eval this deck is part of. */
function usedIn(l) {
  const groups = lessonUsageByGrade(store.state, l.id);
  return h('section', { class: 'used-by' },
    h('h3', {}, 'Used in the following content'),
    groups.length ? null : emptyNote('Not used yet. Add it to an eval on the Outcomes & Lessons tab.'),
    groups.map(({ grade, outcomes }) => h('div', { class: 'usage-grade' },
      h('h4', { class: 'group-head' }, grade ? grade.name : 'No grade chosen yet'),
      h('ul', {}, outcomes.map(({ outcome, evals }) => h('li', {},
        h('button', {
          class: 'link-btn',
          title: 'Open this outcome',
          onclick: () => setUi({ tab: 'outcomes', outcomeId: outcome?.id }),
        }, outcomeLabel(outcome)),
        h('ul', { class: 'usage-evals' }, evals.map(({ criterion, positions }) => h('li', {},
          criterion.title,
          h('span', { class: 'hint' }, ` — lesson ${positions.join(' & ')}`))))))))));
}

function duplicate(l) {
  const copy = commit((s) => duplicateLesson(s, l.id));
  setUi({ lessonId: copy.id, lessonSearch: '' });
}

function deleteLesson(l) {
  const evals = lessonEvals(store.state, l.id).length;
  commit((s) => remove(s, 'lessons', l.id));
  setUi({ lessonId: null });
  const done = l.locations.length ? `Removed “${l.name}” from the planner` : `Deleted “${l.name}”`;
  toast(evals ? `${done} and took it out of ${evals} eval${evals === 1 ? '' : 's'}.` : `${done}.`,
    { label: 'Undo', run: undo });
}

/** ↑ ↓ move through the lesson list. */
export function lessonKeys(e) {
  if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return false;
  const list = visibleDecks();
  const i = list.findIndex((l) => l.id === selectedLesson()?.id);
  const next = list[Math.max(0, Math.min(list.length - 1, i + (e.key === 'ArrowDown' ? 1 : -1)))];
  if (next) setUi({ lessonId: next.id, deckFolderId: next.folderId });
  return true;
}

