// App shell: header, year picker, tabs, keyboard shortcuts.

import { h, installTooltips } from './dom.js';
import { commit, loadData, redo, refresh, setUi, store, subscribe, undo } from './store.js';
import { resumeDrive, setGoogleHandlers } from './google.js';
import { showSignInNotice } from './views/googleCard.js';
import { renderPlan, planKeys } from './views/plan.js';
import { renderSchedule, scheduleKeys } from './views/schedule.js';
import { renderOutcomes } from './views/outcomes.js';
import { renderSetup, openNewYear } from './views/setup.js';
import { renderLessons, lessonKeys } from './views/lessons.js';
import { installCalendarScrolling, showCalendar } from './views/calendarGrid.js';

const TABS = [
  { id: 'plan', label: 'Lesson Calendar', icon: '📅', render: renderPlan, keys: planKeys, onShow: showCalendar },
  { id: 'schedule', label: 'Instrument Schedule', icon: '🎶', render: renderSchedule, keys: scheduleKeys, onShow: showCalendar },
  { id: 'outcomes', label: 'Outcomes & Lessons', icon: '🌱', render: renderOutcomes },
  { id: 'lessons', label: 'Lesson Decks', icon: '🖼️', render: renderLessons, keys: lessonKeys },
  { id: 'setup', label: 'Setup', icon: '🧺', render: renderSetup },
];

function activeTab() {
  return TABS.find((t) => t.id === store.ui.tab) || TABS[0];
}

function restoreFocus(key) {
  if (key) document.querySelector(`[data-key="${CSS.escape(key)}"]`)?.focus();
}

function render() {
  const focusKey = document.activeElement?.dataset?.key;
  const main = document.getElementById('main');
  const tab = activeTab();
  const hasYear = store.state.years.length > 0;
  // Redrawing the same screen keeps its scroll position; a new tab or year starts fresh.
  const sameView = main.dataset.view === `${tab.id}/${store.state.activeYearId}`;
  const scroll = sameView ? main.scrollTop : 0;
  renderHeader();
  document.getElementById('tooltip').classList.remove('show');
  main.replaceChildren(hasYear ? tab.render() : h('p', { class: 'empty-note' }, 'No years yet.'));
  main.dataset.view = `${tab.id}/${store.state.activeYearId}`;
  main.scrollTop = scroll;
  if (!sameView && hasYear && tab.onShow) tab.onShow();
  restoreFocus(focusKey);
}

function renderHeader() {
  const yearSelect = h('select', {
    class: 'year-select',
    'aria-label': 'Academic year',
    onchange: (e) => commit((s) => { s.activeYearId = e.target.value; }),
  }, store.state.years.map((y) => h('option', { value: y.id, selected: y.id === store.state.activeYearId }, y.name)));
  document.getElementById('year-picker').replaceChildren(
    h('span', { class: 'mini-label' }, 'School year'), yearSelect,
    h('button', { class: 'btn small light', title: 'Start a new academic year', onclick: openNewYear }, '+ New year'));
  document.getElementById('tabs').replaceChildren(...TABS.map((t) => h('button', {
    class: `tab ${t.id === activeTab().id ? 'active' : ''}`,
    role: 'tab',
    onclick: () => setUi({ tab: t.id }),
  }, h('span', { class: 'tab-icon' }, t.icon), t.label)));
  document.getElementById('undo').disabled = !store.undoStack.length;
  document.getElementById('redo').disabled = !store.redoStack.length;
}

function isTyping(e) {
  return e.target.closest('input, textarea, select, [contenteditable]');
}

/** Ctrl+Z undo, Ctrl+Shift+Z / Ctrl+Y redo. Returns true if handled. */
function undoKeys(e) {
  const key = e.key.toLowerCase();
  if (!(e.ctrlKey || e.metaKey) || isTyping(e) || (key !== 'z' && key !== 'y')) return false;
  if (key === 'y' || e.shiftKey) redo(); else undo();
  return true;
}

function onKey(e) {
  if (undoKeys(e)) { e.preventDefault(); return; }
  const modalOpen = document.getElementById('modal').classList.contains('show');
  if (e.ctrlKey || e.metaKey || e.altKey || isTyping(e) || modalOpen) return;
  const handler = activeTab().keys;
  if (handler && handler(e)) e.preventDefault();
}

async function start() {
  installTooltips();
  installCalendarScrolling();
  document.getElementById('undo').addEventListener('click', undo);
  document.getElementById('redo').addEventListener('click', redo);
  document.addEventListener('keydown', onKey);
  subscribe(render);
  try {
    await loadData();
    setGoogleHandlers({ change: refresh, needsSignIn: showSignInNotice });
    resumeDrive(store.state.settings.googleClientId);
  } catch (err) {
    document.getElementById('main').replaceChildren(h('p', { class: 'empty-note' },
      'The planner couldn’t load. Please close this tab and double-click “Start Lesson Planner” again.'));
    console.error(err);
  }
}

start();
