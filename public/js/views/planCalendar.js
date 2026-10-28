// The month grid of the Outcome & Eval Calendar: eval entries as stretchable bars,
// with the school's instruments shown at the top of each day.

import { h } from '../dom.js';
import {
  find, instrumentsAt, movePlacement, outcomeLabel, outcomeOf, placeCriterion,
  placementWarnings, placementsFor, resizePlacement,
} from '../model.js';
import { commit, setUi, store } from '../store.js';
import { addDays, daysBetween } from '../dates.js';
import { barCalendar } from './barCalendar.js';
import { outcomeColor, removePlacement, warningText } from './plan.js';

export function planCalendar(ctx) {
  const place = (criterionId, startDate, endDate) => commit((s) => placeCriterion(s, {
    yearId: ctx.yearId, schoolId: ctx.schoolId, gradeId: ctx.gradeId, criterionId, startDate, endDate,
  }));
  return barCalendar({
    gridClass: 'plan-grid',
    items: placementsFor(store.state, ctx.yearId, ctx.schoolId, ctx.gradeId),
    selectedId: store.ui.placementId,
    armed: Boolean(store.ui.armedCriterionId),
    colorOf: (p) => outcomeColor(outcomeOf(store.state, p.criterionId)?.id),
    titleOf: (p) => `${outcomeLabel(outcomeOf(store.state, p.criterionId))}\n${find(store.state, 'criteria', p.criterionId)?.title}`,
    labelOf: placementLabel,
    dayExtras: (date) => instrumentStripe(ctx, date),
    onCreate: (data, date) => { if (data.criterionId) place(data.criterionId, date); },
    onMove: (p, startDate, copy) => (copy
      ? place(p.criterionId, startDate, addDays(startDate, daysBetween(p.startDate, p.endDate)))
      : commit((s) => movePlacement(s, p.id, startDate))),
    onResize: (p, edge, date) => commit((s) => resizePlacement(s, p.id, { [edge]: date })),
    onSelect: (p) => setUi({ placementId: p?.id ?? null }),
    onRemove: removePlacement,
    onArmedClick: (date) => place(store.ui.armedCriterionId, date),
  });
}

function placementLabel(p) {
  const outcome = outcomeOf(store.state, p.criterionId);
  const warnings = placementWarnings(store.state, p);
  return [
    warnings.length ? h('span', { class: 'warn', 'data-tip': warningText(p, warnings), 'aria-label': 'Instrument warning' }, '⚠') : null,
    h('span', { class: 'chip-code' }, outcome?.code || '•'),
    h('span', { class: 'chip-title' }, find(store.state, 'criteria', p.criterionId)?.title),
  ];
}

function instrumentStripe(ctx, date) {
  const ids = instrumentsAt(store.state, ctx.yearId, ctx.schoolId, date);
  if (!ids.length) return h('div', { class: 'ins-stripe empty' });
  const instruments = ids.map((id) => find(store.state, 'instruments', id)).filter(Boolean);
  return h('div', { class: 'ins-stripe', 'data-tip': `Instruments here: ${instruments.map((i) => i.name).join(', ')}` },
    instruments.map((i) => h('span', { style: { background: i.color } }, i.name)));
}
