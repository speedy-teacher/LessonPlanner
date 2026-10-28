// "Lesson Decks": the library of lessons. Each lesson is one slide deck.
// Built for dozens of decks: search, categories, and which evals use each one.

import { adder, editable, h, toast } from '../dom.js';
import {
  AUTO_FIELDS, add, duplicateLesson, find, lessonEvals, lessonUsageByGrade, lessonsByCategory, outcomeLabel, remove, update,
} from '../model.js';
import { commit, setUi, store, undo } from '../store.js';
import { current, emptyNote, year } from './common.js';
import { lessonPreview } from './lessonPreview.js';

function matches(lesson, search) {
  const text = `${lesson.name} ${lesson.category}`.toLowerCase();
  return search.toLowerCase().split(/\s+/).every((word) => text.includes(word));
}

/** Category groups after applying the search box. */
function filteredGroups() {
  const search = (store.ui.lessonSearch || '').trim();
  return lessonsByCategory(store.state, year().id)
    .map((g) => ({ ...g, lessons: g.lessons.filter((l) => !search || matches(l, search)) }))
    .filter((g) => g.lessons.length);
}

function visibleLessons() {
  return filteredGroups().flatMap((g) => g.lessons);
}

function selectedLesson() {
  const l = find(store.state, 'lessons', store.ui.lessonId);
  return l && l.yearId === year().id ? l : visibleLessons()[0] || null;
}

/** A new lesson deck with the usual details filled in. */
export function newLesson(state, name, category = '') {
  return add(state, 'lessons', {
    yearId: year().id, name, category, autoFields: ['school', 'grade', 'date'], instrumentIds: [],
  });
}

export function renderLessons() {
  const selected = selectedLesson();
  return h('div', { class: 'outcomes-layout templates-layout' },
    h('aside', { class: 'side card' },
      h('h3', {}, 'Lesson decks', h('span', { class: 'count-badge' }, current('lessons').length)),
      adder('New lesson deck…', (name) => {
        const l = commit((s) => newLesson(s, name, selected?.category || ''));
        setUi({ lessonId: l.id, lessonSearch: '' });
      }, 'add-lesson'),
      h('input', {
        class: 'search', type: 'search', placeholder: '🔍 Search lessons…', value: store.ui.lessonSearch || '',
        dataset: { key: 'lesson-search' },
        oninput: (e) => setUi({ lessonSearch: e.target.value }),
      }),
      lessonList(selected)),
    h('section', { class: 'main-col card' },
      selected ? lessonEditor(selected) : emptyNote('Add a lesson deck to get started.')),
  );
}

function lessonList(selected) {
  const groups = filteredGroups();
  if (!groups.length) return emptyNote(store.ui.lessonSearch ? 'No lessons match your search.' : 'No lesson decks yet.');
  return h('div', { class: 'template-groups' }, groups.map(({ category, lessons }) => h('section', {},
    h('h4', { class: 'group-head' }, category || 'No category', h('span', { class: 'count-badge' }, lessons.length)),
    h('ul', { class: 'template-list' }, lessons.map((l) => {
      const evals = lessonEvals(store.state, l.id).length;
      return h('li', {}, h('button', {
        class: `template-row ${l.id === selected?.id ? 'selected' : ''}`,
        onclick: () => setUi({ lessonId: l.id }),
      }, h('span', { class: 'template-name' }, l.name),
      h('span', { class: 'uses', title: evals ? `Taught in ${evals} eval${evals === 1 ? '' : 's'}` : 'Not in any eval yet' },
        evals ? `${evals} eval${evals === 1 ? '' : 's'}` : '—')));
    })))));
}

function lessonEditor(l) {
  const categories = [...new Set(current('lessons').filter((x) => x.category).map((x) => x.category))].sort();
  const fields = l.autoFields.map((key) => ({ key, label: AUTO_FIELDS[key], value: '' }));
  return h('div', { class: 'template-editor' },
    h('div', { class: 'editor-head' },
      h('label', { class: 'field grow' }, h('span', {}, 'Lesson name'),
        editable(l.name, (name) => commit((s) => update(s, 'lessons', l.id, { name })))),
      h('label', { class: 'field' }, h('span', {}, 'Category'),
        editable(l.category, (category) => commit((s) => update(s, 'lessons', l.id, { category })), { list: 'lesson-categories', placeholder: 'e.g. Ukulele', allowEmpty: true }),
        h('datalist', { id: 'lesson-categories' }, categories.map((c) => h('option', { value: c })))),
      h('button', { class: 'btn light', onclick: () => duplicate(l) }, 'Duplicate'),
      h('button', { class: 'btn light danger', onclick: () => deleteLesson(l) }, 'Delete')),
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
      onclick: () => commit((s) => update(s, 'lessons', l.id, {
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
      onchange: (e) => commit((s) => update(s, 'lessons', l.id, {
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
  toast(evals ? `Deleted “${l.name}” and took it out of ${evals} eval${evals === 1 ? '' : 's'}.` : `Deleted “${l.name}”.`,
    { label: 'Undo', run: undo });
}

/** ↑ ↓ move through the lesson list. */
export function lessonKeys(e) {
  if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return false;
  const list = visibleLessons();
  const i = list.findIndex((l) => l.id === selectedLesson()?.id);
  const next = list[Math.max(0, Math.min(list.length - 1, i + (e.key === 'ArrowDown' ? 1 : -1)))];
  if (next) setUi({ lessonId: next.id });
  return true;
}

