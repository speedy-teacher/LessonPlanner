// "Setup › School Year": the year's dates and the lists everything else is built from.

import { adder, editable, h, iconButton, openModal, toast } from '../dom.js';
import { add, createYear, nextColor, remove, suggestNextYear, update } from '../model.js';
import { commit, store, undo } from '../store.js';
import { current, year } from './common.js';
import { googleCard } from './googleCard.js';

const LISTS = [
  { collection: 'schools', title: 'Schools', placeholder: 'New school…', note: 'Removing a school also removes its calendar entries and instrument schedule.' },
  { collection: 'grades', title: 'Grades', placeholder: 'New grade…', note: 'The short label shows on buttons (K, 1, 2…).' },
  { collection: 'instruments', title: 'Instruments', placeholder: 'New instrument…', note: 'Pick a color for the schedule calendar.' },
];

export function renderSetup() {
  return h('div', { class: 'setup-layout' },
    yearCard(),
    LISTS.map((cfg) => listCard(cfg)),
    googleCard(),
  );
}

function yearCard() {
  const y = year();
  const setDate = (field) => (e) => {
    if (e.target.value) commit((s) => update(s, 'years', y.id, { [field]: e.target.value }));
  };
  return h('section', { class: 'card setup-card year-card' },
    h('h3', {}, 'Academic year'),
    h('div', { class: 'year-fields' },
      h('label', { class: 'field' }, h('span', {}, 'Name'),
        editable(y.name, (name) => commit((s) => update(s, 'years', y.id, { name })))),
      h('label', { class: 'field' }, h('span', {}, 'First day'),
        h('input', { type: 'date', value: y.startDate, max: y.endDate, onchange: setDate('startDate') })),
      h('label', { class: 'field' }, h('span', {}, 'Last day'),
        h('input', { type: 'date', value: y.endDate, min: y.startDate, onchange: setDate('endDate') }))),
    h('div', { class: 'button-row' },
      h('button', { class: 'btn', onclick: openNewYear }, '+ Start a new year'),
      store.state.years.length > 1
        ? h('button', { class: 'btn light danger', onclick: () => confirmDeleteYear(y) }, 'Delete this year')
        : null),
  );
}

function listCard({ collection, title, placeholder, note }) {
  const items = current(collection);
  return h('section', { class: 'card setup-card' },
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
  if (collection === 'grades') return { ...base, short: name.replace(/^grade\s*/i, '').slice(0, 3) };
  return base;
}

function extraBefore(collection, item) {
  if (collection !== 'instruments') return null;
  return h('input', {
    type: 'color', class: 'color-pick', value: item.color, title: 'Change color',
    onchange: (e) => commit((s) => update(s, 'instruments', item.id, { color: e.target.value })),
  });
}

function extraAfter(collection, item) {
  if (collection === 'grades') {
    return editable(item.short || '', (short) => commit((s) => update(s, 'grades', item.id, { short })), { class: 'inline-edit short-edit', title: 'Short label', placeholder: 'K' });
  }
  return null;
}

// ---------- new year / delete year ----------

export function openNewYear() {
  const from = year();
  const next = from ? suggestNextYear(from) : { name: '', startDate: '', endDate: '' };
  openModal('Start a new academic year', (close) => {
    const name = h('input', { value: next.name });
    const start = h('input', { type: 'date', value: next.startDate });
    const end = h('input', { type: 'date', value: next.endDate });
    const copy = h('input', { type: 'checkbox', checked: Boolean(from) });
    const create = () => {
      if (!name.value.trim() || !start.value || !end.value || end.value < start.value) {
        toast('Please give the year a name, and a last day after the first day.');
        return;
      }
      commit((s) => createYear(s, { name: name.value.trim(), startDate: start.value, endDate: end.value }, copy.checked ? from.id : null));
      close();
      toast(`Welcome to ${name.value.trim()}! You can switch back to past years at the top.`);
    };
    return h('div', { class: 'modal-body' },
      h('label', { class: 'field' }, h('span', {}, 'Name'), name),
      h('div', { class: 'two-col' },
        h('label', { class: 'field' }, h('span', {}, 'First day'), start),
        h('label', { class: 'field' }, h('span', {}, 'Last day'), end)),
      from ? h('label', { class: 'check big' }, copy,
        `Copy schools, grades, instruments, lesson decks and essential outcomes (with eval criteria and lesson order) from ${from.name}`) : null,
      h('p', { class: 'hint' }, 'Calendars start empty. Past years stay just as they are.'),
      h('div', { class: 'button-row end' },
        h('button', { class: 'btn light', onclick: close }, 'Cancel'),
        h('button', { class: 'btn', onclick: create }, 'Create year')));
  });
}

function confirmDeleteYear(y) {
  openModal(`Delete ${y.name}?`, (close) => h('div', { class: 'modal-body' },
    h('p', {}, 'This removes everything in this year: its lists, outcomes, lessons and calendars. Other years are not affected.'),
    h('div', { class: 'button-row end' },
      h('button', { class: 'btn light', onclick: close }, 'Keep it'),
      h('button', { class: 'btn danger', onclick: () => {
        commit((s) => remove(s, 'years', y.id));
        close();
        toast(`Deleted ${y.name}.`, { label: 'Undo', run: undo });
      } }, 'Delete year'))));
}
