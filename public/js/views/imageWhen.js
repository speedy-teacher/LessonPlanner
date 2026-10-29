// "When to use it" on the Images tab, kept calm: first the weeks the picture fits, then each time it fits
// as one plain sentence ("Dec 1 – Dec 13, every year" · "30 days before Halloween"), with its settings
// tucked away behind ✎. Underneath: how special a fit is, and whether it may fill in any other week.
// The rules themselves are imagePick.js; the year's events are schoolEvents.js.

import { h } from '../dom.js';
import { editImage } from '../library.js';
import { PRIORITIES, weekRanges, weeksImageFits, windowSentence } from '../imagePick.js';
import { yearEvents } from '../schoolEvents.js';
import { formatRange } from '../dates.js';
import { commit, setUi, store } from '../store.js';
import { menuItem, popMenu, year } from './common.js';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const pad = (n) => String(n).padStart(2, '0');

/** Change the picture's `when` with `fn(when)`. */
const changeWhen = (image, fn) => commit((s) => editImage(s, image.id, (i) => fn(i.when)));
const changeWindow = (image, index, patch) => changeWhen(image, (w) => { w.windows[index] = { ...w.windows[index], ...patch }; });
const editingKey = (image, i) => `${image.id}:${i}`;

export function whenEditor(image) {
  const { when } = image;
  return h('section', { class: 'image-section when-editor' },
    h('div', { class: 'section-head' }, h('h3', {}, 'When to use it'), addTimeMenu(image)),
    fitsNote(image),
    when.windows.length ? h('ul', { class: 'when-windows' }, when.windows.map((win, i) => windowItem(image, win, i))) : null,
    h('div', { class: 'when-options' },
      priorityPills(image),
      h('label', { class: 'check', 'data-tip': 'When no picture has a time that fits a week, pictures with this ticked are used.' },
        h('input', { type: 'checkbox', checked: when.anytime, onchange: (e) => changeWhen(image, (w) => { w.anytime = e.target.checked; }) }),
        'Also use it in any other week')));
}

function addTimeMenu(image) {
  const add = (win) => {
    const index = image.when.windows.length;
    changeWhen(image, (w) => { w.windows.push(win); });
    setUi({ editingWindow: editingKey(image, index) });
  };
  const [firstEvent] = yearEvents(store.state, year().id);
  return popMenu({ label: '＋', title: 'Add a time it fits', summaryClass: 'icon-btn add-icon', menuClass: 'add-menu' },
    menuItem('Dates every year', () => add({ type: 'date', from: '12-01', to: '12-13', startByEnd: false }), { icon: '🗓️', tip: 'e.g. Dec 1 – Dec 13' }),
    menuItem('Around an event', () => add({ type: 'holiday', holiday: firstEvent?.name ?? '', anchor: 'start', daysBefore: 7, daysAfter: 0 }), { icon: '⭐', tip: 'e.g. the week before Halloween' }));
}

// ---------- each time, as a sentence ----------

function windowItem(image, win, i) {
  const editing = store.ui.editingWindow === editingKey(image, i);
  return h('li', { class: `when-window-item ${editing ? 'editing' : ''}` },
    h('div', { class: 'when-sentence' },
      h('span', { 'aria-hidden': 'true' }, win.type === 'holiday' ? '⭐' : '🗓️'),
      h('span', { class: 'grow' }, windowSentence(win)),
      h('button', { class: 'icon-btn', title: editing ? 'Done' : 'Change', 'aria-label': editing ? 'Done' : 'Change', onclick: () => setUi({ editingWindow: editing ? null : editingKey(image, i) }) }, editing ? '✓' : '✎'),
      h('button', { class: 'icon-btn', title: 'Remove', 'aria-label': 'Remove this time', onclick: () => { setUi({ editingWindow: null }); changeWhen(image, (w) => { w.windows.splice(i, 1); }); } }, '×')),
    editing ? (win.type === 'holiday' ? holidayForm(image, win, i) : dateForm(image, win, i)) : null);
}

// ---------- settings for one time ----------

function monthDay(value, onChange, label) {
  const [m, d] = (value || '01-01').split('-').map(Number);
  const set = (month, day) => onChange(`${pad(month)}-${pad(day)}`);
  return h('span', { class: 'month-day' },
    h('select', { 'aria-label': `${label} month`, onchange: (e) => set(Number(e.target.value), d) },
      MONTHS.map((name, i) => h('option', { value: i + 1, selected: i + 1 === m }, name))),
    h('select', { 'aria-label': `${label} day`, onchange: (e) => set(m, Number(e.target.value)) },
      Array.from({ length: 31 }, (_, i) => h('option', { value: i + 1, selected: i + 1 === d }, i + 1))));
}

function dateForm(image, win, i) {
  return h('div', { class: 'when-form' },
    h('div', { class: 'when-row' }, h('span', {}, 'From'), monthDay(win.from, (from) => changeWindow(image, i, { from }), 'From'),
      h('span', {}, 'to'), monthDay(win.to, (to) => changeWindow(image, i, { to }), 'To')),
    h('label', { class: 'check small', 'data-tip': 'For greetings like “Happy December”: a lesson shown Nov 30 – Dec 4 gets it, one shown Dec 14 – 18 doesn’t.' },
      h('input', { type: 'checkbox', checked: Boolean(win.startByEnd), onchange: (e) => changeWindow(image, i, { startByEnd: e.target.checked }) }),
      'Only if the lesson starts by the last day'));
}

function dayCount(value, onChange, label) {
  return h('input', {
    type: 'number', min: 0, max: 60, value: value ?? 0, class: 'day-count', 'aria-label': label,
    onchange: (e) => onChange(Math.max(0, Number(e.target.value) || 0)),
  });
}

function holidayForm(image, win, i) {
  const events = yearEvents(store.state, year().id);
  const known = events.some((ev) => ev.name.toLowerCase() === (win.holiday || '').toLowerCase());
  return h('div', { class: 'when-form' },
    h('div', { class: 'when-row' }, h('span', {}, 'Event'),
      h('select', { 'aria-label': 'Event', onchange: (e) => changeWindow(image, i, { holiday: e.target.value }) },
        known || !win.holiday ? null : h('option', { value: win.holiday, selected: true }, `${win.holiday} (not this year)`),
        events.map((ev) => h('option', { value: ev.name, selected: ev.name.toLowerCase() === (win.holiday || '').toLowerCase() }, ev.name)))),
    h('div', { class: 'when-row' },
      dayCount(win.daysBefore, (daysBefore) => changeWindow(image, i, { daysBefore }), 'Days before'), h('span', {}, 'days before, and'),
      dayCount(win.daysAfter, (daysAfter) => changeWindow(image, i, { daysAfter }), 'Days after'), h('span', {}, 'days after')),
    h('div', { class: 'when-row' }, h('span', {}, 'Counted from its'),
      h('select', { 'aria-label': 'Counted from', onchange: (e) => changeWindow(image, i, { anchor: e.target.value }) },
        h('option', { value: 'start', selected: win.anchor !== 'end' }, 'first day'),
        h('option', { value: 'end', selected: win.anchor === 'end' }, 'last day'))),
    h('button', { class: 'link-btn small', onclick: () => setUi({ tab: 'setup' }) }, 'Add or change events under Setup › School Year'));
}

// ---------- how special, and which weeks ----------

function priorityPills(image) {
  return h('div', { class: 'priority-pills', role: 'radiogroup', 'aria-label': 'When it fits, it counts as' },
    h('span', { class: 'hint' }, 'When it fits, it’s a'),
    PRIORITIES.map((p) => h('button', {
      class: `pill small ${image.when.priority === p.value ? 'active' : ''}`, role: 'radio',
      'aria-checked': image.when.priority === p.value ? 'true' : 'false', 'data-tip': `${p.hint}. Greetings beat holidays, holidays beat seasons.`,
      onclick: () => changeWhen(image, (w) => { w.priority = p.value; }),
    }, p.label)));
}

function fitsNote(image) {
  const weeks = weeksImageFits(store.state, image);
  if (!weeks.length) {
    return h('p', { class: 'fits-note quiet' }, image.when.anytime ? 'Used in any week where no other picture fits better.' : 'Not used yet — add a time with ＋.');
  }
  const first = weeks[0];
  const last = weeks.at(-1);
  const together = last.number - first.number === weeks.length - 1;
  return h('p', { class: 'fits-note' }, '📅 ', h('strong', {}, weekRanges(weeks.map((w) => w.number))),
    together ? ` · ${formatRange(first.days[0], last.days.at(-1))}` : '');
}
