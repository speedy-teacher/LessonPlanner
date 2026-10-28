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

/**
 * A button that opens a small menu (closes when you pick something or click elsewhere).
 * The menu floats above everything so a scrolling side panel can't cut it off.
 */
export function popMenu({ label, title, summaryClass = 'icon-btn', menuClass = '' }, ...items) {
  const card = h('div', { class: 'menu-card' }, ...items);
  const details = h('details', { class: `pop-menu ${menuClass}`, ontoggle: () => placeMenu(details, card) },
    h('summary', { class: summaryClass, title, 'aria-label': title }, label), card);
  return details;
}

function placeMenu(details, card) {
  if (!details.open) return;
  const r = details.querySelector('summary').getBoundingClientRect();
  card.style.left = `${Math.max(8, Math.min(r.left, window.innerWidth - card.offsetWidth - 8))}px`;
  const below = r.bottom + 6 + card.offsetHeight < window.innerHeight;
  card.style.top = `${below ? r.bottom + 6 : Math.max(8, r.top - card.offsetHeight - 6)}px`;
}

/** One choice in a popMenu. */
export function menuItem(label, run, { icon = null, tip = null } = {}) {
  return h('button', {
    class: 'menu-item', title: tip,
    onclick: (e) => { e.target.closest('details').open = false; run(); },
  }, icon ? h('span', { class: 'menu-icon', 'aria-hidden': 'true' }, icon) : null, label);
}

// Clicking anywhere else closes an open menu.
document.addEventListener('click', (e) => {
  document.querySelectorAll('details.pop-menu[open]').forEach((d) => { if (!d.contains(e.target)) d.open = false; });
});

export function emptyNote(text) {
  return h('p', { class: 'empty-note' }, text);
}
