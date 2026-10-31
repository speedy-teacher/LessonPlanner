// "Setup › School Year": the year's dates and the lists everything else is built from.

import { adder, editable, h, iconButton, toast } from '../dom.js';
import { add, nextColor, remove, update } from '../model.js';
import { commit, store, undo } from '../store.js';
import { current, year } from './common.js';
import { googleCard } from './googleCard.js';
import { copiesCard } from './copiesCard.js';
import { holidaysCard } from './holidaysCard.js';
import { openNewYear } from './plans.js';

const LISTS = [
  { collection: 'schools', tour: 'list-schools', title: 'Schools', placeholder: 'New school…', note: 'Removing a school also removes its calendar entries and instrument schedule.' },
  { collection: 'grades', tour: 'list-grades', title: 'Grades', placeholder: 'New grade…', note: 'The short label shows on buttons (K, 1, 2…). The color marks the grade on buttons and on the calendar’s “All” view.' },
  { collection: 'instruments', tour: 'list-instruments', title: 'Instruments', placeholder: 'New instrument…', note: 'Pick a color for the schedule calendar.' },
];

export function renderSetup() {
  return h('div', { class: 'setup-layout' },
    yearCard(),
    LISTS.map((cfg) => listCard(cfg)),
    holidaysCard(),
    googleCard(),
    copiesCard(),
  );
}

function yearCard() {
  const y = year();
  const setDate = (field) => (e) => {
    if (e.target.value) commit((s) => update(s, 'years', y.id, { [field]: e.target.value }));
  };
  return h('section', { class: 'card setup-card year-card', 'data-tour': 'year-card' },
    h('h3', {}, 'Academic year'),
    h('div', { class: 'year-fields' },
      h('label', { class: 'field' }, h('span', {}, 'Name'),
        editable(y.name, (name) => commit((s) => update(s, 'years', y.id, { name })))),
      h('label', { class: 'field' }, h('span', {}, 'First day'),
        h('input', { type: 'date', value: y.startDate, max: y.endDate, onchange: setDate('startDate') })),
      h('label', { class: 'field' }, h('span', {}, 'Last day'),
        h('input', { type: 'date', value: y.endDate, min: y.startDate, onchange: setDate('endDate') }))),
    h('div', { class: 'button-row' },
      h('button', { class: 'btn', onclick: openNewYear }, '+ Start a new year')),
  );
}

function listCard({ collection, tour, title, placeholder, note }) {
  const items = current(collection);
  return h('section', { class: 'card setup-card', 'data-tour': tour },
    h('h3', {}, title, h('span', { class: 'count-badge' }, items.length)),
    h('p', { class: 'hint' }, note),
    h('ul', { class: 'setup-list' }, items.map((item) => h('li', {},
      extraBefore(collection, item),
      editable(item.name, (name) => commit((s) => update(s, collection, item.id, { name }))),
      extraAfter(collection, item),
      iconButton('×', `Remove ${item.name}`, () => {
        commit((s) => remove(s, collection, item.id));
        toast(`Removed ${item.name}.`, { label: 'Undo', run: undo });
      })))),
    adder(placeholder, (name) => commit((s) => add(s, collection, newRecord(collection, name))), `add-${collection}`),
  );
}

function newRecord(collection, name) {
  const base = { yearId: year().id, name };
  if (collection === 'instruments') return { ...base, color: nextColor(store.state, 'instruments', base.yearId) };
  if (collection === 'grades') return { ...base, short: name.replace(/^grade\s*/i, '').slice(0, 3), color: nextColor(store.state, 'grades', base.yearId) };
  return base;
}

function extraBefore(collection, item) {
  if (collection === 'schools') return null;
  return h('input', {
    type: 'color', class: 'color-pick', value: item.color, title: 'Change color',
    onchange: (e) => commit((s) => update(s, collection, item.id, { color: e.target.value })),
  });
}

function extraAfter(collection, item) {
  if (collection === 'grades') {
    return editable(item.short || '', (short) => commit((s) => update(s, 'grades', item.id, { short })), { class: 'inline-edit short-edit', title: 'Short label', placeholder: 'K' });
  }
  return null;
}
