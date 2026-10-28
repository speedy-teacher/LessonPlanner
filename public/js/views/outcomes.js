// "Outcomes & Lessons": essential outcomes → eval criteria → grades and
// ordered lesson slides.

import { adder, editable, h, iconButton, toast } from '../dom.js';
import { add, addSlide, autoFill, criteriaFor, find, moveSlide, remove, slidesFor, toggleGrade, update } from '../model.js';
import { commit, setUi, store, undo } from '../store.js';
import { current, emptyNote, pickId, year } from './common.js';
import { outcomeColor } from './plan.js';
import { slidePreview } from './slides.js';

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
        const o = commit((s) => add(s, 'outcomes', { yearId: year().id, code: '', title }));
        setUi({ outcomeId: o.id });
      }, 'add-outcome')),
    h('section', { class: 'main-col card' },
      outcome ? outcomeEditor(outcome) : emptyNote('Add an essential outcome to get started.')),
  );
}

function outcomeEditor(outcome) {
  return h('div', { class: 'outcome-editor' },
    h('div', { class: 'editor-head' },
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
    h('div', { class: 'mini-label' }, 'Lesson slides, in teaching order (drag ⠿ to reorder):'),
    h('ol', { class: 'slide-list' }, slidesFor(store.state, crit.id).map((s, i, all) => slideRow(s, i, all.length))),
    adder('New lesson slide…', (title) => commit((s) => addSlide(s, crit.id, { title })), `add-slide-${crit.id}`),
  );
}

function slideRow(slide, index, total) {
  const li = h('li', { class: 'slide-item', dataset: { slideId: slide.id } },
    h('span', { class: 'drag-handle', title: 'Drag to reorder', draggable: 'true',
      ondragstart: (e) => {
        e.dataTransfer.setData('application/x-slide', slide.id);
        e.dataTransfer.effectAllowed = 'move';
      } }, '⠿'),
    h('span', { class: 'slide-num' }, index + 1),
    slidePreview(slide, { small: true, fields: autoFill(store.state, slide, null) }),
    h('div', { class: 'slide-fields-edit' },
      editable(slide.title, (title) => commit((s) => update(s, 'slides', slide.id, { title }))),
      h('div', { class: 'slide-selects' },
        picker('Template', current('templates'), slide.templateId, (templateId) => commit((s) => update(s, 'slides', slide.id, { templateId }))),
        picker('Instrument', current('instruments'), slide.instrumentId, (instrumentId) => commit((s) => update(s, 'slides', slide.id, { instrumentId })), 'None'))),
    h('div', { class: 'row-actions' },
      iconButton('↑', 'Move up', () => commit((s) => moveSlide(s, slide.id, index - 1)), index === 0 ? 'invisible' : ''),
      iconButton('↓', 'Move down', () => commit((s) => moveSlide(s, slide.id, index + 1)), index === total - 1 ? 'invisible' : ''),
      iconButton('×', 'Delete slide', () => {
        commit((s) => remove(s, 'slides', slide.id));
        toast('Slide deleted.', { label: 'Undo', run: undo });
      })),
  );
  li.addEventListener('dragover', (e) => {
    if (!e.dataTransfer.types.includes('application/x-slide')) return;
    e.preventDefault();
    li.classList.add('drop-target');
  });
  li.addEventListener('dragleave', () => li.classList.remove('drop-target'));
  li.addEventListener('drop', (e) => {
    const id = e.dataTransfer.getData('application/x-slide');
    const moving = find(store.state, 'slides', id);
    if (!moving || moving.criterionId !== slide.criterionId) return;
    e.preventDefault();
    commit((s) => moveSlide(s, id, index));
  });
  return li;
}

function picker(label, items, value, onPick, noneLabel = 'None') {
  return h('label', { class: 'mini-select' }, h('span', {}, label),
    h('select', { onchange: (e) => onPick(e.target.value || null) },
      h('option', { value: '' }, noneLabel),
      items.map((i) => h('option', { value: i.id, selected: i.id === value }, i.name))));
}
