// "Holidays & breaks" (Setup › School Year): one list for all schools. Pictures on the Images tab can be
// set to fit the days around one (e.g. a week before Winter Break), wherever it falls this year.

import { editable, h, iconButton, toast } from '../dom.js';
import { add, remove, update } from '../model.js';
import { commit, undo } from '../store.js';
import { current, year } from './common.js';

export function holidaysCard() {
  const holidays = current('holidays').sort((a, b) => a.startDate.localeCompare(b.startDate));
  return h('section', { class: 'card setup-card holidays-card' },
    h('h3', {}, 'Holidays & breaks', h('span', { class: 'count-badge' }, holidays.length)),
    h('p', { class: 'hint' }, 'One list for all your schools. Pictures (Images tab) can be set to show around these — e.g. the three weeks before Winter Break.'),
    h('ul', { class: 'setup-list holiday-list' }, holidays.map(holidayRow)),
    holidayAdder());
}

function dateInput(value, onChange, label, limits = {}) {
  return h('input', { type: 'date', value, 'aria-label': label, ...limits, onchange: (e) => { if (e.target.value) onChange(e.target.value); } });
}

function holidayRow(hol) {
  const set = (patch) => commit((s) => update(s, 'holidays', hol.id, patch));
  return h('li', {},
    editable(hol.name, (name) => set({ name })),
    dateInput(hol.startDate, (startDate) => set({ startDate, endDate: startDate > hol.endDate ? startDate : hol.endDate }), `${hol.name} first day`),
    h('span', { class: 'hint' }, 'to'),
    dateInput(hol.endDate, (endDate) => set({ endDate }), `${hol.name} last day`, { min: hol.startDate }),
    iconButton('×', `Remove ${hol.name}`, () => {
      commit((s) => remove(s, 'holidays', hol.id));
      toast(`Removed ${hol.name}.`, { label: 'Undo', run: undo });
    }));
}

function holidayAdder() {
  const y = year();
  const name = h('input', { class: 'inline-edit', placeholder: 'New holiday or break…', 'aria-label': 'Holiday name', dataset: { key: 'add-holiday' } });
  const start = h('input', { type: 'date', value: y.startDate, 'aria-label': 'First day' });
  const end = h('input', { type: 'date', value: y.startDate, 'aria-label': 'Last day' });
  start.addEventListener('change', () => { if (end.value < start.value) end.value = start.value; });
  const save = () => {
    const text = name.value.trim();
    if (!text || !start.value) return;
    const [startDate, endDate] = [start.value, end.value || start.value].sort();
    commit((s) => add(s, 'holidays', { yearId: y.id, name: text, startDate, endDate }));
  };
  name.addEventListener('keydown', (e) => { if (e.key === 'Enter') save(); });
  return h('div', { class: 'adder holiday-adder' }, name, start, h('span', { class: 'hint' }, 'to'), end,
    h('button', { class: 'btn small', onclick: save }, '+ Add'));
}
