// "Bring last year's weekly schedule": a year that's already set up gets another year's week-by-week
// Lesson Schedule laid onto it by week number (weekPlan.js weeksFrom), into weeks still empty only.
// The other year is one of the teacher's own plans, read from this computer's copy, else Google Drive.
// Its schools, grades and evals are matched to this year's (joinYear.js: by id, then by name) and its
// templates to this year's Teacher Resources (resourceMerge.js), so it works across School Years.
//
// Browser-only (reads plans from the cache and Google Drive).

import { google } from './google.js';
import { listPlanFiles, readPlanFile } from './driveFiles.js';
import { matchToSchoolYear } from './joinYear.js';
import { allPlans, getPlan } from './localCache.js';
import { add } from './model.js';
import { driveKey } from './pieceEngine.js';
import { composeState, fromPieceFile, pieceKind } from './pieces.js';
import { mergeResources } from './resourceMerge.js';
import { commit } from './store.js';
import { weeksFrom } from './weekPlan.js';
import { fromWorkspaceFile } from './workspaceFile.js';
import { current, myPlanState, pieces } from './workspace.js';

const driveReady = () => google.status === 'connected' && Boolean(google.token);

/**
 * The teacher's other plans to bring weeks from, newest first: [{ id, name, fileId?, key? }] — their own
 * plans in Google Drive (when connected) and plans kept on this computer, never the open one.
 */
export async function otherPlans() {
  const openIds = new Set([current?.fileId, current?.key, pieces?.own?.schedule?.fileId].filter(Boolean));
  const plans = [...await drivePlans(), ...await computerPlans()].filter((p) => !openIds.has(p.id));
  return [...new Map(plans.map((p) => [p.id, p])).values()];
}

/** Your own plans in Google Drive (older one-file plans and Lesson Schedules). */
async function drivePlans() {
  if (!driveReady()) return [];
  const files = await listPlanFiles(google.token);
  return files.filter((f) => f.ownedByMe).map((f) => ({ id: f.fileId, name: f.name, fileId: f.fileId }));
}

/** Plans kept only on this computer (not their pieces, not rescue copies). */
async function computerPlans() {
  const recs = await allPlans().catch(() => []);
  const isPlan = (rec) => (!rec.piece || rec.piece === 'schedule') && !rec.fileId && !String(rec.key).startsWith('rescue:');
  return recs.filter(isPlan).map((rec) => ({ id: rec.key, name: rec.name, key: rec.key }));
}

/** Another plan's data (one year, combined), from this computer's copy, else Google Drive. */
export async function readOtherPlan(plan) {
  const rec = await getPlan(plan.key ?? driveKey(plan.fileId)).catch(() => null);
  if (rec?.state) return rec.state;
  if (rec?.piece === 'schedule') return withSchoolYear(rec.data);
  const file = await readPlanFile(google.token, plan.fileId);
  const raw = JSON.parse(file.text);
  if (pieceKind(raw) === 'schedule') return withSchoolYear(fromPieceFile(file.text, 'schedule'));
  return fromWorkspaceFile(file.text);
}

/** A Lesson Schedule with the School Year it uses (its weeks, schools and grades). */
async function withSchoolYear(schedule) {
  const link = schedule.meta?.links?.schoolYear;
  const cached = link ? await getPlan(link.key).catch(() => null) : null;
  const schoolYear = cached?.data ?? (link?.fileId ? fromPieceFile((await readPlanFile(google.token, link.fileId)).text, 'schoolYear') : null);
  return composeState({ schoolYear, schedule, resources: null });
}

/** What bringing `from`'s weeks would do to this year: weeksFrom's counts, with the matches it uses. */
export function previewWeeks(from) {
  const now = myPlanState();
  const map = { ...matchToSchoolYear(from, now).map, ...mergeResources(now, from).map };
  return { map, ...weeksFrom(from, now, { map, onlyEmpty: true }) };
}

/** Bring `from`'s weeks into this year's empty weeks (one Undo step). Returns weeksFrom's counts. */
export function bringWeeks(from) {
  const { map } = previewWeeks(from);
  return commit((s) => {
    const result = weeksFrom(from, s, { map, onlyEmpty: true });
    for (const entry of result.entries) add(s, 'weekLessons', entry);
    return result;
  });
}
