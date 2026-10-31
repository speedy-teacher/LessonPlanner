// Making the reports chosen on the Reports tab, in a Google Drive folder the teacher picks
// (browser only). Making the same report again (same school, grades and weeks, same folder)
// updates that file instead of making another one.

import { driveCopies, driveSender } from './exportDrive.js';
import { driveReports, reportUrl } from './reportSheets.js';

const MANUAL = 'manual';

/** The lesson copies in the year's Drive output folder (for colleagues whose computer doesn't keep them). */
export async function listDriveCopies({ token, year }) {
  if (year?.output?.kind !== 'drive') return [];
  return driveCopies({ token, rootId: year.output.folderId, yearId: year.id }).list();
}

/**
 * Make or update each report file (reportPlan.js manualReports) in `folderId`.
 * Returns [{ name, url, updated }] (updated = an earlier one was brought up to date).
 */
export async function makeReports({ token, yearId, files, folderId }) {
  const reports = driveReports({ send: driveSender({ token }), yearId });
  const haves = await reports.list(MANUAL, { folderId });
  const made = [];
  for (const file of files) {
    const have = haves.find((h) => h.key === file.key);
    const done = have ? await reports.update(MANUAL, have, file, folderId) : await reports.create(MANUAL, file, folderId);
    made.push({ name: done.name, url: reportUrl(done.id), updated: Boolean(have) });
  }
  return made;
}
