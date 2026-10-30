// An eval's "own" grade: the main grade the teacher picked for it, or its only grade.
// Its title wears that grade's color, and the calendar's "All" view colors it by that grade.
// Shared by the browser and the tests.

import { find } from './model.js';

/** Make `gradeId` the eval's main grade, or clear it when it already is (it must be one of the eval's grades). */
export function toggleMainGrade(state, criterionId, gradeId) {
  const crit = find(state, 'criteria', criterionId);
  if (!crit) return;
  if (crit.mainGradeId === gradeId || !crit.gradeIds.includes(gradeId)) crit.mainGradeId = null;
  else crit.mainGradeId = gradeId;
}

/** The grade an eval is colored by: its main grade, otherwise its only grade, otherwise null. */
export function evalGradeId(criterion) {
  if (!criterion) return null;
  if (criterion.gradeIds.includes(criterion.mainGradeId)) return criterion.mainGradeId;
  return criterion.gradeIds.length === 1 ? criterion.gradeIds[0] : null;
}

/** That grade's color, or null. */
export function evalColor(state, criterion) {
  return find(state, 'grades', evalGradeId(criterion))?.color ?? null;
}

/** Black or white text, whichever reads better on a background color like #6b8f5e. */
export function readableText(hex) {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(String(hex).slice(i, i + 2), 16) / 255)
    .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  const light = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  // 0.25 is where white and the app's dark ink (--ink) have the same contrast with the background.
  return light > 0.25 ? '#3f3127' : '#ffffff';
}
