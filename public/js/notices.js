// Notifications that stack in the bottom-left corner. Reusable for anything
// the planner needs to tell you: each has a message, an optional title and
// buttons, and goes away by itself after a while (hovering keeps it open).
//
//   showNotice({ id: 'drive-signin', tone: 'warn', title: 'Google Drive',
//                message: 'Please sign in again.', actions: [{ label: 'Sign in', run }] });
//
// Showing a notice with the same id replaces the old one instead of stacking.

import { h } from './dom.js';

export const TONES = { info: 'ℹ️', success: '✅', warn: '⚠️', error: '❗' };
const DEFAULT_SECONDS = 10;
const live = new Map(); // id -> { el, timer }

function area() {
  let el = document.getElementById('notices');
  if (!el) {
    el = h('div', { id: 'notices', class: 'notices', role: 'status', 'aria-live': 'polite' });
    document.body.append(el);
  }
  return el;
}

/**
 * Show a notification. Returns its id.
 * seconds: how long it stays (null = until closed). Buttons close it after running.
 */
export function showNotice({ id = `notice-${Date.now()}`, tone = 'info', title = '', message, actions = [], seconds = DEFAULT_SECONDS }) {
  dismissNotice(id, { instant: true });
  const close = () => dismissNotice(id);
  const el = h('div', { class: `notice ${tone}`, dataset: { noticeId: id } },
    h('span', { class: 'notice-icon', 'aria-hidden': 'true' }, TONES[tone] || TONES.info),
    h('div', { class: 'notice-body' },
      title ? h('strong', { class: 'notice-title' }, title) : null,
      h('span', {}, message),
      actions.length ? h('div', { class: 'notice-actions' }, actions.map((a) => h('button', {
        class: 'btn small', onclick: () => { close(); a.run(); },
      }, a.label))) : null),
    h('button', { class: 'icon-btn notice-close', title: 'Close', 'aria-label': 'Close', onclick: close }, '×'));
  const entry = { el, timer: null };
  const startTimer = () => { if (seconds) entry.timer = setTimeout(close, seconds * 1000); };
  el.addEventListener('mouseenter', () => clearTimeout(entry.timer));
  el.addEventListener('mouseleave', startTimer);
  live.set(id, entry);
  area().append(el);
  requestAnimationFrame(() => el.classList.add('show'));
  startTimer();
  return id;
}

export function dismissNotice(id, { instant = false } = {}) {
  const entry = live.get(id);
  if (!entry) return;
  live.delete(id);
  clearTimeout(entry.timer);
  if (instant) { entry.el.remove(); return; }
  entry.el.classList.remove('show');
  setTimeout(() => entry.el.remove(), 250);
}

export function isNoticeShown(id) {
  return live.has(id);
}
