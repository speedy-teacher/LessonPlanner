// The "📥 Bring last year's weeks…" window on the Lesson Schedule: pick one of your other plans, see what
// would come over (by week number, into weeks still empty), then bring it (one Undo step).

import { h, openModal, toast } from '../dom.js';
import { undo } from '../store.js';
import { bringWeeks, otherPlans, previewWeeks, readOtherPlan } from '../lastYearWeeks.js';
import { pickedOn } from '../lookingAt.js';
import { pieces } from '../workspace.js';

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** The header button (only for your own Lesson Schedule, not while looking at someone else's). */
export function bringWeeksButton() {
  if (pieces && pickedOn('lessonSchedule')) return null;
  return h('button', {
    class: 'btn light', 'data-tour': 'ls-bring-weeks', 'data-edit': 'hide', onclick: openBringWeeks,
    'data-tip': 'Copies another year’s lessons into this year by week number (week 1 → week 1), only into weeks that are still empty.',
  }, '📥 Bring last year’s weeks…');
}

export function openBringWeeks() {
  openModal('Bring last year’s weekly schedule', (close) => {
    const body = h('div', { class: 'modal-body bring-weeks' }, h('p', { class: 'hint' }, 'Looking for your other plans…'));
    otherPlans().then((plans) => body.replaceChildren(...choosePlan(plans, body, close)))
      .catch(() => body.replaceChildren(h('p', { class: 'google-status error' }, 'Couldn’t list your plans. Please try again in a minute.')));
    return body;
  });
}

function choosePlan(plans, body, close) {
  if (!plans.length) {
    return [h('p', {}, 'No other plans found. Connect Google Drive to see the plans kept there.'), closeRow(close)];
  }
  return [
    h('p', {}, 'Which year’s weekly schedule? Its lessons go into the same week numbers here (week 1 → week 1), only into weeks that are still empty, so nothing you’ve planned changes.'),
    h('ul', { class: 'plan-list' }, plans.map((plan) => h('li', { class: 'plan-row' },
      h('button', { class: 'plan-open', onclick: () => preview(plan, body, close) }, h('span', {}, plan.name))))),
    closeRow(close),
  ];
}

async function preview(plan, body, close) {
  body.replaceChildren(h('p', { class: 'hint' }, `Reading ${plan.name}…`));
  try {
    const from = await readOtherPlan(plan);
    const r = previewWeeks(from);
    body.replaceChildren(...previewStep(plan, from, r, body, close));
  } catch (err) {
    console.warn(err);
    body.replaceChildren(h('p', { class: 'google-status error' }, `Couldn’t read ${plan.name}.`), closeRow(close));
  }
}

function previewStep(plan, from, r, body, close) {
  const notes = [
    r.skipped ? `${plural(r.skipped, 'lesson')} in weeks you’ve already planned stay out (your weeks are kept as they are).` : null,
    r.dropped ? `${plural(r.dropped, 'lesson')} can’t come: past the end of this year, or its school, grade or template isn’t in this year.` : null,
  ].filter(Boolean);
  const bring = () => {
    close();
    const done = bringWeeks(from);
    toast(`Brought ${plural(done.kept, 'lesson')} from ${plan.name}.`, { label: 'Undo', run: undo });
  };
  return [
    h('p', {}, r.kept ? `${plural(r.kept, 'lesson')} from ${plan.name} will go into empty weeks.` : `Nothing from ${plan.name} fits into an empty week here.`),
    notes.length ? h('ul', { class: 'hint' }, notes.map((n) => h('li', {}, n))) : null,
    h('div', { class: 'button-row end' },
      h('button', { class: 'btn light', onclick: () => openAgain(body, close) }, 'Back'),
      h('button', { class: 'btn', disabled: !r.kept, onclick: bring }, r.kept ? `Bring ${plural(r.kept, 'lesson')}` : 'Nothing to bring')),
  ];
}

async function openAgain(body, close) {
  body.replaceChildren(...choosePlan(await otherPlans(), body, close));
}

const closeRow = (close) => h('div', { class: 'button-row end' }, h('button', { class: 'btn light', onclick: close }, 'Close'));
