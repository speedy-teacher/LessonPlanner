// "Instrument Schedule": paint which instruments are at which school on
// which days. Every school is shown in each day, color coded.

import { h } from '../dom.js';
import { blocksFor, find, instrumentsAt, paintInstrument } from '../model.js';
import { commit, setUi, store } from '../store.js';
import { formatRange, isWeekday, weekdaysBetween } from '../dates.js';
import { current, emptyNote, monthGrid, monthNav, pickId, pills, stepMonth, year } from './common.js';

let drag = null; // { on, dates:Set } while painting with the mouse

function context() {
  const schools = current('schools');
  const instruments = current('instruments');
  return {
    yearId: year().id,
    schools,
    instruments,
    schoolId: pickId(schools, store.ui.paintSchoolId),
    instrumentId: pickId(instruments, store.ui.brushId),
  };
}

export function renderSchedule() {
  const ctx = context();
  if (!ctx.schools.length || !ctx.instruments.length) {
    return emptyNote('Add at least one school and one instrument on the Setup tab first.');
  }
  return h('div', { class: 'schedule-layout' },
    h('aside', { class: 'side card' },
      h('h3', {}, 'Painting for'),
      pills(ctx.schools, ctx.schoolId, (id) => setUi({ paintSchoolId: id })),
      h('h3', {}, 'Instrument'),
      pills(ctx.instruments, ctx.instrumentId, (id) => setUi({ brushId: id }), { colorOf: (i) => i.color }),
      h('p', { class: 'hint' }, 'Click or drag across days to add the instrument. Start on a day that already has it to erase instead.'),
      summary(ctx)),
    h('section', { class: 'main-col card' },
      monthNav(),
      legend(ctx),
      monthGrid((date, info) => dayCell(ctx, date, info), 'schedule-grid')),
  );
}

function legend(ctx) {
  return h('div', { class: 'legend' },
    ctx.instruments.map((i) => h('span', { class: 'legend-item' }, h('span', { class: 'dot', style: { background: i.color } }), i.name)),
    h('span', { class: 'legend-schools' }, ctx.schools.map((s) => h('span', {}, h('b', {}, initials(s.name)), ` ${s.name}`))));
}

/** Each day lists every school with the colors of its instruments that day. */
function dayCell(ctx, date, info) {
  const rows = ctx.schools.map((school) => {
    const here = instrumentsAt(store.state, ctx.yearId, school.id, date)
      .map((id) => find(store.state, 'instruments', id)).filter(Boolean);
    const names = here.map((i) => i.name).join(' + ') || 'No instrument';
    return h('div', {
      class: `school-row ${school.id === ctx.schoolId ? 'painting' : ''}`,
      'data-tip': `${school.name}: ${names}`,
    },
    h('span', { class: 'school-initial' }, initials(school.name)),
    h('span', { class: 'school-bar' }, here.map((i) => h('span', { style: { background: i.color } }))));
  });
  const body = h('div', { class: 'day-body' }, rows);
  if (info.inYear && isWeekday(date)) {
    body.classList.add('paintable');
    body.addEventListener('mousedown', (e) => { e.preventDefault(); startPaint(ctx, date); });
    body.addEventListener('mouseenter', () => continuePaint(date));
  }
  return body;
}

function initials(name) {
  return name.split(/\s+/).filter((w) => !/^(elementary|school|es)$/i.test(w)).map((w) => w[0]).join('').slice(0, 2).toUpperCase();
}

// Dragging paints every school day between the first and the current day.
function dragDates() {
  const [a, b] = [drag.start, drag.end].sort();
  return weekdaysBetween(a, b).filter((d) => d >= year().startDate && d <= year().endDate);
}

function highlightDrag() {
  const dates = new Set(dragDates());
  document.querySelectorAll('.cal-day').forEach((cell) => {
    const body = cell.querySelector('.day-body.paintable');
    body?.classList.toggle(drag.on ? 'paint-on' : 'paint-off', dates.has(cell.dataset.date));
  });
}

function startPaint(ctx, date) {
  const has = instrumentsAt(store.state, ctx.yearId, ctx.schoolId, date).includes(ctx.instrumentId);
  drag = { ctx, on: !has, start: date, end: date };
  highlightDrag();
  window.addEventListener('mouseup', finishPaint, { once: true });
}

function continuePaint(date) {
  if (!drag) return;
  drag.end = date;
  highlightDrag();
}

function finishPaint() {
  if (!drag) return;
  const { ctx, on } = drag;
  const dates = dragDates();
  drag = null;
  commit((s) => paintInstrument(s, {
    yearId: ctx.yearId, schoolId: ctx.schoolId, instrumentId: ctx.instrumentId, dates, on,
  }));
}

/** Year at a glance for the selected school. */
function summary(ctx) {
  const school = find(store.state, 'schools', ctx.schoolId);
  const items = ctx.instruments.flatMap((ins) => blocksFor(store.state, ctx.yearId, ctx.schoolId, ins.id)
    .map((b) => ({ ins, b })))
    .sort((a, b) => a.b.startDate.localeCompare(b.b.startDate));
  return h('div', { class: 'summary' },
    h('h3', {}, `${school.name} this year`),
    items.length ? null : emptyNote('Nothing scheduled yet.'),
    h('ul', {}, items.map(({ ins, b }) => h('li', {},
      h('span', { class: 'dot', style: { background: ins.color } }),
      h('strong', {}, ins.name), ' ', formatRange(b.startDate, b.endDate)))));
}

export function scheduleKeys(e) {
  if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return false;
  stepMonth(e.key === 'ArrowRight' ? 1 : -1);
  return true;
}
