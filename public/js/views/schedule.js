// "Instrument Schedule": drag an instrument for a school onto a day, then
// stretch it over the dates it's there. Bars are colored by instrument and
// labeled "Instrument@School".

import { h, toast } from '../dom.js';
import { addInstrumentBlock, find, inYear, moveRange, remove, resizeRange, shiftSchoolDay } from '../model.js';
import { commit, setUi, store, undo } from '../store.js';
import { addDays, daysBetween } from '../dates.js';
import { current, emptyNote, monthNav, pills, stepMonth, year } from './common.js';
import { barCalendar } from './barCalendar.js';

const ALL = 'all';

function context() {
  const schools = current('schools');
  const filter = schools.some((s) => s.id === store.ui.scheduleFilter) ? store.ui.scheduleFilter : ALL;
  return {
    yearId: year().id,
    schools,
    instruments: current('instruments'),
    filter,
    shownSchools: filter === ALL ? schools : schools.filter((s) => s.id === filter),
  };
}

const instrumentOf = (b) => find(store.state, 'instruments', b.instrumentId);
const schoolOf = (b) => find(store.state, 'schools', b.schoolId);
const blockName = (b) => `${instrumentOf(b)?.name}@${schoolOf(b)?.name}`;

export function renderSchedule() {
  const ctx = context();
  if (!ctx.schools.length || !ctx.instruments.length) {
    return emptyNote('Add at least one school and one instrument on the Setup tab first.');
  }
  // Order by school so each school's bars sit in the same row week to week.
  const schoolOrder = new Map(ctx.shownSchools.map((s, i) => [s.id, i]));
  const items = inYear(store.state, 'instrumentBlocks', ctx.yearId)
    .filter((b) => schoolOrder.has(b.schoolId))
    .sort((a, b) => schoolOrder.get(a.schoolId) - schoolOrder.get(b.schoolId));
  return h('div', { class: 'schedule-layout' },
    sidebar(ctx),
    h('section', { class: 'main-col card' },
      monthNav(),
      armedBanner(),
      barCalendar({
        gridClass: 'schedule-grid',
        items,
        selectedId: store.ui.blockId,
        armed: Boolean(store.ui.armedBlock),
        colorOf: (b) => instrumentOf(b)?.color,
        titleOf: blockName,
        labelOf: (b) => h('span', { class: 'chip-title' }, blockName(b)),
        onCreate: (data, date) => { if (data.instrumentId) addBlock(ctx, data, date); },
        onMove: (b, startDate, copy) => (copy
          ? addBlock(ctx, b, startDate, addDays(startDate, daysBetween(b.startDate, b.endDate)))
          : commit((s) => moveRange(s, 'instrumentBlocks', b.id, startDate))),
        onResize: (b, edge, date) => commit((s) => resizeRange(s, 'instrumentBlocks', b.id, { [edge]: date })),
        onSelect: (b) => setUi({ blockId: b?.id ?? null }),
        onRemove: removeBlock,
        onArmedClick: (date) => addBlock(ctx, store.ui.armedBlock, date),
      })),
  );
}

function addBlock(ctx, { schoolId, instrumentId }, startDate, endDate = startDate) {
  const block = commit((s) => addInstrumentBlock(s, { yearId: ctx.yearId, schoolId, instrumentId, startDate, endDate }));
  setUi({ blockId: block.id });
}

function removeBlock(b) {
  commit((s) => remove(s, 'instrumentBlocks', b.id));
  toast(`Removed ${blockName(b)}.`, { label: 'Undo', run: undo });
}

// ---------- left side ----------

function sidebar(ctx) {
  return h('aside', { class: 'side card' },
    h('h3', {}, 'Show'),
    pills([{ id: ALL, name: 'All schools' }, ...ctx.schools], ctx.filter, (id) => setUi({ scheduleFilter: id })),
    h('h3', {}, 'Instruments'),
    h('p', { class: 'hint' }, 'Drag onto the first day, then drag the end of the bar to the last day. Or click one, then click days.'),
    ctx.shownSchools.map((school) => h('section', { class: 'palette-school' },
      h('div', { class: 'palette-school-name' }, school.name),
      h('div', { class: 'instrument-chips' }, ctx.instruments.map((ins) => instrumentChip(school, ins))))),
  );
}

function instrumentChip(school, instrument) {
  const armed = store.ui.armedBlock?.schoolId === school.id && store.ui.armedBlock?.instrumentId === instrument.id;
  const data = { schoolId: school.id, instrumentId: instrument.id };
  return h('div', {
    class: `instrument-chip ${armed ? 'armed' : ''}`,
    draggable: 'true',
    style: { '--chip': instrument.color },
    title: `${instrument.name}@${school.name} — drag onto the calendar, or click to place on several days`,
    ondragstart: (e) => e.dataTransfer.setData('text/plain', JSON.stringify(data)),
    onclick: () => setUi({ armedBlock: armed ? null : data }),
  }, instrument.name);
}

function armedBanner() {
  const armed = store.ui.armedBlock;
  if (!armed) return null;
  return h('div', { class: 'armed-banner' },
    `Click days to add ${blockName(armed)}.`,
    h('button', { class: 'btn small light', onclick: () => setUi({ armedBlock: null }) }, 'Done (Esc)'));
}

// ---------- keyboard ----------

function selectedBlock() {
  return find(store.state, 'instrumentBlocks', store.ui.blockId);
}

/** Shift+→ adds a school day to the selected bar, Shift+← takes one away. */
function stretchSelected(direction) {
  const b = selectedBlock();
  if (!b) return stepMonth(direction);
  const endDate = shiftSchoolDay(b.endDate, direction);
  if (endDate < b.startDate) return null;
  return commit((s) => resizeRange(s, 'instrumentBlocks', b.id, { endDate }));
}

function removeSelected() {
  const b = selectedBlock();
  if (b) removeBlock(b);
}

const KEYS = {
  ArrowLeft: (e) => (e.shiftKey ? stretchSelected(-1) : stepMonth(-1)),
  ArrowRight: (e) => (e.shiftKey ? stretchSelected(1) : stepMonth(1)),
  Escape: () => setUi({ armedBlock: null, blockId: null }),
  Delete: removeSelected,
  Backspace: removeSelected,
};

export function scheduleKeys(e) {
  if (!KEYS[e.key]) return false;
  KEYS[e.key](e);
  return true;
}
