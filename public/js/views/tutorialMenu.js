// The 🎓 button at the top right: a menu of every tutorial, in order. A dot on the button means
// there's something new to see (the menu was never opened, or a tutorial was added since).
// What's been seen and finished is remembered in this browser only (tutorialPlan.js PROGRESS_KEY).

import { h } from '../dom.js';
import { hasNews, isNew, markDone, markSeen, PROGRESS_KEY, readProgress } from '../tutorialPlan.js';
import { TUTORIALS } from '../tutorials.js';
import { setUpTutorials, startTutorial } from './tutorialGuide.js';
import { menuItem, popMenu } from './common.js';

let progress = loadProgress();

function loadProgress() {
  try { return readProgress(localStorage.getItem(PROGRESS_KEY)); } catch { return readProgress(null); }
}

function saveProgress(next) {
  progress = next;
  try { localStorage.setItem(PROGRESS_KEY, JSON.stringify(progress)); } catch { /* storage unavailable */ }
  drawButton();
}

/** Put the 🎓 button in the top bar and get the tutorials ready. */
export function startTutorials() {
  setUpTutorials({ tutorials: TUTORIALS, onFinish: (id) => saveProgress(markDone(progress, id)) });
  drawButton();
}

function drawButton() {
  const holder = document.getElementById('tutorials');
  if (!holder) return;
  // "New" marks stay while the menu is open; the next drawing (after it closes) drops them.
  const fresh = new Set(TUTORIALS.filter((t) => isNew(progress, t.id)).map((t) => t.id));
  const menu = popMenu({
    label: [h('span', { 'aria-hidden': 'true' }, '🎓'), hasNews(progress, TUTORIALS) ? h('span', { class: 'news-dot', 'aria-label': 'New tutorials' }) : null],
    title: 'Tutorials: step-by-step guides',
    summaryClass: 'icon-btn tutorial-cap',
    menuClass: 'tutorial-menu',
    tour: 'tutorials',
  },
  h('div', { class: 'menu-group' }, '🎓 Tutorials'),
  h('p', { class: 'menu-note' }, 'Step-by-step guides. Start at the top and go in order — each one offers the next.'),
  TUTORIALS.map((t, i) => menuItem([
    h('span', { class: 'tutorial-num' }, i + 1),
    h('span', { class: 'tutorial-item' }, h('strong', {}, t.title), h('small', {}, t.about)),
    progress.done.includes(t.id) ? h('span', { class: 'tutorial-done', title: 'Finished' }, '✓') : null,
    fresh.has(t.id) ? h('span', { class: 'tutorial-new' }, 'New') : null,
  ], () => startTutorial(t.id), { icon: t.icon })));
  menu.addEventListener('toggle', () => {
    if (menu.open && hasNews(progress, TUTORIALS)) {
      progress = markSeen(progress, TUTORIALS);
      try { localStorage.setItem(PROGRESS_KEY, JSON.stringify(progress)); } catch { /* storage unavailable */ }
      menu.querySelector('.news-dot')?.remove();
    } else if (!menu.open) {
      drawButton();
    }
  });
  holder.replaceChildren(menu);
}
