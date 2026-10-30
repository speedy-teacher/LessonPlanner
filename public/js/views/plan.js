// "Outcome & Eval Calendar": drag eval criteria (grouped by essential outcome) onto
// days for a school + grade, and stretch them over several days.

import { h, iconButton, toast } from '../dom.js';
import {
  PALETTE, autoFill, criteriaForGrade, find, outcomeLabel, outcomeOf, placementWarnings,
  placementsFor, remove, resizePlacement, shiftSchoolDay, stepsFor, toRanges,
} from '../model.js';
import { commit, setUi, store, undo } from '../store.js';
import { formatDate, formatRange } from '../dates.js';
import { current, emptyNote, gradePills, pickId, pills, year } from './common.js';
import { calendarHeader, stepMonth } from './calendarGrid.js';
import { planCalendar } from './planCalendar.js';
import { lessonPreview } from './lessonPreview.js';

function context() {
  const schools = current('schools');
  const grades = current('grades');
  return {
    yearId: year().id,
    schools,
    grades,
    schoolId: pickId(schools, store.ui.schoolId),
    gradeId: pickId(grades, store.ui.gradeId),
    // "All": every grade's evals at once, each bar in its grade's color (for looking and moving, not adding).
    allGrades: Boolean(store.ui.planAllGrades),
    outcomes: current('outcomes'),
  };
}

const ALL = 'all';

/** Every eval of an outcome shares the outcome's color. */
export function outcomeColor(outcomeId) {
  return find(store.state, 'outcomes', outcomeId)?.color || PALETTE[0];
}

/** A grade's own color (Setup › School Year). */
export function gradeColor(gradeId) {
  return find(store.state, 'grades', gradeId)?.color || PALETTE[0];
}

export function renderPlan() {
  const ctx = context();
  if (!ctx.schools.length || !ctx.grades.length) {
    return emptyNote('Add at least one school and one grade under Setup › School Year to start planning.');
  }
  const selected = find(store.state, 'placements', store.ui.placementId);
  const showDetail = selected && selected.schoolId === ctx.schoolId && (ctx.allGrades || selected.gradeId === ctx.gradeId);
  return h('div', { class: `plan-layout ${showDetail ? 'with-detail' : ''}` },
    sidebar(ctx),
    h('section', { class: 'main-col card' },
      calendarHeader(armedBanner()),
      planCalendar(ctx),
    ),
    showDetail ? detailPanel(selected) : null,
  );
}

// ---------- left side: school, grade, evals ----------

function sidebar(ctx) {
  return h('aside', { class: 'side card' },
    h('h3', {}, 'School ', h('kbd', { title: 'Press [ or ] to switch school' }, '[ ]')),
    pills(ctx.schools, ctx.schoolId, (id) => setUi({ schoolId: id }), { hint: (s) => `Show ${s.name}` }),
    h('h3', {}, 'Grade ', h('kbd', { title: 'Press the grade’s number key (K = 0), or A for all grades' }, '0–5, A')),
    gradePills([...ctx.grades, { id: ALL, name: 'Every grade at once', short: 'All' }], ctx.allGrades ? ALL : ctx.gradeId,
      (id) => setUi(id === ALL ? { planAllGrades: true, armedCriterionId: null } : { gradeId: id, planAllGrades: false })),
    ctx.allGrades ? gradeLegend(ctx) : evalPalette(ctx),
  );
}

/** "All" view: which color is which grade, and how many evals each has on this school's calendar. */
function gradeLegend(ctx) {
  const placed = store.state.placements.filter((p) => p.yearId === ctx.yearId && p.schoolId === ctx.schoolId);
  return [
    h('h3', {}, 'Every grade'),
    h('p', { class: 'hint' }, 'Each eval is in its grade’s color; its outcome code keeps the outcome’s color. Drag to move or stretch. To add evals, pick a grade.'),
    h('ul', { class: 'grade-legend' }, ctx.grades.map((g) => {
      const count = placed.filter((p) => p.gradeId === g.id).length;
      return h('li', {},
        h('button', {
          class: 'outcome-chip', style: { '--chip': g.color }, title: `Show only ${g.name}`,
          onclick: () => setUi({ gradeId: g.id, planAllGrades: false }),
        }, h('span', { class: 'chip-code' }, g.short || '•'), h('span', { class: 'chip-title' }, g.name),
        count ? h('span', { class: 'count', title: `${count} on the calendar` }, count) : null));
    })),
  ];
}

function evalPalette(ctx) {
  const grade = find(store.state, 'grades', ctx.gradeId);
  const placed = placementsFor(store.state, ctx.yearId, ctx.schoolId, ctx.gradeId);
  const groups = ctx.outcomes
    .map((outcome) => ({ outcome, criteria: criteriaForGrade(store.state, outcome.id, ctx.gradeId) }))
    .filter((g) => g.criteria.length);
  return [
    h('h3', {}, `Evals for ${grade?.name || 'this grade'}`),
    h('p', { class: 'hint' }, 'Drag onto a day, then drag its end to stretch it. Or click one, then click days.'),
    groups.length ? null : emptyNote('No eval criteria for this grade yet. Add them on the Outcomes, Evals & Lesson Order tab.'),
    h('div', { class: 'palette' }, groups.map(({ outcome, criteria }) => h('section', {
      class: 'palette-group', style: { '--chip': outcomeColor(outcome.id) },
    },
    h('div', { class: 'palette-outcome' }, h('span', { class: 'chip-code' }, outcome.code || '•'), outcome.title),
    criteria.map((c) => paletteChip(c, placed))))),
  ];
}

function paletteChip(criterion, placed) {
  const count = placed.filter((p) => p.criterionId === criterion.id).length;
  const armed = store.ui.armedCriterionId === criterion.id;
  return h('div', {
    class: `outcome-chip palette-chip ${armed ? 'armed' : ''}`,
    draggable: 'true',
    title: armed ? 'Click again to stop placing' : 'Drag onto the calendar, or click to place on several days',
    ondragstart: (e) => e.dataTransfer.setData('text/plain', JSON.stringify({ criterionId: criterion.id })),
    onclick: () => setUi({ armedCriterionId: armed ? null : criterion.id }),
  },
  h('span', { class: 'chip-title' }, criterion.title),
  count ? h('span', { class: 'count', title: `On the calendar ${count}× for this school and grade` }, count) : null);
}

function armedBanner() {
  const criterion = find(store.state, 'criteria', store.ui.armedCriterionId);
  if (!criterion) return null;
  return h('div', { class: 'armed-banner' },
    `Click days to add “${criterion.title}”.`,
    h('button', { class: 'btn small light', onclick: () => setUi({ armedCriterionId: null }) }, 'Done (Esc)'));
}

export function removePlacement(p) {
  commit((s) => remove(s, 'placements', p.id));
  toast('Removed from the calendar.', { label: 'Undo', run: undo });
}

/** Plain-language explanation shown when hovering the ⚠ sign. */
export function warningText(placement, warnings) {
  const school = find(store.state, 'schools', placement.schoolId)?.name;
  const byInstrument = Map.groupBy(warnings, (w) => w.instrument?.id);
  const parts = [...byInstrument.values()].map((group) => {
    const { instrument, blocks, missingDates } = group[0];
    const name = instrument?.name || 'An instrument';
    const lessons = group.map((w) => `“${w.lesson.name}”`).join(', ');
    const missing = toRanges(missingDates).map(([a, b]) => formatRange(a, b)).join(', ');
    const when = blocks.length
      ? `${name} is at ${school}: ${blocks.map((b) => formatRange(b.startDate, b.endDate)).join(', ')}.`
      : `${name} isn’t scheduled at ${school} at all this year.`;
    return `${name} isn’t at ${school} on ${missing}, but these lessons use it: ${lessons}.\n${when}`;
  });
  return `⚠ Instrument not available\n${parts.join('\n\n')}`;
}

// ---------- right side: lesson details ----------

function detailPanel(p) {
  const criterion = find(store.state, 'criteria', p.criterionId);
  const steps = stepsFor(store.state, p.criterionId, p.gradeId);
  const warnIds = new Set(placementWarnings(store.state, p).map((w) => w.step.id));
  const range = p.startDate === p.endDate ? formatDate(p.startDate) : `${formatDate(p.startDate)} – ${formatDate(p.endDate)}`;
  return h('aside', { class: 'detail card', style: { '--chip': outcomeColor(outcomeOf(store.state, p.criterionId)?.id) } },
    h('div', { class: 'detail-head' },
      h('div', {},
        h('div', { class: 'eyebrow' }, range),
        h('div', { class: 'detail-outcome' }, outcomeLabel(outcomeOf(store.state, p.criterionId))),
        h('h3', {}, criterion?.title),
        h('div', { class: 'eyebrow' }, find(store.state, 'grades', p.gradeId)?.name)),
      iconButton('×', 'Close', () => setUi({ placementId: null }))),
    steps.length ? null : emptyNote('No lessons yet. Add them on the Outcomes, Evals & Lesson Order tab.'),
    h('div', { class: 'slide-row' }, steps.map((step, i) => lessonPreview(step.lessonId, {
      number: i + 1,
      fields: autoFill(store.state, step, p),
      warn: warnIds.has(step.id),
    }))),
    h('p', { class: 'hint' }, 'Tip: Shift + ← / → makes this shorter or longer.'),
    h('button', { class: 'btn light danger', onclick: () => removePlacement(p) }, 'Remove from calendar'),
  );
}

// ---------- keyboard ----------

function cycleSchool(step) {
  const { schools, schoolId } = context();
  const i = schools.findIndex((s) => s.id === schoolId);
  setUi({ schoolId: schools[(i + step + schools.length) % schools.length].id });
}

function selectedPlacement() {
  return find(store.state, 'placements', store.ui.placementId);
}

function removeSelected() {
  const p = selectedPlacement();
  if (p) removePlacement(p);
}

/** Shift+→ adds a school day to the selected entry, Shift+← takes one away. */
function stretchSelected(direction) {
  const p = selectedPlacement();
  if (!p) return stepMonth(direction);
  const endDate = shiftSchoolDay(p.endDate, direction);
  if (endDate < p.startDate) return null;
  return commit((s) => resizePlacement(s, p.id, { endDate }));
}

const KEYS = {
  '[': () => cycleSchool(-1),
  ']': () => cycleSchool(1),
  ArrowLeft: (e) => (e.shiftKey ? stretchSelected(-1) : stepMonth(-1)),
  ArrowRight: (e) => (e.shiftKey ? stretchSelected(1) : stepMonth(1)),
  Escape: () => setUi({ armedCriterionId: null, placementId: null }),
  a: () => setUi({ planAllGrades: true, armedCriterionId: null }),
  A: () => setUi({ planAllGrades: true, armedCriterionId: null }),
  Delete: removeSelected,
  Backspace: removeSelected,
};

/** [ ] switch school, 0–5 switch grade, ← → change month. Returns true if handled. */
export function planKeys(e) {
  const grade = /^[0-9]$/.test(e.key) ? context().grades[Number(e.key)] : null;
  if (grade) setUi({ gradeId: grade.id, planAllGrades: false });
  else if (KEYS[e.key]) KEYS[e.key](e);
  return Boolean(grade || KEYS[e.key]);
}
