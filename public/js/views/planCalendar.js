// The month grid of the Outcome & Eval Calendar: eval entries as stretchable bars,
// with the school's instruments shown at the top of each day.

import { h } from '../dom.js';
import {
  find, instrumentsAt, lessonInstruments, movePlacement, outcomeLabel, outcomeOf, placeCriterion,
  placementWarnings, placementsFor, resizePlacement, stepsFor,
} from '../model.js';
import { commit, setUi, store } from '../store.js';
import { contextMenu, instrumentMenu, showInstrumentLessons } from './common.js';
import { addDays, daysBetween } from '../dates.js';
import { barCalendar } from './barCalendar.js';
import { gradeColor, outcomeColor, removePlacement, warningText } from './plan.js';
import { showEval } from './outcomes.js';

export function planCalendar(ctx) {
  const place = (criterionId, startDate, endDate, gradeId = ctx.gradeId) => commit((s) => placeCriterion(s, {
    yearId: ctx.yearId, schoolId: ctx.schoolId, gradeId, criterionId, startDate, endDate,
  }));
  const all = ctx.allGrades;
  return barCalendar({
    gridClass: `plan-grid ${all ? 'all-grades' : ''}`,
    items: all
      ? store.state.placements.filter((p) => p.yearId === ctx.yearId && p.schoolId === ctx.schoolId)
      : placementsFor(store.state, ctx.yearId, ctx.schoolId, ctx.gradeId),
    selectedId: store.ui.placementId,
    armed: !all && Boolean(store.ui.armedCriterionId),
    colorOf: (p) => (all ? gradeColor(p.gradeId) : outcomeColor(outcomeOf(store.state, p.criterionId)?.id)),
    titleOf: (p) => [
      outcomeLabel(outcomeOf(store.state, p.criterionId)), find(store.state, 'criteria', p.criterionId)?.title,
      all ? find(store.state, 'grades', p.gradeId)?.name : null,
    ].filter(Boolean).join('\n'),
    labelOf: (p) => placementLabel(p, all),
    dayExtras: (date) => instrumentStripe(ctx, date),
    onCreate: (data, date) => { if (data.criterionId && !all) place(data.criterionId, date); },
    onMove: (p, startDate, copy) => (copy
      ? place(p.criterionId, startDate, addDays(startDate, daysBetween(p.startDate, p.endDate)), p.gradeId)
      : commit((s) => movePlacement(s, p.id, startDate))),
    onResize: (p, edge, date) => commit((s) => resizePlacement(s, p.id, { [edge]: date })),
    onSelect: (p) => setUi({ placementId: p?.id ?? null }),
    onMenu: placementMenu,
    onRemove: removePlacement,
    onArmedClick: (date) => { if (!all) place(store.ui.armedCriterionId, date); },
  });
}

/**
 * A bar's label: outcome code (always in the outcome's color) and the eval. On the "All" view the
 * bar is in its grade's color and starts with the grade's short label.
 */
function placementLabel(p, all) {
  const outcome = outcomeOf(store.state, p.criterionId);
  const warnings = placementWarnings(store.state, p);
  return [
    warnings.length ? h('span', { class: 'warn', 'data-tip': warningText(p, warnings), 'aria-label': 'Instrument warning' }, '⚠') : null,
    all ? gradeTag(find(store.state, 'grades', p.gradeId)) : null,
    h('span', { class: 'chip-code', style: { '--chip': outcomeColor(outcome?.id) } }, outcome?.code || '•'),
    h('span', { class: 'chip-title' }, find(store.state, 'criteria', p.criterionId)?.title),
  ];
}

const gradeTag = (grade) => h('span', { class: 'grade-tag' }, grade?.short || grade?.name || '?');

/** Clicking an eval on the calendar: its lessons' instruments, the eval itself, or remove it. */
function placementMenu(e, p) {
  const criterion = find(store.state, 'criteria', p.criterionId);
  const lessons = stepsFor(store.state, p.criterionId, p.gradeId).map((s) => find(store.state, 'lessons', s.lessonId));
  const instruments = [...new Map(lessons.flatMap((l) => lessonInstruments(store.state, l)).map((i) => [i.id, i])).values()];
  contextMenu(e, [
    ...instruments.map((i) => ({ icon: '📖', label: `Lessons that use ${i.name}`, run: () => showInstrumentLessons(i.id) })),
    { icon: '🌱', label: 'Open this eval in Outcomes, Evals & Lesson Order', run: () => showEval(criterion, p.gradeId) },
    { icon: '🗑', label: 'Remove from calendar', run: () => removePlacement(p) },
  ]);
}

function instrumentStripe(ctx, date) {
  const ids = instrumentsAt(store.state, ctx.yearId, ctx.schoolId, date);
  if (!ids.length) return h('div', { class: 'ins-stripe empty' });
  const instruments = ids.map((id) => find(store.state, 'instruments', id)).filter(Boolean);
  return h('div', { class: 'ins-stripe', 'data-tip': `Instruments here: ${instruments.map((i) => i.name).join(', ')}` },
    instruments.map((i) => h('span', {
      style: { background: i.color }, class: 'ins-stripe-item', role: 'button',
      onclick: (e) => instrumentMenu(e, i),
    }, i.name)));
}
