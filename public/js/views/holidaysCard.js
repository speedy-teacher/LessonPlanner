// "Events" (Setup › School Year): the year's school events. The first and last day of school and the
// U.S. holidays inside the school year are added for you (schoolEvents.js) — every year, nothing to type.
// Your own events (breaks, concerts…) are added here; one with the same name as a built-in one replaces
// it (e.g. your district's own date). Pictures on the Images tab can be set to fit around any event.

import { editable, h, iconButton, toast } from '../dom.js';
import { add, remove, update } from '../model.js';
import { formatRange } from '../dates.js';
import { yearEvents } from '../schoolEvents.js';
import { commit, setUi, store, undo } from '../store.js';
import { current, year } from './common.js';

export function holidaysCard() {
  const y = year();
  const yours = current('holidays').sort((a, b) => a.startDate.localeCompare(b.startDate));
  const builtIn = yearEvents(store.state, y.id).filter((e) => e.builtIn);
  return h('section', { class: 'card setup-card holidays-card', 'data-tour': 'events-card' },
    h('h3', {}, 'Events', h('span', { class: 'count-badge' }, yours.length + builtIn.length)),
    h('p', { class: 'hint' }, 'Add your breaks and other school events. Pictures (Images tab) can be set to show around any event.'),
    h('ul', { class: 'setup-list holiday-list' }, yours.map(holidayRow)),
    holidayAdder(),
    builtInList(builtIn));
}

/** The events added for you, folded away so the card stays short. */
function builtInList(events) {
  const open = Boolean(store.ui.showBuiltInEvents);
  return h('details', { class: 'built-in-events', open, ontoggle: (e) => { if (e.target.open !== open) setUi({ showBuiltInEvents: e.target.open }); } },
    h('summary', {}, `Added for you: ${events.length} events (first & last day of school, U.S. holidays)`),
    h('p', { class: 'hint' }, 'These follow the school year’s dates. To use a different date for one, add an event with the same name above.'),
    h('ul', { class: 'built-in-list' }, events.map((e) => h('li', {},
      h('span', {}, e.name), h('span', { class: 'hint' }, formatRange(e.startDate, e.endDate))))));
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
  const name = h('input', { class: 'inline-edit', placeholder: 'New event, e.g. Winter Break…', 'aria-label': 'Event name', dataset: { key: 'add-holiday' } });
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
