// Lesson Templates: "📅 Add to planner ▾" beside the Folder box — put the lesson shown into a week of the
// Lesson Schedule without going there (a sure way when the schedule's search doesn't bring the lesson up).
// Pick the class (school · grade, starts on the one the Lesson Schedule shows), then click a week:
// the lesson goes last in that week, one Undo step.

import { h, toast } from '../dom.js';
import { find } from '../model.js';
import { addWeekLesson, teachingWeeks, weekChoices } from '../weekPlan.js';
import { commit, setUi, store, undo } from '../store.js';
import { todayISO } from '../dates.js';
import { current, pickId, popMenu, year } from './common.js';

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** Every class of the year (each school × each grade). */
function classes() {
  const grades = current('grades');
  return current('schools').flatMap((s) => grades.map((g) => ({
    key: `${s.id}|${g.id}`, schoolId: s.id, gradeId: g.id, label: `${s.name} · ${g.name}`,
  })));
}

export function addToPlannerMenu(lesson) {
  const all = classes();
  if (!all.length) {
    return h('button', { class: 'btn light', disabled: true, 'data-tip': 'Add a school and a grade under Setup › School Year first.' }, '📅 Add to planner');
  }
  const startKey = `${pickId(current('schools'), store.ui.schoolId)}|${pickId(current('grades'), store.ui.gradeId)}`;
  let cls = all.find((c) => c.key === startKey) ?? all[0];
  const weeksBox = h('div', { class: 'atp-weeks', 'data-tour': 'atp-weeks' });
  const draw = () => weeksBox.replaceChildren(...weekButtons(lesson, cls));
  draw();
  const picker = h('label', { class: 'atp-class' }, h('span', { class: 'mini-label' }, 'Class'),
    h('select', {
      'data-tour': 'atp-class',
      onchange: (e) => { cls = all.find((c) => c.key === e.target.value); draw(); },
    }, all.map((c) => h('option', { value: c.key, selected: c === cls }, c.label))));
  const menu = popMenu({
    label: '📅 Add to planner ▾', title: 'Put this lesson into a week of the Lesson Schedule', summaryClass: 'btn light',
    menuClass: 'add-to-planner', tour: 'deck-add-to-planner',
  }, h('div', { class: 'menu-group' }, 'Add to which week?'), picker, weeksBox);
  menu.dataset.edit = 'hide';
  menu.addEventListener('toggle', () => showThisWeek(menu, weeksBox));
  return menu;
}

/** Opening the menu scrolls its week list (not the page) to this week. */
function showThisWeek(menu, box) {
  const now = box.querySelector('.this-week');
  if (menu.open && now) box.scrollTop = now.offsetTop - box.offsetTop - box.clientHeight / 2;
}

function weekButtons(lesson, cls) {
  const choices = weekChoices(store.state, { yearId: year().id, schoolId: cls.schoolId, gradeId: cls.gradeId }, teachingWeeks(store.state, year().id), todayISO());
  return choices.map((w) => h('button', {
    class: `menu-item atp-week${w.thisWeek ? ' this-week' : ''}`,
    title: w.count ? `Already planned that week: ${plural(w.count, 'lesson')}. This one goes last.` : null,
    onclick: (e) => { e.target.closest('details').open = false; addTo(lesson, cls, w); },
  },
  h('strong', {}, `Week ${w.number}`),
  h('span', { class: 'atp-dates' }, w.dates),
  w.thisWeek ? h('span', { class: 'atp-now' }, 'this week') : null,
  w.count ? h('span', { class: 'count-badge' }, w.count) : null));
}

function addTo(lesson, cls, week) {
  commit((s) => addWeekLesson(s, { yearId: year().id, schoolId: cls.schoolId, gradeId: cls.gradeId, weekStart: week.weekStart, lessonId: lesson.id }));
  setUi({ schoolId: cls.schoolId, gradeId: cls.gradeId });
  toast(`Added “${find(store.state, 'lessons', lesson.id)?.name ?? lesson.name}” to Week ${week.number} for ${cls.label}.`, { label: 'Undo', run: undo });
}
