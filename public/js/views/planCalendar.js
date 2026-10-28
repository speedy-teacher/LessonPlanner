// The month grid of the Lesson Calendar: eval entries drawn as bars that
// can stretch over several days, plus dropping, moving and stretching them.

import { h, iconButton } from '../dom.js';
import {
  coversDate, find, instrumentsAt, movePlacement, outcomeLabel, outcomeOf, placeCriterion,
  placementWarnings, placementsFor, resizePlacement,
} from '../model.js';
import { commit, setUi, store } from '../store.js';
import { addDays, daysBetween, isWeekday, mondayOf, weekdaysBetween } from '../dates.js';
import { monthGrid } from './common.js';
import { outcomeColor, removePlacement, warningText } from './plan.js';

// Space between the content of two neighbouring day cells
// (cell padding 6 + border 1.5, twice, plus the 6px grid gap).
const BRIDGE_PX = 21;

let resizing = null; // { id, edge: 'startDate'|'endDate', target } while stretching

export function planCalendar(ctx) {
  const placements = placementsFor(store.state, ctx.yearId, ctx.schoolId, ctx.gradeId);
  const lanesByWeek = new Map();
  const lanesFor = (date) => {
    const monday = mondayOf(date);
    if (!lanesByWeek.has(monday)) lanesByWeek.set(monday, weekLanes(placements, monday));
    return lanesByWeek.get(monday);
  };
  return monthGrid((date, info) => dayCell(ctx, date, info, lanesFor(date)), 'plan-grid');
}

/** Give each entry touching a week a row ("lane") so multi-day bars line up. */
function weekLanes(placements, monday) {
  const friday = addDays(monday, 4);
  const inWeek = placements
    .filter((p) => p.startDate <= friday && p.endDate >= monday)
    .sort((a, b) => a.startDate.localeCompare(b.startDate) || b.endDate.localeCompare(a.endDate));
  const laneEnds = [];
  const lanes = [];
  for (const p of inWeek) {
    let lane = laneEnds.findIndex((end) => end < p.startDate);
    if (lane === -1) lane = laneEnds.length;
    laneEnds[lane] = p.endDate;
    (lanes[lane] ||= []).push(p);
  }
  return { monday, friday, lanes };
}

function canPlace(date, info) {
  return info.inYear && isWeekday(date);
}

function dayCell(ctx, date, info, week) {
  const body = h('div', { class: 'day-body' },
    instrumentStripe(ctx, date),
    week.lanes.map((lane) => {
      const p = lane.find((x) => coversDate(x, date));
      return p ? segment(p, date, week) : h('div', { class: 'seg-spacer' });
    }));
  if (!canPlace(date, info)) return body;
  body.addEventListener('dragover', (e) => { e.preventDefault(); body.closest('.cal-day').classList.add('drop-target'); });
  body.addEventListener('dragleave', () => body.closest('.cal-day').classList.remove('drop-target'));
  body.addEventListener('drop', (e) => onDrop(e, ctx, date));
  body.addEventListener('click', (e) => {
    if (e.target.closest('.seg') || !store.ui.armedCriterionId) return;
    commit((s) => placeCriterion(s, { ...placeArgs(ctx), criterionId: store.ui.armedCriterionId, startDate: date }));
  });
  if (store.ui.armedCriterionId) body.classList.add('stampable');
  return body;
}

function placeArgs(ctx) {
  return { yearId: ctx.yearId, schoolId: ctx.schoolId, gradeId: ctx.gradeId };
}

function instrumentStripe(ctx, date) {
  const ids = instrumentsAt(store.state, ctx.yearId, ctx.schoolId, date);
  if (!ids.length) return h('div', { class: 'ins-stripe empty' });
  const instruments = ids.map((id) => find(store.state, 'instruments', id)).filter(Boolean);
  return h('div', { class: 'ins-stripe', 'data-tip': `Instruments here: ${instruments.map((i) => i.name).join(', ')}` },
    instruments.map((i) => h('span', { style: { background: i.color } }, i.name)));
}

// ---------- one day's piece of an entry ----------

function segClasses(p, date, rowEnd, selected) {
  const cls = ['seg'];
  if (date === p.startDate) cls.push('starts');
  if (date === p.endDate) cls.push('ends');
  if (date === rowEnd) cls.push('row-end');
  if (selected) cls.push('selected');
  return cls.join(' ');
}

function segment(p, date, week) {
  const criterion = find(store.state, 'criteria', p.criterionId);
  const outcome = outcomeOf(store.state, p.criterionId);
  const rowStart = p.startDate > week.monday ? p.startDate : week.monday;
  const rowEnd = p.endDate < week.friday ? p.endDate : week.friday;
  const selected = store.ui.placementId === p.id;
  return h('div', {
    class: segClasses(p, date, rowEnd, selected),
    draggable: 'true',
    style: { '--chip': outcomeColor(outcome?.id) },
    title: `${outcomeLabel(outcome)}\n${criterion?.title}\nDrag to move (hold Ctrl to copy). Drag an end to stretch.`,
    dataset: { placementId: p.id },
    ondragstart: (e) => e.dataTransfer.setData('text/plain', JSON.stringify({ placementId: p.id, grabDate: date })),
    onclick: (e) => { e.stopPropagation(); setUi({ placementId: selected ? null : p.id }); },
  },
  date === p.startDate ? handle(p, 'startDate') : null,
  date === rowStart ? segLabel(p, date, rowEnd, criterion, outcome) : null,
  date === p.endDate ? handle(p, 'endDate') : null);
}

function segLabel(p, date, rowEnd, criterion, outcome) {
  const days = weekdaysBetween(date, rowEnd).length;
  const warnings = placementWarnings(store.state, p);
  return h('span', { class: 'seg-label', style: { width: days > 1 ? `calc(${days * 100}% - ${BRIDGE_PX}px)` : '100%' } },
    warnings.length ? h('span', { class: 'warn', 'data-tip': warningText(p, warnings), 'aria-label': 'Instrument warning' }, '⚠') : null,
    h('span', { class: 'chip-code' }, outcome?.code || '•'),
    h('span', { class: 'chip-title' }, criterion?.title),
    iconButton('×', 'Remove from the calendar', (e) => { e.stopPropagation(); removePlacement(p); }, 'chip-x'));
}

function handle(p, edge) {
  return h('span', {
    class: `stretch ${edge === 'startDate' ? 'left' : 'right'}`,
    title: 'Drag to stretch over more days',
    onmousedown: (e) => startResize(e, p, edge),
  });
}

// ---------- stretching ----------

function startResize(e, p, edge) {
  e.preventDefault();
  e.stopPropagation();
  resizing = { id: p.id, edge, fixed: edge === 'startDate' ? p.endDate : p.startDate, target: p[edge] };
  document.addEventListener('mouseover', trackResize);
  window.addEventListener('mouseup', finishResize, { once: true });
  document.body.classList.add('is-resizing');
}

function trackResize(e) {
  const cell = e.target.closest('.plan-grid .cal-day:not(.out-of-year)');
  if (!cell || !resizing) return;
  resizing.target = cell.dataset.date;
  const [a, b] = [resizing.fixed, resizing.target].sort();
  document.querySelectorAll('.plan-grid .cal-day').forEach((c) => {
    c.classList.toggle('stretch-preview', c.dataset.date >= a && c.dataset.date <= b);
  });
}

function finishResize() {
  document.removeEventListener('mouseover', trackResize);
  document.body.classList.remove('is-resizing');
  const r = resizing;
  resizing = null;
  if (!r) return;
  document.querySelectorAll('.stretch-preview').forEach((c) => c.classList.remove('stretch-preview'));
  commit((s) => resizePlacement(s, r.id, { [r.edge]: r.target }));
}

// ---------- dropping ----------

function onDrop(e, ctx, date) {
  e.preventDefault();
  let data;
  try { data = JSON.parse(e.dataTransfer.getData('text/plain')); } catch { return; }
  if (data.criterionId) {
    commit((s) => placeCriterion(s, { ...placeArgs(ctx), criterionId: data.criterionId, startDate: date }));
    return;
  }
  const p = find(store.state, 'placements', data.placementId);
  if (!p) return;
  const startDate = addDays(p.startDate, daysBetween(data.grabDate || p.startDate, date));
  const copy = e.ctrlKey || e.altKey || e.shiftKey;
  commit((s) => (copy
    ? placeCriterion(s, { ...p, startDate, endDate: addDays(startDate, daysBetween(p.startDate, p.endDate)) })
    : movePlacement(s, p.id, startDate)));
}
