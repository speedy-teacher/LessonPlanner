// Assistant commands for Setup › Outcomes, Evals & Lesson Order: essential outcomes,
// their eval criteria (with grades) and each eval's lessons in teaching order. See agentCommands.js.

import { add, addStep, copyOrder, moveStep, nextColor, remove, setGrades, stepsFor, update } from './model.js';
import { addDeck } from './library.js';
import {
  color, evalInfo, evalOf, fail, grade, idsOf, indexOf, lesson, listOf, ofYear, orderGrades, outcome, patchFrom, text, year, yearCriteria,
} from './agentHelpers.js';

/** A main grade for an eval: one of its grades, or null for "none". */
function mainGradeOf(state, c, ref) {
  if (ref === null || String(ref).trim().toLowerCase() === 'none') return null;
  const [gradeId] = orderGrades(state, c, ref);
  return gradeId;
}

const GRADE_PARAM = ['Only this grade\'s lesson order (each grade has its own); default every grade of the eval'];

/** A lesson by name; with `create`, a new lesson template is made when none has that name. */
function lessonOrNew(state, ref, create) {
  const known = ofYear(state, 'lessons').some((l) => l.id === ref || l.name.trim().toLowerCase() === String(ref).trim().toLowerCase());
  if (known || !create) return lesson(state, ref);
  return addDeck(state, { yearId: year(state).id, name: text(ref, 'lesson name') });
}

export const OUTCOME_COMMANDS = {
  listOutcomes: {
    summary: 'Essential outcomes with their evals (grades and lessons in teaching order).',
    params: {},
    run: (state) => ofYear(state, 'outcomes').map((o) => ({
      id: o.id, code: o.code, title: o.title, color: o.color,
      evals: yearCriteria(state).filter((c) => c.outcomeId === o.id).map((c) => evalInfo(state, c)),
    })),
  },
  listEvals: {
    summary: 'Eval criteria with their outcome, grades and lessons in teaching order (each grade has its own order).',
    params: { grade: ['Only evals for this grade, with that grade\'s lesson order'], outcome: ['Only evals of this outcome'] },
    run: (state, a) => {
      const g = a.grade ? grade(state, a.grade) : null;
      const o = a.outcome ? outcome(state, a.outcome) : null;
      return yearCriteria(state)
        .filter((c) => (!g || c.gradeIds.includes(g.id)) && (!o || c.outcomeId === o.id))
        .map((c) => evalInfo(state, c, g?.id));
    },
  },
  addOutcome: {
    summary: 'Add an essential outcome.',
    changes: true,
    params: { title: ['e.g. Steady beat', true], code: ['e.g. MU1'], color: ['Color like #6b8f5e; default a free one'] },
    run: (state, a) => {
      const yearId = year(state).id;
      const o = add(state, 'outcomes', {
        yearId, code: a.code ?? '', title: text(a.title, 'title'), color: a.color ? color(a.color) : nextColor(state, 'outcomes', yearId),
      });
      return { id: o.id, done: `Added the outcome ${o.title}.` };
    },
  },
  editOutcome: {
    summary: 'Change an outcome\'s code, title or color.',
    changes: true,
    params: { outcome: ['Its code or title', true], code: ['New code'], title: ['New title'], color: ['New color'] },
    run: (state, a) => {
      const o = outcome(state, a.outcome);
      update(state, 'outcomes', o.id, patchFrom(a, { code: String, title: (v) => text(v, 'title'), color }));
      return { done: `Updated ${o.title}.` };
    },
  },
  deleteOutcome: {
    summary: 'Delete an outcome with its evals (they leave the calendar too). Lesson templates are kept.',
    changes: true,
    params: { outcome: ['Its code or title', true] },
    run: (state, a) => {
      const o = outcome(state, a.outcome);
      remove(state, 'outcomes', o.id);
      return { done: `Deleted ${o.title}.` };
    },
  },
  addEval: {
    summary: 'Add an eval criterion to an outcome, optionally with its grades and lessons (new lesson templates are made for lesson names not found).',
    changes: true,
    params: { outcome: ['Code or title', true], title: ['The eval', true], grades: ['Grade names'], lessons: ['Lesson names in teaching order'] },
    run: (state, a) => {
      const c = add(state, 'criteria', { outcomeId: outcome(state, a.outcome).id, title: text(a.title, 'title'), gradeIds: idsOf(state, a.grades, grade) });
      listOf(a.lessons).forEach((ref) => addStep(state, c.id, lessonOrNew(state, ref, true).id));
      return { ...evalInfo(state, c), done: `Added the eval ${c.title}.` };
    },
  },
  editEval: {
    summary: 'Rename an eval, move it to another outcome, change its grades, or set the main grade it is for (its title takes that grade\'s color).',
    changes: true,
    params: {
      eval: ['Its title', true], title: ['New title'], outcome: ['Move to this outcome'],
      grades: ['The full list of grades (replaces them)'], addGrades: ['Grades to add'], removeGrades: ['Grades to take off'],
      mainGrade: ['One of its grades, or "none" to clear'],
    },
    run: (state, a) => {
      const c = evalOf(state, a.eval);
      const patch = patchFrom(a, { title: (v) => text(v, 'title') });
      if (a.outcome) patch.outcomeId = outcome(state, a.outcome).id;
      const base = a.grades === undefined ? c.gradeIds : idsOf(state, a.grades, grade);
      const off = new Set(idsOf(state, a.removeGrades, grade));
      setGrades(state, c.id, [...new Set([...base, ...idsOf(state, a.addGrades, grade)])].filter((id) => !off.has(id)));
      if (a.mainGrade !== undefined) patch.mainGradeId = mainGradeOf(state, c, a.mainGrade);
      update(state, 'criteria', c.id, patch);
      return evalInfo(state, c);
    },
  },
  deleteEval: {
    summary: 'Delete an eval (it leaves the calendar too; scheduled lessons stay). Lesson templates are kept.',
    changes: true,
    params: { eval: ['Its title', true] },
    run: (state, a) => {
      const c = evalOf(state, a.eval);
      remove(state, 'criteria', c.id);
      return { done: `Deleted the eval ${c.title}.` };
    },
  },
  setEvalLessons: {
    summary: 'Set an eval\'s whole lesson list in teaching order (replaces it). New lesson templates are made for names not found when createMissing is true.',
    changes: true,
    params: {
      eval: ['Its title', true], lessons: ['Lesson names in teaching order', true], grade: GRADE_PARAM, createMissing: ['true to make new lesson templates'],
    },
    run: (state, a) => {
      const c = evalOf(state, a.eval);
      const grades = orderGrades(state, c, a.grade);
      const ids = listOf(a.lessons).map((ref) => lessonOrNew(state, ref, a.createMissing === true).id);
      for (const g of grades) {
        stepsFor(state, c.id, g).forEach((s) => remove(state, 'criterionLessons', s.id));
        ids.forEach((id) => addStep(state, c.id, id, g));
      }
      return evalInfo(state, c);
    },
  },
  addLessonToEval: {
    summary: 'Add a lesson to an eval\'s teaching order (a new lesson template is made if createMissing is true and none has that name).',
    changes: true,
    params: {
      eval: ['Its title', true], lesson: ['Lesson name', true], grade: GRADE_PARAM,
      position: ['Place in the order (1 = first); default last'], createMissing: ['true to make a new lesson template'],
    },
    run: (state, a) => {
      const c = evalOf(state, a.eval);
      const grades = orderGrades(state, c, a.grade);
      const lessonId = lessonOrNew(state, a.lesson, a.createMissing === true).id;
      for (const g of grades) {
        const step = addStep(state, c.id, lessonId, g);
        if (indexOf(a.position) !== undefined) moveStep(state, step.id, indexOf(a.position));
      }
      return evalInfo(state, c);
    },
  },
  removeLessonFromEval: {
    summary: 'Take a lesson out of an eval\'s teaching order (the template is kept).',
    changes: true,
    params: { eval: ['Its title', true], lesson: ['Lesson name', true], grade: GRADE_PARAM },
    run: (state, a) => {
      const c = evalOf(state, a.eval);
      const l = lesson(state, a.lesson);
      const steps = orderGrades(state, c, a.grade).flatMap((g) => stepsFor(state, c.id, g)).filter((s) => s.lessonId === l.id);
      if (!steps.length) fail(`${l.name} isn't in ${c.title}.`);
      steps.forEach((s) => remove(state, 'criterionLessons', s.id));
      return evalInfo(state, c);
    },
  },
  copyEvalOrder: {
    summary: 'Give other grades of an eval the same lesson order as one grade (replaces theirs).',
    changes: true,
    params: { eval: ['Its title', true], from: ['The grade to copy', true], to: ['Grades to change; default every other grade of the eval'] },
    run: (state, a) => {
      const c = evalOf(state, a.eval);
      const [from] = orderGrades(state, c, a.from);
      const to = a.to === undefined ? c.gradeIds : listOf(a.to).flatMap((ref) => orderGrades(state, c, ref));
      copyOrder(state, c.id, from, to);
      return evalInfo(state, c);
    },
  },
};
