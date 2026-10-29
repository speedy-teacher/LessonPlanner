// App shell: header, plan button, tabs, keyboard shortcuts.

import { h, installTooltips } from './dom.js';
import { redo, refresh, setUi, store, subscribe, undo } from './store.js';
import { google, prepareDrive, setGoogleHandlers } from './google.js';
import { clientId } from './deviceSettings.js';
import { openLastPlan, syncNow } from './workspace.js';
import { drivePill, showSignInNotice, warnIfGoogleNotSetUp } from './views/googleCard.js';
import { planButton, refreshPlansMenu, welcome } from './views/plans.js';
import { renderPlan, planKeys } from './views/plan.js';
import { renderSchedule, scheduleKeys } from './views/schedule.js';
import { renderLessonSchedule, lessonScheduleKeys, showThisWeek } from './views/lessonSchedule.js';
import { renderOutcomes } from './views/outcomes.js';
import { renderSetup } from './views/setup.js';
import { renderLessons, lessonKeys } from './views/lessons.js';
import { installCalendarScrolling, showCalendar } from './views/calendarGrid.js';
import { checkWatchedFolders, startWatchingDrive } from './views/deckImport.js';
import { menuItem, popMenu } from './views/common.js';
import { soon as checkCopies, startExportBridge } from './exportBridge.js';

// Pages with `menu: 'setup'` are reached through the "Setup ▾" menu instead of their own tab.
const TABS = [
  { id: 'plan', label: 'Outcome & Eval Calendar', icon: '📅', render: renderPlan, keys: planKeys, onShow: showCalendar },
  { id: 'schedule', label: 'Instrument Schedule', icon: '🎶', render: renderSchedule, keys: scheduleKeys, onShow: showCalendar },
  { id: 'lessonSchedule', label: 'Lesson Schedule', icon: '📖', render: renderLessonSchedule, keys: lessonScheduleKeys, onShow: showThisWeek },
  { id: 'setup', label: 'School Year', icon: '🧺', render: renderSetup, menu: 'setup' },
  { id: 'outcomes', label: 'Outcomes, Evals & Lesson Order', icon: '🌱', render: renderOutcomes, menu: 'setup' },
  { id: 'lessons', label: 'Lesson Templates', icon: '🖼️', render: renderLessons, keys: lessonKeys, menu: 'setup' },
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
  if (!store.state) return renderWelcome(main);
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
  return undefined;
}

/** No plan open yet on this computer: just the welcome (open or start a plan). */
function renderWelcome(main) {
  document.getElementById('year-picker').replaceChildren();
  document.getElementById('tabs').replaceChildren();
  document.getElementById('drive-status').replaceChildren(...[drivePill()].filter(Boolean));
  document.getElementById('save-status').textContent = '';
  main.replaceChildren(welcome());
  main.dataset.view = 'welcome';
}

function renderHeader() {
  document.getElementById('year-picker').replaceChildren(...[planButton()].filter(Boolean));
  document.getElementById('tabs').replaceChildren(
    ...TABS.filter((t) => !t.menu).map((t) => h('button', {
      class: `tab ${t.id === activeTab().id ? 'active' : ''}`,
      role: 'tab',
      onclick: () => setUi({ tab: t.id }),
    }, h('span', { class: 'tab-icon' }, t.icon), t.label)),
    setupMenu());
  document.getElementById('drive-status').replaceChildren(...[drivePill()].filter(Boolean));
  document.getElementById('undo').disabled = !store.undoStack.length;
  document.getElementById('redo').disabled = !store.redoStack.length;
}

/** "Setup ▾": School Year, Outcomes, Evals & Lesson Order, and Lesson Templates. Shows which one is open. */
function setupMenu() {
  const tab = activeTab();
  const open = tab.menu === 'setup';
  return popMenu({
    label: [h('span', { class: 'tab-icon' }, '⚙️'), 'Setup', open ? h('span', { class: 'tab-sub' }, `› ${tab.label}`) : null, ' ▾'],
    title: 'Setup pages', summaryClass: `tab ${open ? 'active' : ''}`, menuClass: 'setup-menu',
  }, TABS.filter((t) => t.menu === 'setup').map((t) => menuItem(t.label, () => setUi({ tab: t.id }), { icon: t.icon })));
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
  // Each Drive change redraws; once connected, the plan is synced and watched Drive folders are checked for new decks.
  let wasConnected = false;
  setGoogleHandlers({
    change: () => {
      const connected = google.status === 'connected';
      if (connected && !wasConnected) syncNow();
      wasConnected = connected;
      refresh();
      refreshPlansMenu();
      checkWatchedFolders();
      checkCopies();
    },
    needsSignIn: showSignInNotice,
  });
  try {
    if (!await openLastPlan()) render();
  } catch (err) {
    console.error(err);
    render();
  }
  startWatchingDrive();
  startExportBridge();
  warnIfGoogleNotSetUp();
  prepareDrive(clientId());
}

start();
