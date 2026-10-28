// "Lesson Calendar": drag essential outcomes onto days for a school + grade.

import { h, iconButton, toast } from '../dom.js';
import {
  autoFill, find, instrumentsAt, lessonsFor, movePlacement, outcomeLabel,
  placeOutcome, placementWarnings, placementsFor, remove,
} from '../model.js';
import { commit, setUi, store, undo } from '../store.js';
import { formatDate, formatRange, isWeekday } from '../dates.js';
import { current, emptyNote, monthGrid, monthNav, pickId, pills, stepMonth, year } from './common.js';
import { slidePreview } from './slides.js';

export const OUTCOME_COLORS = ['#6a4c93', '#3f6e8c', '#6b8f5e', '#b5654a', '#c49a3a', '#8c4f6b', '#4f7d7a', '#7a6248'];

function context() {
  const schools = current('schools');
  const grades = current('grades');
  return {
    yearId: year().id,
    schools,
    grades,
    schoolId: pickId(schools, store.ui.schoolId),
    gradeId: pickId(grades, store.ui.gradeId),
    outcomes: current('outcomes'),
  };
}

export function outcomeColor(outcomeId) {
  const index = current('outcomes').findIndex((o) => o.id === outcomeId);
  return OUTCOME_COLORS[Math.max(0, index) % OUTCOME_COLORS.length];
}

export function renderPlan() {
  const ctx = context();
  if (!ctx.schools.length || !ctx.grades.length) {
    return emptyNote('Add at least one school and one grade on the Setup tab to start planning.');
  }
  const selected = find(store.state, 'placements', store.ui.placementId);
  const showDetail = selected && selected.schoolId === ctx.schoolId && selected.gradeId === ctx.gradeId;
  return h('div', { class: `plan-layout ${showDetail ? 'with-detail' : ''}` },
    sidebar(ctx),
    h('section', { class: 'main-col card' },
      monthNav(),
      armedBanner(ctx),
      monthGrid((date, info) => dayCell(ctx, date, info), 'plan-grid'),
    ),
    showDetail ? detailPanel(selected) : null,
  );
}

// ---------- left side: school, grade, outcomes ----------

function sidebar(ctx) {
  const placed = placementsFor(store.state, ctx.yearId, ctx.schoolId, ctx.gradeId);
  return h('aside', { class: 'side card' },
    h('h3', {}, 'School ', h('kbd', { title: 'Press [ or ] to switch school' }, '[ ]')),
    pills(ctx.schools, ctx.schoolId, (id) => setUi({ schoolId: id }), { hint: (s) => `Show ${s.name}` }),
    h('h3', {}, 'Grade ', h('kbd', { title: 'Press the grade’s number key (K = 0)' }, '0–5')),
    pills(ctx.grades, ctx.gradeId, (id) => setUi({ gradeId: id }), {
      label: (g) => g.short || g.name, hint: (g) => g.name,
    }),
    h('h3', {}, 'Essential outcomes'),
    h('p', { class: 'hint' }, 'Drag onto a day — or click one, then click days.'),
    ctx.outcomes.length ? null : emptyNote('No outcomes yet. Add them on the Outcomes & Lessons tab.'),
    h('div', { class: 'palette' }, ctx.outcomes.map((o) => paletteChip(o, placed))),
  );
}

function paletteChip(outcome, placed) {
  const count = placed.filter((p) => p.outcomeId === outcome.id).length;
  const armed = store.ui.armedOutcomeId === outcome.id;
  return h('div', {
    class: `outcome-chip palette-chip ${armed ? 'armed' : ''}`,
    draggable: 'true',
    style: { '--chip': outcomeColor(outcome.id) },
    title: armed ? 'Click again to stop placing' : 'Drag onto the calendar, or click to place on several days',
    ondragstart: (e) => e.dataTransfer.setData('text/plain', JSON.stringify({ outcomeId: outcome.id })),
    onclick: () => setUi({ armedOutcomeId: armed ? null : outcome.id }),
  },
  h('span', { class: 'chip-code' }, outcome.code || '•'),
  h('span', { class: 'chip-title' }, outcome.title),
  count ? h('span', { class: 'count', title: `Placed ${count}× for this school and grade` }, count) : null);
}

function armedBanner(ctx) {
  const outcome = find(store.state, 'outcomes', store.ui.armedOutcomeId);
  if (!outcome || !ctx.outcomes.includes(outcome)) return null;
  return h('div', { class: 'armed-banner' },
    `Click days to add “${outcomeLabel(outcome)}”.`,
    h('button', { class: 'btn small light', onclick: () => setUi({ armedOutcomeId: null }) }, 'Done (Esc)'));
}

// ---------- calendar days ----------

function canPlace(date, info) {
  return info.inYear && isWeekday(date);
}

function dayCell(ctx, date, info) {
  const placements = placementsFor(store.state, ctx.yearId, ctx.schoolId, ctx.gradeId)
    .filter((p) => p.date === date);
  const wrap = h('div', { class: 'day-body' },
    instrumentStripe(ctx, date),
    placements.map((p) => placementChip(p)));
  if (!canPlace(date, info)) return wrap;
  wrap.addEventListener('dragover', (e) => { e.preventDefault(); wrap.closest('.cal-day').classList.add('drop-target'); });
  wrap.addEventListener('dragleave', () => wrap.closest('.cal-day').classList.remove('drop-target'));
  wrap.addEventListener('drop', (e) => onDrop(e, ctx, date));
  wrap.addEventListener('click', (e) => {
    if (e.target.closest('.outcome-chip') || !store.ui.armedOutcomeId) return;
    commit((s) => placeOutcome(s, { ...placeArgs(ctx), outcomeId: store.ui.armedOutcomeId, date }));
  });
  if (store.ui.armedOutcomeId) wrap.classList.add('stampable');
  return wrap;
}

function placeArgs(ctx) {
  return { yearId: ctx.yearId, schoolId: ctx.schoolId, gradeId: ctx.gradeId };
}

function onDrop(e, ctx, date) {
  e.preventDefault();
  let data;
  try { data = JSON.parse(e.dataTransfer.getData('text/plain')); } catch { return; }
  const copy = e.ctrlKey || e.altKey || e.shiftKey;
  if (data.outcomeId) {
    commit((s) => placeOutcome(s, { ...placeArgs(ctx), outcomeId: data.outcomeId, date }));
  } else if (data.placementId) {
    const p = find(store.state, 'placements', data.placementId);
    if (!p) return;
    commit((s) => (copy ? placeOutcome(s, { ...p, date }) : movePlacement(s, p.id, date)));
  }
}

function instrumentStripe(ctx, date) {
  const ids = instrumentsAt(store.state, ctx.yearId, ctx.schoolId, date);
  if (!ids.length) return null;
  const instruments = ids.map((id) => find(store.state, 'instruments', id)).filter(Boolean);
  return h('div', { class: 'ins-stripe', 'data-tip': `Instruments here: ${instruments.map((i) => i.name).join(', ')}` },
    instruments.map((i) => h('span', { style: { background: i.color } }, i.name)));
}

function placementChip(p) {
  const outcome = find(store.state, 'outcomes', p.outcomeId);
  const warnings = placementWarnings(store.state, p);
  const selected = store.ui.placementId === p.id;
  return h('div', {
    class: `outcome-chip placed ${selected ? 'selected' : ''}`,
    draggable: 'true',
    style: { '--chip': outcomeColor(p.outcomeId) },
    title: 'Drag to move (hold Ctrl to copy). Click for lesson details.',
    ondragstart: (e) => e.dataTransfer.setData('text/plain', JSON.stringify({ placementId: p.id })),
    onclick: (e) => { e.stopPropagation(); setUi({ placementId: selected ? null : p.id }); },
  },
  warnings.length ? h('span', { class: 'warn', 'data-tip': warningText(p, warnings), 'aria-label': 'Instrument warning' }, '⚠') : null,
  h('span', { class: 'chip-code' }, outcome?.code || '•'),
  h('span', { class: 'chip-title' }, outcome?.title),
  iconButton('×', 'Remove from this day', (e) => { e.stopPropagation(); removePlacement(p); }, 'chip-x'));
}

function removePlacement(p) {
  commit((s) => remove(s, 'placements', p.id));
  toast('Removed from the calendar.', { label: 'Undo', run: undo });
}

/** Plain-language explanation shown when hovering the ⚠ sign. */
export function warningText(placement, warnings) {
  const school = find(store.state, 'schools', placement.schoolId)?.name;
  const byInstrument = Map.groupBy(warnings, (w) => w.instrument?.id);
  const parts = [...byInstrument.values()].map((group) => {
    const { instrument, blocks } = group[0];
    const name = instrument?.name || 'An instrument';
    const slides = group.map((w) => `“${w.slide.title}”`).join(', ');
    const when = blocks.length
      ? `${name} is at ${school}: ${blocks.map((b) => formatRange(b.startDate, b.endDate)).join(', ')}.`
      : `${name} isn’t scheduled at ${school} at all this year.`;
    return `${name} isn’t at ${school} on ${formatDate(placement.date)}, but these lessons use it: ${slides}.\n${when}`;
  });
  return `⚠ Instrument not available\n${parts.join('\n\n')}`;
}

// ---------- right side: lesson details ----------

function detailPanel(p) {
  const outcome = find(store.state, 'outcomes', p.outcomeId);
  const lessons = lessonsFor(store.state, p.outcomeId, p.gradeId);
  const warnIds = new Set(placementWarnings(store.state, p).map((w) => w.slide.id));
  return h('aside', { class: 'detail card' },
    h('div', { class: 'detail-head' },
      h('div', {},
        h('div', { class: 'eyebrow' }, formatDate(p.date)),
        h('h3', {}, outcomeLabel(outcome))),
      iconButton('×', 'Close', () => setUi({ placementId: null }))),
    lessons.length ? null : emptyNote('No eval criteria for this grade yet. Add them on the Outcomes & Lessons tab.'),
    lessons.map(({ criterion, slides }) => h('section', { class: 'detail-crit' },
      h('h4', {}, criterion.title),
      slides.length ? null : emptyNote('No lesson slides yet.'),
      h('div', { class: 'slide-row' }, slides.map((slide, i) => slidePreview(slide, {
        number: i + 1,
        fields: autoFill(store.state, slide, p),
        warn: warnIds.has(slide.id),
      }))))),
    h('button', { class: 'btn light danger', onclick: () => removePlacement(p) }, 'Remove from calendar'),
  );
}

// ---------- keyboard ----------

function cycleSchool(step) {
  const { schools, schoolId } = context();
  const i = schools.findIndex((s) => s.id === schoolId);
  setUi({ schoolId: schools[(i + step + schools.length) % schools.length].id });
}

function removeSelected() {
  const p = find(store.state, 'placements', store.ui.placementId);
  if (p) removePlacement(p);
}

const KEYS = {
  '[': () => cycleSchool(-1),
  ']': () => cycleSchool(1),
  ArrowLeft: () => stepMonth(-1),
  ArrowRight: () => stepMonth(1),
  Escape: () => setUi({ armedOutcomeId: null, placementId: null }),
  Delete: removeSelected,
  Backspace: removeSelected,
};

/** [ ] switch school, 0–5 switch grade, ← → change month. Returns true if handled. */
export function planKeys(e) {
  const grade = /^[0-9]$/.test(e.key) ? context().grades[Number(e.key)] : null;
  if (grade) setUi({ gradeId: grade.id });
  else if (KEYS[e.key]) KEYS[e.key]();
  return Boolean(grade || KEYS[e.key]);
}
