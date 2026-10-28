// "Outcomes & Lessons": essential outcomes → eval criteria → grades and
// ordered lessons (slide decks from the Lesson Decks library).

import { adder, editable, h, iconButton, toast } from '../dom.js';
import {
  add, addStep, autoFill, nextColor, criteriaFor, find, lessonsByCategory, moveStep, remove, stepsFor, toggleGrade, update,
} from '../model.js';
import { commit, setUi, store, undo } from '../store.js';
import { current, emptyNote, pickId, year } from './common.js';
import { outcomeColor } from './plan.js';
import { instrumentTags, lessonPreview } from './lessonPreview.js';
import { newLesson } from './lessons.js';

export function renderOutcomes() {
  const outcomes = current('outcomes');
  const outcomeId = pickId(outcomes, store.ui.outcomeId);
  const outcome = find(store.state, 'outcomes', outcomeId);
  return h('div', { class: 'outcomes-layout' },
    h('aside', { class: 'side card' },
      h('h3', {}, 'Essential outcomes'),
      h('ul', { class: 'outcome-list' }, outcomes.map((o) => h('li', {},
        h('button', {
          class: `outcome-chip list-chip ${o.id === outcomeId ? 'selected' : ''}`,
          style: { '--chip': outcomeColor(o.id) },
          onclick: () => setUi({ outcomeId: o.id }),
        }, h('span', { class: 'chip-code' }, o.code || '•'), h('span', { class: 'chip-title' }, o.title))))),
      adder('New outcome…', (title) => {
        const o = commit((s) => add(s, 'outcomes', { yearId: year().id, code: '', title, color: nextColor(s, 'outcomes', year().id) }));
        setUi({ outcomeId: o.id });
      }, 'add-outcome')),
    h('section', { class: 'main-col card' },
      outcome ? outcomeEditor(outcome) : emptyNote('Add an essential outcome to get started.')),
  );
}

function outcomeEditor(outcome) {
  return h('div', { class: 'outcome-editor' },
    h('div', { class: 'editor-head' },
      h('label', { class: 'field color-field', title: 'Color for this outcome and all its evals on the calendar' }, h('span', {}, 'Color'),
        h('input', {
          type: 'color', class: 'color-pick big', value: outcome.color,
          onchange: (e) => commit((s) => update(s, 'outcomes', outcome.id, { color: e.target.value })),
        })),
      h('label', { class: 'field code-field' }, h('span', {}, 'Code'),
        editable(outcome.code, (code) => commit((s) => update(s, 'outcomes', outcome.id, { code })), { placeholder: 'e.g. MU1' })),
      h('label', { class: 'field grow' }, h('span', {}, 'Essential outcome'),
        editable(outcome.title, (title) => commit((s) => update(s, 'outcomes', outcome.id, { title })))),
      h('button', { class: 'btn light danger', onclick: () => removeOutcome(outcome) }, 'Delete outcome')),
    h('h3', {}, 'Eval criteria'),
    criteriaFor(store.state, outcome.id).map((c) => criterionCard(c)),
    adder('New eval criterion…', (title) => commit((s) => add(s, 'criteria', { outcomeId: outcome.id, title, gradeIds: [] })), 'add-criterion'),
  );
}

function removeOutcome(outcome) {
  commit((s) => remove(s, 'outcomes', outcome.id));
  toast(`Deleted “${outcome.title}” and its calendar entries.`, { label: 'Undo', run: undo });
}

function criterionCard(crit) {
  const grades = current('grades');
  return h('article', { class: 'crit-card' },
    h('div', { class: 'crit-head' },
      editable(crit.title, (title) => commit((s) => update(s, 'criteria', crit.id, { title })), { class: 'inline-edit crit-title' }),
      iconButton('🗑', 'Delete this eval criterion', () => {
        commit((s) => remove(s, 'criteria', crit.id));
        toast('Eval criterion deleted.', { label: 'Undo', run: undo });
      })),
    h('div', { class: 'grade-toggles' },
      h('span', { class: 'mini-label' }, 'Grades:'),
      grades.map((g) => h('button', {
        class: `grade-toggle ${crit.gradeIds.includes(g.id) ? 'on' : ''}`,
        title: `${crit.gradeIds.includes(g.id) ? 'Remove' : 'Add'} ${g.name}`,
        'aria-pressed': crit.gradeIds.includes(g.id) ? 'true' : 'false',
        onclick: () => commit((s) => toggleGrade(s, crit.id, g.id)),
      }, g.short || g.name))),
    h('div', { class: 'mini-label' }, 'Lessons, in teaching order (drag ⠿ to reorder):'),
    h('ol', { class: 'slide-list' }, stepsFor(store.state, crit.id).map((s, i, all) => stepRow(s, i, all.length))),
    addLessonRow(crit),
  );
}

function stepRow(step, index, total) {
  const lesson = find(store.state, 'lessons', step.lessonId);
  const li = h('li', { class: 'slide-item', dataset: { stepId: step.id } },
    h('span', { class: 'drag-handle', title: 'Drag to reorder', draggable: 'true',
      ondragstart: (e) => {
        e.dataTransfer.setData('application/x-step', step.id);
        e.dataTransfer.effectAllowed = 'move';
      } }, '⠿'),
    h('span', { class: 'slide-num' }, index + 1),
    lessonPreview(step.lessonId, { small: true, fields: autoFill(store.state, step, null) }),
    h('div', { class: 'slide-fields-edit' },
      lessonPicker(step.lessonId, (lessonId) => commit((s) => update(s, 'criterionLessons', step.id, { lessonId })), 'Lesson'),
      h('div', { class: 'step-meta' },
        lesson?.category ? h('span', { class: 'hint' }, lesson.category) : null,
        instrumentTags(lesson),
        h('button', { class: 'link-btn', title: 'Edit this lesson deck', onclick: () => setUi({ tab: 'lessons', lessonId: step.lessonId }) }, 'Edit deck'))),
    h('div', { class: 'row-actions' },
      iconButton('↑', 'Move up', () => commit((s) => moveStep(s, step.id, index - 1)), index === 0 ? 'invisible' : ''),
      iconButton('↓', 'Move down', () => commit((s) => moveStep(s, step.id, index + 1)), index === total - 1 ? 'invisible' : ''),
      iconButton('×', 'Take out of this eval (the deck stays in your library)', () => {
        commit((s) => remove(s, 'criterionLessons', step.id));
        toast(`Took “${lesson?.name}” out of this eval.`, { label: 'Undo', run: undo });
      })),
  );
  li.addEventListener('dragover', (e) => {
    if (!e.dataTransfer.types.includes('application/x-step')) return;
    e.preventDefault();
    li.classList.add('drop-target');
  });
  li.addEventListener('dragleave', () => li.classList.remove('drop-target'));
  li.addEventListener('drop', (e) => {
    const id = e.dataTransfer.getData('application/x-step');
    const moving = find(store.state, 'criterionLessons', id);
    if (!moving || moving.criterionId !== step.criterionId) return;
    e.preventDefault();
    commit((s) => moveStep(s, id, index));
  });
  return li;
}

/** Add a lesson from the library, or make a brand-new deck and add it. */
function addLessonRow(crit) {
  return h('div', { class: 'add-lesson-row' },
    lessonPicker(null, (lessonId) => { if (lessonId) commit((s) => addStep(s, crit.id, lessonId)); }, 'Add a lesson', '＋ Pick from your decks…'),
    adder('…or a new lesson deck', (name) => commit((s) => addStep(s, crit.id, newLesson(s, name).id)), `add-lesson-${crit.id}`));
}

/** Lesson dropdown, grouped by category so dozens of decks stay findable. */
function lessonPicker(value, onPick, label, noneLabel = null) {
  const groups = lessonsByCategory(store.state, year().id);
  const option = (l) => h('option', { value: l.id, selected: l.id === value }, l.name);
  return h('label', { class: 'mini-select' }, h('span', {}, label),
    h('select', { onchange: (e) => onPick(e.target.value || null) },
      noneLabel ? h('option', { value: '', selected: true }, noneLabel) : null,
      groups.map(({ category, lessons }) => h('optgroup', { label: category || 'No category' }, lessons.map(option)))));
}
