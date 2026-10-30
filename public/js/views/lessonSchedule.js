// "Lesson Schedule": every school week of the year as a row. Drag lesson decks from the
// library on the right into a week, put them in order, move them between weeks, or drag
// them back to the library to take them off. Rows show that week's evals (by outcome color)
// and which instruments are at the school.

import { h, iconButton, openModal, toast } from '../dom.js';
import { evalLabel, find, inYear, lessonInstruments, outcomeLabel } from '../model.js';
import {
  addWeekLesson, autoFillWeek, autoFillWeeks, entryOutcome, filterLessons, instrumentsInWeek, missingInstruments,
  moveWeekLesson, placementsInWeek, removeWeekLesson, schoolWeeks, weekLessonsFor,
} from '../weekPlan.js';
import { commit, setUi, store, undo } from '../store.js';
import { formatRange, todayISO } from '../dates.js';
import { contextMenu, current, emptyNote, gradePills, instrumentTag, pickId, pills, year } from './common.js';
import { driveOpenLabel, driveOpenUrl, findLocation } from '../locations.js';
import { copiesOfLesson } from '../exportBridge.js';
import { outcomeColor } from './plan.js';
import { slideCanvas } from './lessonPreview.js';

const NO_EVAL_COLOR = '#9a8b7a';

function context() {
  const schools = current('schools');
  const grades = current('grades');
  const cls = { yearId: year().id, schoolId: pickId(schools, store.ui.schoolId), gradeId: pickId(grades, store.ui.gradeId) };
  return { schools, grades, cls, weeks: schoolWeeks(year()) };
}

const name = (collection, id) => find(store.state, collection, id)?.name ?? '';

export function renderLessonSchedule() {
  const ctx = context();
  if (!ctx.schools.length || !ctx.grades.length) {
    return emptyNote('Add at least one school and one grade under Setup › School Year to start planning.');
  }
  const today = todayISO();
  return h('div', { class: 'ls-layout' },
    h('section', { class: 'main-col card' },
      header(ctx),
      h('div', { class: 'ls-weeks' }, ctx.weeks.map((w) => weekRow(ctx, w, w.weekStart <= today && today <= w.friday)))),
    palette(ctx),
  );
}

/** Opening the tab scrolls to this week. */
export function showThisWeek() {
  document.querySelector('.ls-week.this-week')?.scrollIntoView({ block: 'center' });
}

// ---------- header: class picker, auto-fill ----------

function header(ctx) {
  return h('div', { class: 'ls-head' },
    h('div', { class: 'ls-head-row' },
      h('div', { class: 'ls-pick' }, h('span', { class: 'mini-label' }, 'School ', h('kbd', { title: 'Press [ or ] to switch school' }, '[ ]')),
        pills(ctx.schools, ctx.cls.schoolId, (id) => setUi({ schoolId: id }))),
      h('div', { class: 'ls-pick' }, h('span', { class: 'mini-label' }, 'Grade ', h('kbd', { title: 'Press the grade’s number key (K = 0)' }, '0–5')),
        gradePills(ctx.grades, ctx.cls.gradeId, (id) => setUi({ gradeId: id }))),
      h('button', {
        class: 'btn ls-fill', onclick: () => openAutoFill(ctx),
        'data-tip': 'Puts each eval’s lessons, in order, into the weeks it’s on the Outcome & Eval Calendar.',
      }, '✨ Fill from Outcome & Eval Calendar')),
    armedBanner());
}

function armedBanner() {
  const armed = store.ui.lsArmed;
  if (!armed) return h('p', { class: 'hint' }, 'Drag lessons from the list on the right into a week. Drag them to put them in order, to another week, or back to the list to take them off.');
  return h('div', { class: 'armed-banner' },
    `Click weeks to add “${name('lessons', armed.lessonId)}”.`,
    h('button', { class: 'btn small light', onclick: () => setUi({ lsArmed: null }) }, 'Done (Esc)'));
}

function openAutoFill(ctx) {
  const label = `${name('schools', ctx.cls.schoolId)} · ${name('grades', ctx.cls.gradeId)}`;
  openModal('Fill from the Outcome & Eval Calendar', (close) => h('div', { class: 'modal-body' },
    h('p', {}, 'Each eval’s lessons go into the weeks it’s on the calendar, in teaching order. '
      + 'This replaces what’s already in those classes’ weeks (you can undo).'),
    h('div', { class: 'button-row end' },
      h('button', { class: 'btn light', onclick: close }, 'Cancel'),
      h('button', { class: 'btn light', onclick: () => { close(); autoFill(ctx, allClasses(ctx)); } }, 'Every school & grade'),
      h('button', { class: 'btn', onclick: () => { close(); autoFill(ctx, [ctx.cls]); } }, `Just ${label}`))));
}

function allClasses(ctx) {
  return ctx.schools.flatMap((s) => ctx.grades.map((g) => ({ yearId: ctx.cls.yearId, schoolId: s.id, gradeId: g.id })));
}

function autoFill(ctx, classes) {
  const count = commit((s) => classes.reduce((sum, cls) => sum + autoFillWeeks(s, cls, ctx.weeks), 0));
  toast(count ? `Filled in ${count} lesson${count === 1 ? '' : 's'}.` : 'No evals with lessons on the calendar for this yet.',
    count ? { label: 'Undo', run: undo } : null);
}

/** The ✨ at the top right of a week: fill just this week from the calendar. */
function weekFillButton(ctx, week, hasLessons) {
  const tip = `Fill Week ${week.number} from the Outcome & Eval Calendar${hasLessons ? ' (replaces this week’s lessons — you can undo)' : ''}`;
  return h('button', {
    class: 'ls-week-fill', 'aria-label': tip, 'data-tip': tip,
    onclick: () => {
      const count = commit((s) => autoFillWeek(s, ctx.cls, ctx.weeks, week.weekStart));
      toast(count ? `Filled Week ${week.number} with ${count} lesson${count === 1 ? '' : 's'}.` : 'The evals this week don’t have lessons yet.',
        count ? { label: 'Undo', run: undo } : null);
    },
  }, '✨');
}

// ---------- the weeks ----------

function weekRow(ctx, week, isThisWeek) {
  const placements = placementsInWeek(store.state, ctx.cls, week);
  const entries = weekLessonsFor(store.state, ctx.cls, week.weekStart);
  const colors = [...new Set(placements.map((p) => outcomeColor(find(store.state, 'criteria', p.criterionId)?.outcomeId)))];
  return h('div', {
    class: `ls-week ${isThisWeek ? 'this-week' : ''} ${colors.length ? 'has-eval' : ''}`,
    style: { '--week': colors[0] }, dataset: { week: week.weekStart },
  },
    h('div', { class: 'ls-stripe', 'aria-hidden': 'true' }, colors.map((c) => h('span', { style: { background: c } }))),
    h('div', { class: 'ls-label' },
      h('strong', {}, `Week ${week.number}`),
      h('small', {}, week.days.length ? formatRange(week.days[0], week.days.at(-1)) : formatRange(week.weekStart, week.friday))),
    h('div', { class: 'ls-body' },
      h('div', { class: 'ls-info' }, placements.map(evalTag), instrumentTags(ctx, week),
        placements.length ? weekFillButton(ctx, week, entries.length) : null),
      dropZone(ctx, week, entries, placements)),
  );
}

function evalTag(p) {
  const criterion = find(store.state, 'criteria', p.criterionId);
  const outcome = find(store.state, 'outcomes', criterion?.outcomeId);
  return h('span', {
    class: 'ls-eval', style: { '--chip': outcomeColor(outcome?.id) },
    'data-tip': `${outcomeLabel(outcome)}\n${criterion?.title}\n${formatRange(p.startDate, p.endDate)}`,
  }, h('span', { class: 'chip-code' }, outcome?.code || '•'), h('span', { class: 'chip-title' }, criterion?.title));
}

function instrumentTags(ctx, week) {
  const list = instrumentsInWeek(store.state, ctx.cls, week);
  if (!list.length) return h('span', { class: 'ls-no-ins', 'data-tip': 'No instruments at this school this week' }, 'no instruments');
  return list.map(({ instrumentId, days, allWeek }) => {
    const ins = find(store.state, 'instruments', instrumentId);
    const tip = allWeek ? `${ins?.name} is here all week` : `${ins?.name} is here only ${days.map(dayName).join(', ')}`;
    return instrumentTag(ins, { label: allWeek ? ins?.name : `${ins?.name} (part)`, tip, part: !allWeek });
  });
}

function dayName(iso) {
  return ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][new Date(`${iso}T00:00:00Z`).getUTCDay()];
}

function dropZone(ctx, week, entries, placements) {
  const armed = store.ui.lsArmed;
  return h('div', {
    class: `ls-zone ${armed ? 'stampable' : ''}`,
    ondragover: (e) => { e.preventDefault(); showMarker(e.currentTarget, e.clientX); },
    ondragleave: (e) => { if (!e.currentTarget.contains(e.relatedTarget)) clearMarker(e.currentTarget); },
    ondrop: (e) => onDrop(ctx, week, e),
    onclick: armed ? (e) => { if (!e.target.closest('.ls-card')) add(ctx, week, armed); } : null,
  },
  entries.length ? entries.map((entry, i) => entryCard(entry, i, week, placements)) : h('span', { class: 'ls-drop-hint' }, 'Drop lessons here'));
}

function entryCard(entry, index, week, placements) {
  const lesson = find(store.state, 'lessons', entry.lessonId);
  const outcome = entryOutcome(store.state, entry, placements);
  const missing = missingInstruments(store.state, entry, week).map((id) => name('instruments', id));
  const tip = [lesson?.name, outcome ? outcomeLabel(outcome) : 'Not part of an eval this week',
    missing.length ? `⚠ ${missing.join(', ')} isn’t at the school this week` : null].filter(Boolean).join('\n');
  return h('div', {
    class: `ls-card ${missing.length ? 'has-warn' : ''}`, draggable: 'true',
    style: { '--chip': outcome ? outcomeColor(outcome.id) : NO_EVAL_COLOR }, 'data-tip': tip,
    ondragstart: (e) => e.dataTransfer.setData('text/plain', JSON.stringify({ entryId: entry.id })),
    onclick: (e) => { if (!e.target.closest('.ls-x')) cardMenu(e, entry, lesson); },
  },
  h('div', { class: 'ls-thumb' }, slideCanvas(lesson)),
  h('div', { class: 'ls-card-caption' },
    h('span', { class: 'slide-num' }, index + 1),
    missing.length ? h('span', { class: 'warn', 'aria-label': 'Instrument warning' }, '⚠') : null,
    h('span', { class: 'chip-title' }, lesson?.name)),
  iconButton('×', 'Take off this week', () => takeOff(entry), 'ls-x'));
}

/** Clicking a lesson: go to its template, open it or this week's copy, or take it off the week. */
function cardMenu(e, entry, lesson) {
  if (!lesson) return;
  const template = findLocation(lesson, 'drive');
  const copy = copiesOfLesson(lesson.id).find((c) => c.copy.entryId === entry.id);
  const open = (url) => window.open(url, '_blank', 'noopener');
  contextMenu(e, [
    { icon: '🖼️', label: 'Go to the lesson template', run: () => setUi({ tab: 'lessons', lessonId: lesson.id, deckFolderId: lesson.folderId, lessonSearch: '' }) },
    template ? { icon: '☁️', label: `${driveOpenLabel(template, 'Template')} ↗`, run: () => open(driveOpenUrl(template)) } : null,
    copy?.url ? { icon: '📄', label: 'Open this week’s copy ↗', run: () => open(copy.url) } : null,
    { icon: '×', label: 'Take off this week', run: () => takeOff(entry) },
  ].filter(Boolean));
}

// ---------- drag & drop ----------

function cardsIn(zone) {
  return [...zone.querySelectorAll('.ls-card')];
}

/** Where a drop at clientX lands among the week's cards (0 = first). */
function dropIndex(zone, clientX) {
  return cardsIn(zone).filter((c) => { const r = c.getBoundingClientRect(); return r.left + r.width / 2 < clientX; }).length;
}

function showMarker(zone, clientX) {
  zone.classList.add('drop-target');
  const marker = zone.querySelector('.ls-marker') || h('span', { class: 'ls-marker' });
  const cards = cardsIn(zone);
  zone.insertBefore(marker, cards[dropIndex(zone, clientX)] || null);
}

function clearMarker(zone) {
  zone.classList.remove('drop-target');
  zone.querySelector('.ls-marker')?.remove();
}

function readDrag(e) {
  try { return JSON.parse(e.dataTransfer.getData('text/plain')); } catch { return {}; }
}

function onDrop(ctx, week, e) {
  e.preventDefault();
  const zone = e.currentTarget;
  const index = dropIndex(zone, e.clientX);
  clearMarker(zone);
  const data = readDrag(e);
  if (data.entryId) commit((s) => moveWeekLesson(s, data.entryId, week.weekStart, index));
  else if (data.lessonId) add(ctx, week, data, index);
}

function add(ctx, week, { lessonId, criterionId }, index) {
  commit((s) => addWeekLesson(s, { ...ctx.cls, weekStart: week.weekStart, lessonId, criterionId, index }));
}

function takeOff(entry) {
  commit((s) => removeWeekLesson(s, entry.id));
  toast(`Took “${name('lessons', entry.lessonId)}” off the week.`, { label: 'Undo', run: undo });
}

// ---------- right side: the lesson library ----------

let paletteScroll = 0;

function filters() {
  const ui = store.ui;
  return { search: ui.lsSearch || '', category: ui.lsCategory || '', gradeId: ui.lsGrade || '', outcomeId: ui.lsOutcome || '', criterionId: ui.lsEval || '' };
}

function palette(ctx) {
  const f = filters();
  const items = filterLessons(store.state, ctx.cls.yearId, f);
  const list = h('div', { class: 'ls-list', onscroll: (e) => { paletteScroll = e.target.scrollTop; } },
    items.length ? items.map((item) => paletteItem(ctx, item)) : emptyNote('No lessons match.'));
  queueMicrotask(() => { list.scrollTop = paletteScroll; });
  return h('aside', {
    class: 'side card ls-palette',
    ondragover: (e) => e.preventDefault(),
    ondrop: (e) => { e.preventDefault(); const { entryId } = readDrag(e); if (entryId) takeOff(find(store.state, 'weekLessons', entryId)); },
  },
  h('h3', {}, 'Lesson templates', h('span', { class: 'count-badge' }, items.length)),
  h('input', {
    class: 'search', type: 'search', placeholder: '🔍 Search lessons…', value: f.search,
    dataset: { key: 'ls-search' }, oninput: (e) => setUi({ lsSearch: e.target.value }),
  }),
  filterSelects(ctx, f),
  list);
}

function filterSelect(label, key, value, options) {
  return h('label', { class: 'mini-select' }, label,
    h('select', { dataset: { key: `ls-${key}` }, onchange: (e) => setUi({ [key]: e.target.value }) },
      h('option', { value: '' }, 'Any'),
      options.map(([id, text]) => h('option', { value: id, selected: id === value }, text))));
}

function filterSelects(ctx, f) {
  const outcomes = current('outcomes');
  const criteria = store.state.criteria.filter((c) => outcomes.some((o) => o.id === c.outcomeId)
    && (!f.outcomeId || c.outcomeId === f.outcomeId) && (!f.gradeId || c.gradeIds.includes(f.gradeId)));
  const categories = [...new Set(inYear(store.state, 'lessons', ctx.cls.yearId).map((l) => l.category).filter(Boolean))].sort();
  const anyOn = Object.entries(f).some(([k, v]) => k !== 'search' && v);
  return h('div', { class: 'ls-filters' },
    filterSelect('Grade', 'lsGrade', f.gradeId, ctx.grades.map((g) => [g.id, g.name])),
    filterSelect('Outcome', 'lsOutcome', f.outcomeId, outcomes.map((o) => [o.id, outcomeLabel(o)])),
    filterSelect('Eval', 'lsEval', f.criterionId, criteria.map((c) => [c.id, evalLabel(store.state, c)])),
    categories.length ? filterSelect('Category', 'lsCategory', f.category, categories.map((c) => [c, c])) : null,
    anyOn ? h('button', { class: 'btn small light', onclick: () => setUi({ lsGrade: '', lsOutcome: '', lsEval: '', lsCategory: '' }) }, 'Clear filters') : null);
}

function paletteItem(ctx, { lesson, criterionId }) {
  const armed = store.ui.lsArmed?.lessonId === lesson.id && (store.ui.lsArmed?.criterionId ?? null) === criterionId;
  const used = store.state.weekLessons.filter((e) => e.lessonId === lesson.id && e.schoolId === ctx.cls.schoolId && e.gradeId === ctx.cls.gradeId).length;
  const data = { lessonId: lesson.id, criterionId };
  return h('div', {
    class: `ls-item ${armed ? 'armed' : ''}`, draggable: 'true',
    title: armed ? 'Click again to stop adding' : 'Drag into a week, or click, then click weeks',
    ondragstart: (e) => e.dataTransfer.setData('text/plain', JSON.stringify(data)),
    onclick: () => setUi({ lsArmed: armed ? null : data }),
  },
  h('div', { class: 'ls-thumb' }, slideCanvas(lesson)),
  h('div', { class: 'ls-item-text' },
    h('div', { class: 'ls-item-name' }, h('span', {}, lesson.name),
      used ? h('span', { class: 'count', title: `In this class’s schedule ${used}×` }, used) : null),
    h('div', { class: 'ls-item-meta' }, lesson.category ? h('span', { class: 'ls-cat' }, lesson.category) : null,
      lessonInstruments(store.state, lesson).map((i) => instrumentTag(i)))));
}

// ---------- keyboard ----------

function cycleSchool(step) {
  const { schools, cls } = context();
  const i = schools.findIndex((s) => s.id === cls.schoolId);
  setUi({ schoolId: schools[(i + step + schools.length) % schools.length].id });
}

const KEYS = {
  '[': () => cycleSchool(-1),
  ']': () => cycleSchool(1),
  Escape: () => setUi({ lsArmed: null }),
};

/** [ ] switch school, 0–5 switch grade, Esc stops click-to-add. Returns true if handled. */
export function lessonScheduleKeys(e) {
  const grade = /^[0-9]$/.test(e.key) ? context().grades[Number(e.key)] : null;
  if (grade) setUi({ gradeId: grade.id });
  else if (KEYS[e.key]) KEYS[e.key]();
  return Boolean(grade || KEYS[e.key]);
}
