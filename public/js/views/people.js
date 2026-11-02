// The bar above a page of a plan made of pieces (see pieces.js):
//   - "👀 Looking at: Me ▾" on the pages that have a lens (lensRules.js): a searchable list of only the
//     people who shared that page's part with you. Lesson Schedule, Reports and Outcomes list people
//     whose Lesson Schedule uses the School Year you have open; Lesson Templates and Images list people
//     whose Teacher Resources are shared with you. Each page remembers its own choice (lookingAt.js).
//   - a capsule per file the page shows: which file it is and whether it's shared (views/capsules.js);
//   - a soft banner when the page shows something you can only look at, or something that's missing.

import { h } from '../dom.js';
import { google } from '../google.js';
import { MISSING_WORDS } from '../pieceEngine.js';
import { PIECES } from '../pieces.js';
import { pieces } from '../workspace.js';
import { LENS } from '../lensRules.js';
import { peopleFor, pick, pickedOn } from '../lookingAt.js';
import { refresh } from '../store.js';
import { pieceCapsule } from './capsules.js';

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

/** A Lesson Schedule list needs the School Year file you have open; a Teacher Resources list doesn't. */
const canListPeople = (pageId) => LENS[pageId] === 'resources' || Boolean(pieces.link('schoolYear')?.fileId);

/** The bar for a page, or null when there's nothing to show. */
export function pieceBar(pageId) {
  if (!pieces) return null;
  if (openOn !== pageId) openOn = null;
  const parts = [
    ...(PAGE_PIECES[pageId] ?? []).map(pieceCapsule),
    LENS[pageId] && canListPeople(pageId) ? peoplePicker(pageId) : null,
    ...pieceNotes(pageId),
  ].filter(Boolean);
  return parts.length ? h('div', { class: 'piece-bar', 'data-tour': 'piece-bar' }, parts) : null;
}

// ---------- notes about view-only and missing pieces ----------

/** "Teacher Resources", or "Pat’s Teacher Resources" while looking at someone's. */
function pieceName(name) {
  const who = pieces.viewing?.[name];
  return who ? `${who.name}’s ${PIECES[name].label}` : PIECES[name].label;
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
  lessonSchedule: 'Colleagues who shared their lesson schedule with you',
  reports: 'Colleagues who shared their lesson schedule with you',
  lessons: 'Colleagues who shared their lesson templates with you',
  images: 'Colleagues who shared their pictures (Teacher Resources) with you',
  outcomes: 'Colleagues who shared their lesson schedule (lesson order) with you',
};

/** What to say when nobody has shared that part with you yet. */
const NOBODY = {
  schedule: 'Nobody has shared their Lesson Schedule for this School Year with you yet.',
  resources: 'Nobody has shared their Teacher Resources with you yet.',
};

// The tab whose list is open: a redraw (e.g. Google sign-in finishing just after the list was opened)
// opens it again and looks for colleagues again, instead of closing it with "Connect Google Drive".
let openOn = null;

function peoplePicker(pageId) {
  const chosen = pickedOn(pageId);
  const list = h('ul', { class: 'people-list', role: 'listbox' });
  const search = h('input', { type: 'search', placeholder: 'Search names…', 'aria-label': 'Search names', class: 'people-search' });
  const picker = h('details', { class: 'people-picker', 'data-tour': 'people-picker' },
    h('summary', { class: 'btn small light', 'data-tip': PICKER_TIPS[pageId] ?? 'Whose plans to look at' }, '👀 Looking at: ', h('strong', {}, chosen?.name ?? 'Me'), ' ▾'),
    h('div', { class: 'people-panel' }, search, list));
  let people = [];
  const draw = () => {
    const words = search.value.trim().toLowerCase();
    const shown = people.filter((p) => p.name.toLowerCase().includes(words));
    const none = h('li', { class: 'hint' }, google.token ? NOBODY[LENS[pageId]] : 'Connect Google Drive to see colleagues.');
    list.replaceChildren(
      personRow('Me', !chosen, () => choose(null)),
      ...shown.map((p) => personRow(p.name, chosen?.fileId === p.fileId, () => choose(p))),
      ...(shown.length ? [] : [none]));
  };
  const choose = (person) => { picker.open = false; pick(pageId, person).finally(refresh); };
  search.addEventListener('input', draw);
  picker.addEventListener('toggle', async () => {
    if (!picker.open) { if (picker.isConnected) openOn = null; return; }
    openOn = pageId;
    draw();
    search.focus();
    people = await peopleFor(pageId).catch(() => people);
    draw();
  });
  if (openOn === pageId) picker.open = true;
  return picker;
}

function personRow(name, chosen, pick) {
  return h('li', {},
    h('button', { class: `people-row ${chosen ? 'chosen' : ''}`, role: 'option', 'aria-selected': String(chosen), onclick: () => { if (!chosen) pick(); } },
      chosen ? '✓ ' : '', name));
}
