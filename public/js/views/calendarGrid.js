// The whole school year as one continuous, scrolling Mon–Fri calendar,
// with a sticky header (month name, month buttons, weekdays) on top.
// Used by the Outcome & Eval Calendar and the Instrument Schedule.

import { h } from '../dom.js';
import { store } from '../store.js';
import {
  addDays, addMonths, formatMonth, monthKey, monthsBetween, mondayOf, parseISO, shortMonth, todayISO,
} from '../dates.js';
import { year } from './common.js';
import { edgeStep } from '../edgeScroll.js';

const UI_KEY = 'lesson-planner-ui';

const scroller = () => document.getElementById('main');

/** The month at the top of the calendar; remembered so the view stays put. */
export function viewMonth() {
  const y = year();
  const months = monthsBetween(y.startDate, y.endDate);
  if (months.includes(store.ui.month)) return store.ui.month;
  const now = monthKey(todayISO());
  return months.includes(now) ? now : months[0];
}

/** Sticky header: month name, ‹ ›, a button per month, and the weekday names. */
export function calendarHeader(extra = null) {
  const y = year();
  const key = viewMonth();
  return h('div', { class: 'cal-sticky' },
    h('div', { class: 'month-nav' },
      h('button', { class: 'icon-btn look', title: 'Previous month (←)', onclick: () => stepMonth(-1) }, '‹'),
      h('h2', { class: 'month-title' }, formatMonth(key)),
      h('button', { class: 'icon-btn look', title: 'Next month (→)', onclick: () => stepMonth(1) }, '›'),
      h('div', { class: 'month-strip' }, monthsBetween(y.startDate, y.endDate).map((k) => h('button', {
        class: `month-chip ${k === key ? 'active' : ''}`,
        title: formatMonth(k),
        dataset: { month: k },
        onclick: () => scrollToMonth(k, true),
      }, shortMonth(k))))),
    extra,
    h('div', { class: 'cal-weekdays' }, ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'].map((d) => h('div', { class: 'cal-head' }, d))));
}

/**
 * Every school week of the year, Monday–Friday, with a month heading where
 * each month begins. `renderDay(date, info)` fills each day; info = { inYear, isToday }.
 */
export function calendarGrid(renderDay, extraClass = '') {
  const y = year();
  const today = todayISO();
  const children = [];
  let lastMonth = null;
  for (let mon = mondayOf(y.startDate); mon <= y.endDate; mon = addDays(mon, 7)) {
    const heading = monthKey(addDays(mon, 4));
    if (heading !== lastMonth) {
      children.push(h('div', { class: 'cal-month', dataset: { month: heading } }, formatMonth(heading)));
      lastMonth = heading;
    }
    for (let i = 0; i < 5; i += 1) children.push(dayCell(addDays(mon, i), y, today, renderDay));
  }
  return h('div', { class: `cal-grid ${extraClass}` }, children);
}

function dayCell(date, y, today, renderDay) {
  const info = { inYear: date >= y.startDate && date <= y.endDate, isToday: date === today };
  const month = Number(date.slice(5, 7));
  const cls = ['cal-day', month % 2 ? 'month-odd' : 'month-even', info.inYear ? '' : 'out-of-year', info.isToday ? 'today' : ''];
  const day = parseISO(date).getUTCDate();
  return h('div', { class: cls.join(' '), dataset: { date } },
    h('div', { class: 'day-num' }, day === 1 ? `${shortMonth(monthKey(date))} 1` : day),
    renderDay(date, info));
}

// ---------- scrolling ----------

function stickyBottom() {
  return document.querySelector('.cal-sticky')?.getBoundingClientRect().bottom ?? scroller().getBoundingClientRect().top;
}

/** Scroll so a month's heading sits just under the sticky header. */
export function scrollToMonth(key, smooth = false) {
  const heading = document.querySelector(`.cal-month[data-month="${key}"]`);
  if (!heading) return;
  const top = scroller().scrollTop + heading.getBoundingClientRect().top - stickyBottom() - 4;
  scroller().scrollTo({ top, behavior: smooth ? 'smooth' : 'auto' });
  rememberMonth(key);
}

/** ← → jump a month back or forward. */
export function stepMonth(direction) {
  const y = year();
  const months = monthsBetween(y.startDate, y.endDate);
  const next = addMonths(viewMonth(), direction);
  if (months.includes(next)) scrollToMonth(next, true);
}

/** Called when a calendar tab is opened: go back to the remembered month. */
export function showCalendar() {
  scrollToMonth(viewMonth());
}

// Remember the month without redrawing the page (it's only a scroll position).
function rememberMonth(key) {
  if (store.ui.month === key) return;
  store.ui.month = key;
  try { localStorage.setItem(UI_KEY, JSON.stringify(store.ui)); } catch { /* storage unavailable */ }
  document.querySelector('.month-title')?.replaceChildren(formatMonth(key));
  document.querySelectorAll('.month-chip').forEach((c) => c.classList.toggle('active', c.dataset.month === key));
}

function trackVisibleMonth() {
  const line = stickyBottom() + 40;
  let visible = null;
  for (const heading of document.querySelectorAll('.cal-month')) {
    if (heading.getBoundingClientRect().top > line) break;
    visible = heading.dataset.month;
  }
  if (visible) rememberMonth(visible);
}

// Edge scrolling runs every animation frame while the pointer keeps being reported (drag/resize events),
// and stops a moment after the last report (dropped, or the pointer left the window).
const STOP_AFTER_MS = 200;
const edge = { y: 0, seenAt: 0, frame: 0, last: 0, carry: 0 };

function edgeFrame(now) {
  if (now - edge.seenAt > STOP_AFTER_MS) { edge.frame = 0; return; }
  const box = scroller().getBoundingClientRect();
  const ms = Math.min(50, now - edge.last);
  edge.last = now;
  edge.carry += edgeStep(edge.y, Math.max(box.top, stickyBottom()), box.bottom, ms);
  const whole = Math.trunc(edge.carry);
  if (whole) { scroller().scrollTop += whole; edge.carry -= whole; }
  edge.frame = requestAnimationFrame(edgeFrame);
}

/** Scroll the page while the pointer is held near its top or bottom edge (call on every drag/move event). */
export function edgeScroll(clientY) {
  edge.y = clientY;
  edge.seenAt = performance.now();
  if (edge.frame) return;
  edge.last = edge.seenAt;
  edge.carry = 0;
  edge.frame = requestAnimationFrame(edgeFrame);
}

function stopEdgeScroll() {
  edge.seenAt = 0;
}

export function installCalendarScrolling() {
  scroller().addEventListener('scroll', () => {
    if (document.querySelector('.cal-month')) trackVisibleMonth();
  }, { passive: true });
  // Dragging an outcome/instrument/bar (or a lesson on the Lesson Schedule) near the top or bottom —
  // or up over the tabs — scrolls into other months/weeks.
  document.addEventListener('dragover', (e) => {
    if (document.querySelector('#main .cal-grid, #main .ls-weeks')) edgeScroll(e.clientY);
  });
  document.addEventListener('drop', stopEdgeScroll);
  document.addEventListener('dragend', stopEdgeScroll);
}
