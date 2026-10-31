// The bar above a page of a plan made of pieces (see pieces.js):
//   - "👀 Looking at: Me ▾" on the teacher pages (Lesson Schedule, Reports, Lesson Templates, Images,
//     and Outcomes for its lesson order): a searchable list of teammates whose Lesson Schedules use the
//     same School Year and are shared with you. One choice for all of those pages.
//   - a soft banner when the page shows something you can only look at, or something that's missing.

import { h } from '../dom.js';
import { google } from '../google.js';
import { MISSING_WORDS } from '../pieceEngine.js';
import { PIECES } from '../pieces.js';
import { listTeammates, pieces, viewMine, viewTeammate } from '../workspace.js';

/** Which pieces each page shows (the first = what the page is mostly about). */
export const PAGE_PIECES = {
  plan: ['schoolYear'],
  schedule: ['schoolYear'],
  setup: ['schoolYear'],
  outcomes: ['schoolYear', 'schedule'],
  lessonSchedule: ['schedule', 'resources'],
  reports: ['schedule'],
  lessons: ['resources'],
  images: ['resources'],
};

/** Pages that follow "Looking at" (everything not only about the shared School Year). */
export const TEACHER_PAGES = Object.keys(PAGE_PIECES).filter((id) => PAGE_PIECES[id].some((p) => p !== 'schoolYear'));

/** The bar for a page, or null when there's nothing to show. */
export function pieceBar(pageId) {
  if (!pieces) return null;
  const parts = [
    TEACHER_PAGES.includes(pageId) && pieces.link('schoolYear')?.fileId ? peoplePicker() : null,
    ...pieceNotes(pageId),
  ].filter(Boolean);
  return parts.length ? h('div', { class: 'piece-bar', 'data-tour': 'piece-bar' }, parts) : null;
}

// ---------- notes about view-only and missing pieces ----------

/** "Teacher Resources", or "Pat’s Teacher Resources" while looking at a teammate's. */
function pieceName(name) {
  if (name === 'schoolYear' || !pieces.viewing) return PIECES[name].label;
  return `${pieces.viewing.name}’s ${PIECES[name].label}`;
}

function pieceNotes(pageId) {
  return (PAGE_PIECES[pageId] ?? []).map((name) => {
    const access = pieces.access(name);
    if (access === 'edit') return null;
    const label = pieceName(name);
    if (access === 'view') {
      const why = pieces.stale[name] ? MISSING_WORDS[pieces.stale[name]] ?? '' : 'Ask its owner for Editor access in Google Drive to make changes.';
      return note('👀', `View only — ${label}.`, why, 'view');
    }
    const missing = pieces.missing[name];
    if (missing === 'not_linked') return null;
    return note('🌫️', `Can’t open ${label}.`, MISSING_WORDS[missing] ?? '', 'missing');
  }).filter(Boolean);
}

function note(icon, title, text, kind) {
  return h('div', { class: `piece-note ${kind}`, role: 'status', 'data-tour': `piece-note-${kind}` },
    h('span', { 'aria-hidden': 'true' }, icon), h('strong', {}, title), text ? h('span', { class: 'hint' }, text) : null);
}

// ---------- "Looking at" ----------

function peoplePicker() {
  const who = pieces.viewing?.name ?? 'Me';
  const list = h('ul', { class: 'people-list', role: 'listbox' });
  const search = h('input', { type: 'search', placeholder: 'Search names…', 'aria-label': 'Search names', class: 'people-search' });
  const picker = h('details', { class: 'people-picker', 'data-tour': 'people-picker' },
    h('summary', { class: 'btn small light', 'data-tip': 'Whose Lesson Schedule, templates and pictures to look at' }, '👀 Looking at: ', h('strong', {}, who), ' ▾'),
    h('div', { class: 'people-panel' }, search, list));
  let people = [];
  const draw = () => {
    const words = search.value.trim().toLowerCase();
    const shown = people.filter((p) => p.name.toLowerCase().includes(words));
    const none = h('li', { class: 'hint' }, google.token ? 'No teammates found. A teammate shows here once their Lesson Schedule is shared with you.' : 'Connect Google Drive to see teammates.');
    list.replaceChildren(
      personRow('Me', !pieces.viewing, () => viewMine()),
      ...shown.map((p) => personRow(p.name, pieces.viewing?.fileId === p.fileId, () => viewTeammate(p))),
      ...(shown.length ? [] : [none]));
  };
  search.addEventListener('input', draw);
  picker.addEventListener('toggle', async () => {
    if (!picker.open) return;
    draw();
    search.focus();
    people = await listTeammates().catch(() => people);
    draw();
  });
  return picker;
}

function personRow(name, chosen, pick) {
  return h('li', {},
    h('button', { class: `people-row ${chosen ? 'chosen' : ''}`, role: 'option', 'aria-selected': String(chosen), onclick: () => { if (!chosen) pick(); } },
      chosen ? '✓ ' : '', name));
}
