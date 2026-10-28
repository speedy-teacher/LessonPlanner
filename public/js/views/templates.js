// "Templates": the lesson slide template library. Built for dozens of
// templates: search, categories, and a "used by" list for each one.

import { adder, editable, h, toast } from '../dom.js';
import {
  AUTO_FIELDS, add, duplicateTemplate, find, outcomeLabel, remove, templateUsage,
  templatesByCategory, update,
} from '../model.js';
import { commit, setUi, store, undo } from '../store.js';
import { emptyNote, year } from './common.js';
import { slidePreview } from './slides.js';

function matches(template, search) {
  const text = `${template.name} ${template.category}`.toLowerCase();
  return search.toLowerCase().split(/\s+/).every((word) => text.includes(word));
}

/** Category groups after applying the search box. */
function filteredGroups() {
  const search = (store.ui.templateSearch || '').trim();
  return templatesByCategory(store.state, year().id)
    .map((g) => ({ ...g, templates: g.templates.filter((t) => !search || matches(t, search)) }))
    .filter((g) => g.templates.length);
}

function visibleTemplates() {
  return filteredGroups().flatMap((g) => g.templates);
}

function selectedTemplate() {
  const t = find(store.state, 'templates', store.ui.templateId);
  return t && t.yearId === year().id ? t : visibleTemplates()[0] || null;
}

export function renderTemplates() {
  const selected = selectedTemplate();
  return h('div', { class: 'outcomes-layout templates-layout' },
    h('aside', { class: 'side card' },
      h('h3', {}, 'Lesson slide templates', h('span', { class: 'count-badge' }, templatesByCategory(store.state, year().id).reduce((n, g) => n + g.templates.length, 0))),
      adder('New template…', (name) => {
        const t = commit((s) => add(s, 'templates', { yearId: year().id, name, category: selected?.category || '', autoFields: ['school', 'grade', 'date'] }));
        setUi({ templateId: t.id, templateSearch: '' });
      }, 'add-template'),
      h('input', {
        class: 'search', type: 'search', placeholder: '🔍 Search templates…', value: store.ui.templateSearch || '',
        dataset: { key: 'template-search' },
        oninput: (e) => setUi({ templateSearch: e.target.value }),
      }),
      templateList(selected)),
    h('section', { class: 'main-col card' },
      selected ? templateEditor(selected) : emptyNote('Add a template to get started.')),
  );
}

function templateList(selected) {
  const groups = filteredGroups();
  if (!groups.length) return emptyNote(store.ui.templateSearch ? 'No templates match your search.' : 'No templates yet.');
  return h('div', { class: 'template-groups' }, groups.map(({ category, templates }) => h('section', {},
    h('h4', { class: 'group-head' }, category || 'No category', h('span', { class: 'count-badge' }, templates.length)),
    h('ul', { class: 'template-list' }, templates.map((t) => {
      const uses = templateUsage(store.state, t.id).length;
      return h('li', {}, h('button', {
        class: `template-row ${t.id === selected?.id ? 'selected' : ''}`,
        onclick: () => setUi({ templateId: t.id }),
      }, h('span', { class: 'template-name' }, t.name),
      h('span', { class: 'uses', title: `Used by ${uses} lesson slide${uses === 1 ? '' : 's'}` }, uses ? `${uses}×` : 'unused')));
    })))));
}

function templateEditor(t) {
  const categories = [...new Set(store.state.templates.filter((x) => x.yearId === year().id && x.category).map((x) => x.category))].sort();
  const sample = { title: t.name, templateId: t.id, instrumentId: null };
  const fields = t.autoFields.map((key) => ({ key, label: AUTO_FIELDS[key], value: '' }));
  return h('div', { class: 'template-editor' },
    h('div', { class: 'editor-head' },
      h('label', { class: 'field grow' }, h('span', {}, 'Template name'),
        editable(t.name, (name) => commit((s) => update(s, 'templates', t.id, { name })))),
      h('label', { class: 'field' }, h('span', {}, 'Category'),
        editable(t.category, (category) => commit((s) => update(s, 'templates', t.id, { category })), { list: 'template-categories', placeholder: 'e.g. Openers', allowEmpty: true }),
        h('datalist', { id: 'template-categories' }, categories.map((c) => h('option', { value: c })))),
      h('button', { class: 'btn light', onclick: () => duplicate(t) }, 'Duplicate'),
      h('button', { class: 'btn light danger', onclick: () => deleteTemplate(t) }, 'Delete')),
    h('div', { class: 'template-body' },
      h('div', { class: 'template-preview' }, slidePreview(sample, { fields })),
      h('div', {},
        h('h3', {}, 'Filled in automatically'),
        h('p', { class: 'hint' }, 'When this template is used on the Lesson Calendar, these details are added for you.'),
        h('div', { class: 'auto-fields big' }, Object.entries(AUTO_FIELDS).map(([key, label]) => autoFieldToggle(t, key, label))))),
    usedBy(t),
  );
}

function autoFieldToggle(t, key, label) {
  return h('label', { class: 'check' },
    h('input', {
      type: 'checkbox',
      checked: t.autoFields.includes(key),
      onchange: (e) => commit((s) => update(s, 'templates', t.id, {
        autoFields: e.target.checked ? [...t.autoFields, key] : t.autoFields.filter((k) => k !== key),
      })),
    }), label);
}

function usedBy(t) {
  const uses = templateUsage(store.state, t.id);
  return h('section', { class: 'used-by' },
    h('h3', {}, `Used by ${uses.length} lesson slide${uses.length === 1 ? '' : 's'}`),
    uses.length ? null : emptyNote('Not used yet. Pick it for a slide on the Outcomes & Lessons tab.'),
    h('ul', {}, uses.map(({ slide, criterion, outcome }) => h('li', {},
      h('button', {
        class: 'link-btn',
        title: 'Open this outcome',
        onclick: () => setUi({ tab: 'outcomes', outcomeId: outcome?.id }),
      }, outcomeLabel(outcome)), ` › ${criterion?.title} › `, h('strong', {}, slide.title)))));
}

function duplicate(t) {
  const copy = commit((s) => duplicateTemplate(s, t.id));
  setUi({ templateId: copy.id, templateSearch: '' });
}

function deleteTemplate(t) {
  const uses = templateUsage(store.state, t.id).length;
  commit((s) => remove(s, 'templates', t.id));
  setUi({ templateId: null });
  toast(uses ? `Deleted “${t.name}”. ${uses} slide${uses === 1 ? ' now has' : 's now have'} no template.` : `Deleted “${t.name}”.`,
    { label: 'Undo', run: undo });
}

/** ↑ ↓ move through the template list. */
export function templateKeys(e) {
  if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return false;
  const list = visibleTemplates();
  const i = list.findIndex((t) => t.id === selectedTemplate()?.id);
  const next = list[Math.max(0, Math.min(list.length - 1, i + (e.key === 'ArrowDown' ? 1 : -1)))];
  if (next) setUi({ templateId: next.id });
  return true;
}
