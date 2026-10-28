// A month calendar of stretchable bars, shared by the Lesson Calendar and
// the Instrument Schedule. Each item has { id, startDate, endDate }.
// Drop something from a palette onto a day, drag a bar to move it
// (Ctrl to copy), or drag either end of a bar to stretch it.

import { h, iconButton } from '../dom.js';
import { addDays, daysBetween, isWeekday, mondayOf, weekdaysBetween } from '../dates.js';
import { monthGrid } from './common.js';

// Space between the content of two neighbouring day cells
// (cell padding 6 + border 1.5, twice, plus the 6px grid gap).
const BRIDGE_PX = 21;

let resizing = null; // { item, edge, fixed, target, onResize } while stretching

/**
 * cfg: {
 *   gridClass, items, selectedId, armed,
 *   colorOf(item), labelOf(item) -> nodes, titleOf(item),
 *   dayExtras(date)?            extra content at the top of each day
 *   onCreate(data, date)        something from the palette was dropped
 *   onMove(item, startDate, copy), onResize(item, edge, date),
 *   onSelect(item | null), onRemove(item), onArmedClick(date)
 * }
 */
export function barCalendar(cfg) {
  const lanesByWeek = new Map();
  const lanesFor = (date) => {
    const monday = mondayOf(date);
    if (!lanesByWeek.has(monday)) lanesByWeek.set(monday, weekLanes(cfg.items, monday));
    return lanesByWeek.get(monday);
  };
  return monthGrid((date, info) => dayCell(cfg, date, info, lanesFor(date)), `bar-grid ${cfg.gridClass}`);
}

/**
 * Give each item touching a week a row ("lane") so multi-day bars line up.
 * Items that start and end together keep the order they were given in.
 */
function weekLanes(items, monday) {
  const friday = addDays(monday, 4);
  const inWeek = items
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

function dayCell(cfg, date, info, week) {
  const body = h('div', { class: 'day-body' },
    cfg.dayExtras ? cfg.dayExtras(date) : null,
    week.lanes.map((lane) => {
      const item = lane.find((x) => x.startDate <= date && date <= x.endDate);
      return item ? segment(cfg, item, date, week) : h('div', { class: 'seg-spacer' });
    }));
  if (!info.inYear || !isWeekday(date)) return body;
  body.addEventListener('dragover', (e) => { e.preventDefault(); body.closest('.cal-day').classList.add('drop-target'); });
  body.addEventListener('dragleave', () => body.closest('.cal-day').classList.remove('drop-target'));
  body.addEventListener('drop', (e) => onDrop(e, cfg, date));
  if (cfg.armed) {
    body.classList.add('stampable');
    body.addEventListener('click', (e) => { if (!e.target.closest('.seg')) cfg.onArmedClick(date); });
  }
  return body;
}

// ---------- one day's piece of a bar ----------

function segClasses(item, date, rowEnd, selected) {
  const cls = ['seg'];
  if (date === item.startDate) cls.push('starts');
  if (date === item.endDate) cls.push('ends');
  if (date === rowEnd) cls.push('row-end');
  if (selected) cls.push('selected');
  return cls.join(' ');
}

function segment(cfg, item, date, week) {
  const rowStart = item.startDate > week.monday ? item.startDate : week.monday;
  const rowEnd = item.endDate < week.friday ? item.endDate : week.friday;
  const selected = cfg.selectedId === item.id;
  return h('div', {
    class: segClasses(item, date, rowEnd, selected),
    draggable: 'true',
    style: { '--chip': cfg.colorOf(item) },
    title: `${cfg.titleOf(item)}\nDrag to move (hold Ctrl to copy). Drag an end to stretch.`,
    ondragstart: (e) => e.dataTransfer.setData('text/plain', JSON.stringify({ barId: item.id, grabDate: date })),
    onclick: (e) => { e.stopPropagation(); cfg.onSelect(selected ? null : item); },
  },
  date === item.startDate ? handle(cfg, item, 'startDate') : null,
  date === rowStart ? segLabel(cfg, item, date, rowEnd) : null,
  date === item.endDate ? handle(cfg, item, 'endDate') : null);
}

function segLabel(cfg, item, date, rowEnd) {
  const days = weekdaysBetween(date, rowEnd).length;
  return h('span', { class: 'seg-label', style: { width: days > 1 ? `calc(${days * 100}% - ${BRIDGE_PX}px)` : '100%' } },
    cfg.labelOf(item),
    iconButton('×', 'Remove from the calendar', (e) => { e.stopPropagation(); cfg.onRemove(item); }, 'chip-x'));
}

function handle(cfg, item, edge) {
  return h('span', {
    class: `stretch ${edge === 'startDate' ? 'left' : 'right'}`,
    title: 'Drag to stretch over more days',
    onmousedown: (e) => startResize(e, cfg, item, edge),
  });
}

// ---------- stretching ----------

function startResize(e, cfg, item, edge) {
  e.preventDefault();
  e.stopPropagation();
  const fixed = edge === 'startDate' ? item.endDate : item.startDate;
  resizing = { item, edge, fixed, target: item[edge], onResize: cfg.onResize };
  document.addEventListener('mouseover', trackResize);
  window.addEventListener('mouseup', finishResize, { once: true });
  document.body.classList.add('is-resizing');
}

function trackResize(e) {
  const cell = e.target.closest('.bar-grid .cal-day:not(.out-of-year)');
  if (!cell || !resizing) return;
  resizing.target = cell.dataset.date;
  const [a, b] = [resizing.fixed, resizing.target].sort();
  document.querySelectorAll('.bar-grid .cal-day').forEach((c) => {
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
  r.onResize(r.item, r.edge, r.target);
}

// ---------- dropping ----------

function onDrop(e, cfg, date) {
  e.preventDefault();
  let data;
  try { data = JSON.parse(e.dataTransfer.getData('text/plain')); } catch { return; }
  if (!data.barId) {
    cfg.onCreate(data, date);
    return;
  }
  const item = cfg.items.find((x) => x.id === data.barId);
  if (!item) return;
  const startDate = addDays(item.startDate, daysBetween(data.grabDate || item.startDate, date));
  cfg.onMove(item, startDate, e.ctrlKey || e.altKey || e.shiftKey);
}
