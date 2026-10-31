// Making the files of a plan in pieces: a new piece file (in Google Drive when connected, else on this
// computer) and the teacher's one Teacher Resources, which every new plan links to.
//
// Browser-only (talks to Google Drive and the cache on this computer).

import { newId } from './model.js';
import { google } from './google.js';
import { createPlanFile, listMyResources, PIECE_PROPERTY, readPlanFile, SCHOOL_YEAR_PROPERTY } from './driveFiles.js';
import { allPlans, getPlan, putPlan } from './localCache.js';
import { driveKey } from './pieceEngine.js';
import { fromPieceFile, pieceFileName, toPieceFile } from './pieces.js';
import { mergeResources, relinkSchedule } from './resourceMerge.js';

const driveReady = () => google.status === 'connected' && google.token;

/** A new piece file: in Google Drive when connected (labelled so it can be found again), else on this computer. */
export async function newPieceRecord(name, data, { fileName, folderId, schoolYearFileId = null }) {
  const base = { piece: name, name: fileName, fileId: null, folderId: null, rev: null, base: null, canEdit: true, changed: false, keptDay: null, savedAt: Date.now(), data };
  if (!driveReady()) return { ...base, key: `computer:${newId('piece')}` };
  const text = toPieceFile(data);
  const properties = { [PIECE_PROPERTY(name).key]: name, ...(schoolYearFileId ? { [SCHOOL_YEAR_PROPERTY]: schoolYearFileId } : {}) };
  const file = await createPlanFile(google.token, { name: fileName, text, folderId, properties });
  return { ...base, key: driveKey(file.fileId), fileId: file.fileId, folderId: file.folderId, rev: file.rev, base: text };
}

/** How a Teacher Schedule's links point at another piece file. */
export const linkTo = (rec) => ({ key: rec.key, fileId: rec.fileId, name: rec.name });

/**
 * The Teacher Resources for a new plan. `reuse`: false = always a new one; true = the one you already
 * have (found in Drive or on this computer); or a Resources record to use. A Resources that's reused gets
 * this plan's templates and pictures added (no doubles, see resourceMerge.js); otherwise a new one is made.
 * Returns { rec, schedule } — the schedule pointed at the matched templates.
 */
export async function resourcesFor({ resources, schedule }, { year, folderId, reuse }) {
  const existing = await existingResources(reuse);
  if (!existing) {
    const rec = await newPieceRecord('resources', resources, { fileName: pieceFileName('resources', year), folderId });
    await putPlan(rec);
    return { rec, schedule };
  }
  const { resources: combined, map } = mergeResources(existing.data, resources);
  const rec = { ...existing, data: combined, changed: Boolean(existing.fileId), savedAt: Date.now() };
  await putPlan(rec);
  return { rec, schedule: relinkSchedule(schedule, map) };
}

async function existingResources(reuse) {
  if (!reuse) return null;
  if (reuse === true) return myResources();
  return await getPlan(reuse.key).catch(() => null) ?? reuse; // the newest copy kept on this computer
}

/** Your own Teacher Resources, if you have one: in Google Drive (newest), or else on this computer. */
export async function myResources() {
  if (driveReady()) {
    const [file] = await listMyResources(google.token);
    if (!file) return null;
    const cached = await getPlan(driveKey(file.fileId)).catch(() => null);
    if (cached) return cached;
    const read = await readPlanFile(google.token, file.fileId);
    return {
      key: driveKey(file.fileId), piece: 'resources', name: read.name, fileId: file.fileId, folderId: read.folderId, rev: read.rev,
      base: read.text, canEdit: read.canEdit, changed: false, keptDay: null, savedAt: 0, data: fromPieceFile(read.text, 'resources'),
    };
  }
  return (await allPlans().catch(() => [])).find((p) => p.piece === 'resources' && !p.fileId) ?? null;
}
