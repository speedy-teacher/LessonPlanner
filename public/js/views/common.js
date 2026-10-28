// Pieces shared by several screens: the current year's lists, pills and notes.
// (The calendar itself lives in calendarGrid.js.)

import { h } from '../dom.js';
import { activeYear, inYear } from '../model.js';
import { setUi, store } from '../store.js';

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

// ---------- a small menu where you clicked ----------

let openContext = null;

/** A small menu at the mouse (e.g. after clicking an instrument): items = [{ label, icon, run }]. */
export function contextMenu(e, items) {
  e.stopPropagation();
  closeContextMenu();
  openContext = h('div', { class: 'menu-card context-menu', role: 'menu' }, items.map((item) => h('button', {
    class: 'menu-item', role: 'menuitem',
    onclick: () => { closeContextMenu(); item.run(); },
  }, item.icon ? h('span', { class: 'menu-icon', 'aria-hidden': 'true' }, item.icon) : null, item.label)));
  document.body.append(openContext);
  const left = Math.min(e.clientX, window.innerWidth - openContext.offsetWidth - 8);
  const top = e.clientY + 4 + openContext.offsetHeight < window.innerHeight ? e.clientY + 4 : e.clientY - openContext.offsetHeight - 4;
  openContext.style.left = `${Math.max(8, left)}px`;
  openContext.style.top = `${Math.max(8, top)}px`;
}

export function closeContextMenu() {
  openContext?.remove();
  openContext = null;
}

document.addEventListener('pointerdown', (e) => { if (openContext && !openContext.contains(e.target)) closeContextMenu(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeContextMenu(); });
window.addEventListener('scroll', closeContextMenu, true);

/** The menu for an instrument (a bar or tag you clicked). */
export function instrumentMenu(e, instrument, extra = []) {
  if (!instrument) return;
  contextMenu(e, [
    { icon: '📖', label: `Lessons that use ${instrument.name}`, run: () => showInstrumentLessons(instrument.id) },
    ...extra,
  ]);
}

/** Lesson Templates, showing only the lessons that use this instrument. */
export function showInstrumentLessons(instrumentId) {
  setUi({ tab: 'lessons', lessonInstrumentId: instrumentId, lessonSearch: '', lessonId: null });
}

/** A little colored instrument tag; click it for its menu. */
export function instrumentTag(instrument, { label = instrument?.name, tip = null, part = false } = {}) {
  return h('button', {
    type: 'button', class: `ins-tag ${part ? 'part' : ''}`, style: { '--ins': instrument?.color },
    'data-tip': tip ? `${tip} — click for lessons that use it` : `Click for lessons that use ${instrument?.name}`,
    onclick: (e) => instrumentMenu(e, instrument),
  }, label);
}

export function emptyNote(text) {
  return h('p', { class: 'empty-note' }, text);
}
