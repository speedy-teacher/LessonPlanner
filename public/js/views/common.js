// Pieces shared by several screens: the current year's lists, the month
// calendar grid and the month switcher.

import { h } from '../dom.js';
import { activeYear, inYear } from '../model.js';
import { store, setUi } from '../store.js';
import { addMonths, formatMonth, monthKey, monthWeeks, monthsBetween, parseISO, shortMonth, todayISO } from '../dates.js';

export function year() {
  return activeYear(store.state);
}

/** Records of a collection in the year being viewed. */
export function current(collection) {
  const y = year();
  return y ? inYear(store.state, collection, y.id) : [];
}

/** Pick a remembered id if it still exists, otherwise the first one. */
export function pickId(list, remembered) {
  return list.some((r) => r.id === remembered) ? remembered : list[0]?.id ?? null;
}

/** The month shown on the calendars; stays put when switching school or grade. */
export function viewMonth() {
  const y = year();
  const months = monthsBetween(y.startDate, y.endDate);
  if (months.includes(store.ui.month)) return store.ui.month;
  const now = monthKey(todayISO());
  return months.includes(now) ? now : months[0];
}

export function monthNav() {
  const y = year();
  const months = monthsBetween(y.startDate, y.endDate);
  const key = viewMonth();
  const go = (k) => { if (months.includes(k)) setUi({ month: k }); };
  return h('div', { class: 'month-nav' },
    h('button', { class: 'icon-btn', title: 'Previous month (←)', onclick: () => go(addMonths(key, -1)), disabled: key === months[0] }, '‹'),
    h('h2', { class: 'month-title' }, formatMonth(key)),
    h('button', { class: 'icon-btn', title: 'Next month (→)', onclick: () => go(addMonths(key, 1)), disabled: key === months.at(-1) }, '›'),
    h('div', { class: 'month-strip' },
      months.map((k) => h('button', {
        class: `month-chip ${k === key ? 'active' : ''}`,
        title: formatMonth(k),
        onclick: () => go(k),
      }, shortMonth(k)))),
  );
}

/** Keyboard ← → change month on calendar screens. */
export function stepMonth(direction) {
  const y = year();
  const months = monthsBetween(y.startDate, y.endDate);
  const next = addMonths(viewMonth(), direction);
  if (months.includes(next)) setUi({ month: next });
}

/**
 * Mon–Fri calendar for the viewed month. `renderDay(date, info)` returns the
 * contents of each day; info = { inMonth, inYear, isToday }.
 */
export function monthGrid(renderDay, extraClass = '') {
  const y = year();
  const key = viewMonth();
  const today = todayISO();
  const head = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'].map((d) => h('div', { class: 'cal-head' }, d));
  const cells = monthWeeks(key).flat().map((date) => {
    const info = {
      inMonth: monthKey(date) === key,
      inYear: date >= y.startDate && date <= y.endDate,
      isToday: date === today,
    };
    const cls = ['cal-day', info.inMonth ? '' : 'other-month', info.inYear ? '' : 'out-of-year', info.isToday ? 'today' : ''];
    return h('div', { class: cls.join(' '), dataset: { date } },
      h('div', { class: 'day-num' }, parseISO(date).getUTCDate()),
      renderDay(date, info));
  });
  return h('div', { class: `cal-grid ${extraClass}` }, head, cells);
}

/** Row of pill buttons for picking one item. */
export function pills(items, activeId, onPick, { label = (r) => r.name, hint, colorOf } = {}) {
  return h('div', { class: 'pills', role: 'tablist' },
    items.map((item, i) => h('button', {
      class: `pill ${item.id === activeId ? 'active' : ''}`,
      role: 'tab',
      'aria-selected': item.id === activeId ? 'true' : 'false',
      title: hint ? hint(item, i) : null,
      style: colorOf ? { '--pill-color': colorOf(item) } : null,
      onclick: () => onPick(item.id),
    }, colorOf ? h('span', { class: 'dot', style: { background: colorOf(item) } }) : null, label(item))));
}

export function emptyNote(text) {
  return h('p', { class: 'empty-note' }, text);
}
