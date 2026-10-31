// Pages (or parts of a page) showing a piece you can only look at — shared with you as "Viewer", or
// missing — are drawn as they are, with the ways to change them taken away: edit buttons hidden,
// boxes and choices turned off, nothing can be dragged or stretched. Looking still works: searching,
// filters, switching school/grade/week, previews and links.
//
// A page's main piece comes from people.js PAGE_PIECES; a part of a page holding another piece says so
// with `data-piece` (e.g. the lesson order on Outcomes is the teacher's own, not the School Year's).
// The store's guard (store.js setGuard) still refuses any change that gets through.

import { pieces } from '../workspace.js';
import { PAGE_PIECES } from './people.js';
import { showNotice } from '../notices.js';

/** Things that change data when clicked (in a view-only part they do nothing). */
const EDIT_CLICKS = [
  '[data-edit]', '.grade-toggle', '.tag-chip', '.main-grade-btn', '.ls-fill', '.ls-week-fill', '.chip-x', '.danger',
  '.adder button', '.icon-btn:not(.look)', '.stretch',
].join(', ');

/** Boxes and choices that only look (search, filters): they stay on in a view-only part. */
const LOOK_INPUTS = 'input[type="search"], [data-look], [data-look] *, .ls-filters *, .ins-filter *';

/** This piece of the open plan can be changed (always true for an older one-file plan). */
export const canChange = (piece) => !pieces || pieces.access(piece) === 'edit';
const editable = canChange;

/** After drawing a page: mark view-only parts and turn off their boxes and choices. */
export function markViewOnly(main, pageId) {
  main.dataset.piece = PAGE_PIECES[pageId]?.[0] ?? '';
  for (const zone of [main, ...main.querySelectorAll('[data-piece]')]) {
    const locked = Boolean(zone.dataset.piece) && !editable(zone.dataset.piece);
    zone.classList.toggle('view-only', locked);
    // `can-edit` marks an editable part inside a view-only one (the styles skip what's inside it).
    zone.classList.toggle('can-edit', !locked && Boolean(zone.parentElement?.closest('.view-only')));
  }
  main.querySelectorAll('input, select, textarea').forEach((el) => {
    if (inViewOnly(el) && !el.matches(LOOK_INPUTS)) el.disabled = true;
  });
  main.querySelectorAll('[draggable="true"]').forEach((el) => { if (inViewOnly(el)) el.draggable = false; });
}

function inViewOnly(el) {
  return Boolean(el.closest?.('[data-piece]')?.classList.contains('view-only'));
}

/** Catch clicks, drags and stretches in view-only parts before the page sees them. */
export function installViewOnlyBlock(root = document) {
  const stop = (e) => { e.preventDefault(); e.stopPropagation(); };
  for (const type of ['dragstart', 'drop', 'dragover']) {
    root.addEventListener(type, (e) => { if (inViewOnly(e.target)) stop(e); }, true);
  }
  root.addEventListener('mousedown', (e) => { if (inViewOnly(e.target) && e.target.closest('.stretch')) stop(e); }, true);
  root.addEventListener('click', (e) => {
    if (!inViewOnly(e.target) || !e.target.closest(EDIT_CLICKS)) return;
    stop(e);
    showNotice({ id: 'view-only', tone: 'info', title: 'View only', message: 'You can look at this but not change it.', seconds: 5 });
  }, true);
}
