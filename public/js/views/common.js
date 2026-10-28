// Pieces shared by several screens: the current year's lists, pills and notes.
// (The calendar itself lives in calendarGrid.js.)

import { h } from '../dom.js';
import { activeYear, inYear } from '../model.js';
import { store } from '../store.js';

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
