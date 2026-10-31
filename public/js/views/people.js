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
    TEACHER_PAGES.includes(pageId) && pieces.link('schoolYear')?.fileId ? peoplePicker(pageId) : null,
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
  const names = PAGE_PIECES[pageId] ?? [];
  const viewOnly = names.filter((name) => pieces.access(name) === 'view');
  const notes = [];
  if (viewOnly.length) {
    const stale = viewOnly.map((name) => pieces.stale[name]).find(Boolean);
    const why = stale ? MISSING_WORDS[stale] ?? '' : 'Ask its owner for Editor access in Google Drive to make changes.';
    notes.push(note('👀', `View only — ${joinNames(viewOnly)}.`, why, 'view'));
  }
  for (const name of names) {
    const missing = pieces.access(name) === 'none' ? pieces.missing[name] : null;
    if (missing && missing !== 'not_linked') notes.push(note('🌫️', `Can’t open ${pieceName(name)}.`, MISSING_WORDS[missing] ?? '', 'missing'));
  }
  return notes;
}

/** "Pat’s Teacher Schedule and Teacher Resources" */
function joinNames(names) {
  const [first, ...rest] = names;
  return [pieceName(first), ...rest.map((name) => PIECES[name].label)].join(' and ');
}

function note(icon, title, text, kind) {
  return h('div', { class: `piece-note ${kind}`, role: 'status', 'data-tour': `piece-note-${kind}` },
    h('span', { 'aria-hidden': 'true' }, icon), h('strong', {}, title), text ? h('span', { class: 'hint' }, text) : null);
}

// ---------- "Looking at" ----------

/** What "Looking at" changes on each page (each part is its own file, so only say what the page shows). */
const PICKER_TIPS = {
  lessonSchedule: 'Whose lesson schedule and templates to look at',
  reports: 'Whose lesson schedule and reports to look at',
  lessons: 'Whose lesson templates to look at',
  images: 'Whose pictures to look at',
  outcomes: 'Whose lesson order to look at',
};

function peoplePicker(pageId) {
  const who = pieces.viewing?.name ?? 'Me';
  const list = h('ul', { class: 'people-list', role: 'listbox' });
  const search = h('input', { type: 'search', placeholder: 'Search names…', 'aria-label': 'Search names', class: 'people-search' });
  const picker = h('details', { class: 'people-picker', 'data-tour': 'people-picker' },
    h('summary', { class: 'btn small light', 'data-tip': PICKER_TIPS[pageId] ?? 'Whose plans to look at' }, '👀 Looking at: ', h('strong', {}, who), ' ▾'),
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
