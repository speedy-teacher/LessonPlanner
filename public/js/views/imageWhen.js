// "When to use it" on the Images tab: the picture's timing windows (dates every year, or days around a
// holiday on the year's holiday list), how special a fit is, whether it may be used any time, and the
// school weeks it fits — so the rules can be checked before any lesson copy is made (see imagePick.js).

import { h } from '../dom.js';
import { editImage } from '../library.js';
import { PRIORITIES, weekRanges, weeksImageFits } from '../imagePick.js';
import { formatRange } from '../dates.js';
import { commit, setUi, store } from '../store.js';
import { current } from './common.js';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const pad = (n) => String(n).padStart(2, '0');

/** Change the picture's `when` with `fn(when)`. */
const changeWhen = (image, fn) => commit((s) => editImage(s, image.id, (i) => fn(i.when)));
const changeWindow = (image, index, patch) => changeWhen(image, (w) => { w.windows[index] = { ...w.windows[index], ...patch }; });

export function whenEditor(image) {
  const { when } = image;
  return h('section', { class: 'image-section when-editor' },
    h('h3', {}, 'When to use it'),
    h('label', { class: 'check' },
      h('input', { type: 'checkbox', checked: when.anytime, onchange: (e) => changeWhen(image, (w) => { w.anytime = e.target.checked; }) }),
      'OK any time (used when nothing more special fits)'),
    h('label', { class: 'field' }, h('span', {}, 'When a time below fits, it counts as'),
      h('select', {
        class: 'inline-edit', onchange: (e) => changeWhen(image, (w) => { w.priority = Number(e.target.value); }),
      }, PRIORITIES.map((p) => h('option', { value: p.value, selected: when.priority === p.value }, `${p.label} — ${p.hint}`)))),
    h('ul', { class: 'when-windows' }, when.windows.map((win, i) => h('li', {},
      win.type === 'holiday' ? holidayWindow(image, win, i) : dateWindow(image, win, i),
      h('button', { class: 'icon-btn', title: 'Remove this time', 'aria-label': 'Remove this time', onclick: () => changeWhen(image, (w) => { w.windows.splice(i, 1); }) }, '×')))),
    h('div', { class: 'button-row' },
      h('button', { class: 'btn small light', onclick: () => changeWhen(image, (w) => { w.windows.push({ type: 'date', from: '12-01', to: '12-13', startByEnd: false }); }) }, '+ Dates every year'),
      h('button', { class: 'btn small light', onclick: () => addHolidayWindow(image) }, '+ Around a holiday')),
    fitsNote(image));
}

function addHolidayWindow(image) {
  const [first] = current('holidays');
  changeWhen(image, (w) => { w.windows.push({ type: 'holiday', holiday: first?.name ?? '', anchor: 'start', daysBefore: 7, daysAfter: 0 }); });
}

// ---------- every year from … to … ----------

function monthDay(value, onChange, label) {
  const [m, d] = (value || '01-01').split('-').map(Number);
  const set = (month, day) => onChange(`${pad(month)}-${pad(day)}`);
  return h('span', { class: 'month-day' },
    h('select', { 'aria-label': `${label} month`, onchange: (e) => set(Number(e.target.value), d) },
      MONTHS.map((name, i) => h('option', { value: i + 1, selected: i + 1 === m }, name))),
    h('select', { 'aria-label': `${label} day`, onchange: (e) => set(m, Number(e.target.value)) },
      Array.from({ length: 31 }, (_, i) => h('option', { value: i + 1, selected: i + 1 === d }, i + 1))));
}

function dateWindow(image, win, i) {
  return h('div', { class: 'when-window' },
    h('span', {}, 'Every year from'), monthDay(win.from, (from) => changeWindow(image, i, { from }), 'From'),
    h('span', {}, 'to'), monthDay(win.to, (to) => changeWindow(image, i, { to }), 'To'),
    h('label', { class: 'check small', 'data-tip': 'For greetings like “Happy December”: a lesson shown Nov 30 – Dec 4 gets it, one shown Dec 14 – 18 doesn’t.' },
      h('input', { type: 'checkbox', checked: Boolean(win.startByEnd), onchange: (e) => changeWindow(image, i, { startByEnd: e.target.checked }) }),
      'the lesson must start by then'));
}

// ---------- around a holiday ----------

function dayCount(value, onChange, label) {
  return h('input', {
    type: 'number', min: 0, max: 60, value: value ?? 0, class: 'day-count', 'aria-label': label,
    onchange: (e) => onChange(Math.max(0, Number(e.target.value) || 0)),
  });
}

function holidayWindow(image, win, i) {
  const holidays = current('holidays');
  const known = holidays.some((hol) => hol.name.toLowerCase() === (win.holiday || '').toLowerCase());
  return h('div', { class: 'when-window' },
    h('span', {}, 'From'), dayCount(win.daysBefore, (daysBefore) => changeWindow(image, i, { daysBefore }), 'Days before'),
    h('span', {}, 'days before to'), dayCount(win.daysAfter, (daysAfter) => changeWindow(image, i, { daysAfter }), 'Days after'),
    h('span', {}, 'days after the'),
    h('select', { 'aria-label': 'Which day of the holiday', onchange: (e) => changeWindow(image, i, { anchor: e.target.value }) },
      h('option', { value: 'start', selected: win.anchor !== 'end' }, 'first day'),
      h('option', { value: 'end', selected: win.anchor === 'end' }, 'last day')),
    h('span', {}, 'of'),
    h('select', { 'aria-label': 'Holiday', onchange: (e) => changeWindow(image, i, { holiday: e.target.value }) },
      known || !win.holiday ? null : h('option', { value: win.holiday, selected: true }, `${win.holiday} (not on the holiday list)`),
      holidays.map((hol) => h('option', { value: hol.name, selected: hol.name.toLowerCase() === (win.holiday || '').toLowerCase() }, hol.name)),
      holidays.length ? null : h('option', { value: '' }, 'No holidays yet')),
    holidays.length ? null : h('button', { class: 'link-btn', onclick: () => setUi({ tab: 'setup' }) }, 'Add holidays under Setup › School Year'));
}

// ---------- which weeks ----------

function fitsNote(image) {
  const weeks = weeksImageFits(store.state, image);
  const anytime = image.when.anytime ? ' Any other week, it can be used when nothing more special fits.' : '';
  if (!weeks.length) {
    return h('p', { class: 'hint fits-note' }, image.when.anytime ? 'Used any week when nothing more special fits.' : 'Not used in any week yet — add a time above or tick “OK any time”.');
  }
  const first = weeks[0];
  const last = weeks.at(-1);
  const together = last.number - first.number === weeks.length - 1;
  const dates = together ? ` (${formatRange(first.days[0], last.days.at(-1))})` : '';
  return h('p', { class: 'fits-note' }, '📅 Fits ', h('strong', {}, weekRanges(weeks.map((w) => w.number))), `${dates}.${anytime}`);
}
