// Weekly reports for the export bridge (exportBridge.js): once the lesson copies are up to date, each
// week folder gets a "Week n report" Google Sheet listing that week's lessons in order, linked to their
// copies, plus the instruments at the school that week (reportPlan.js). Like the copies, it reconciles
// what's in Drive with what's wanted, so it doesn't matter which computer made a report or when.

import { activeYear, find } from './model.js';
import { todayISO } from './dates.js';
import {
  copyFinder, currentWeekNumber, manualReports, reportFolder, reportSettings, reportSteps, weeklyReports,
} from './reportPlan.js';
import { driveReports, reportUrl } from './reportSheets.js';

const WEEKLY = 'weekly';
const MANUAL = 'manual';

/** The weekly-report side of a Drive output folder. `adapter` = driveCopies() (its `send` and `folderFor`). */
export function weeklyReportKeeper(adapter, yearId) {
  const files = driveReports({ send: adapter.send, yearId });
  // haves = weekly reports in the week folders; manualHaves = the Reports tab's reports in `manualFolder`
  const keeper = { haves: [], manualHaves: [], manualFolder: null, failed: new Map(), left: 0 };

  const yearOf = (state) => find(state, 'years', yearId);
  const manualFolderId = (state) => {
    const year = yearOf(state);
    return reportSettings(year).manual.keepUpToDate ? reportFolder(year)?.folderId ?? null : null;
  };

  /** Look at what's in Drive (the weekly reports, and the Reports tab's folder when it's kept up to date). */
  keeper.load = async (state) => {
    keeper.haves = await files.list(WEEKLY);
    await keeper.sync(state, { force: true });
  };

  /** Look in the Reports tab's folder again when it's a different one (or kept up to date only now). */
  keeper.sync = async (state, { force = false } = {}) => {
    const folderId = manualFolderId(state);
    if (!force && folderId === keeper.manualFolder) return;
    keeper.manualHaves = folderId ? await files.list(MANUAL, { folderId }) : [];
    keeper.manualFolder = folderId;
  };

  /** The Reports tab's reports kept up to date, with where they are: [{ name, url }]. */
  keeper.manualFiles = () => keeper.manualHaves.map((h) => ({ name: h.name, url: reportUrl(h.id) }));

  const weeklySteps = (state, { wants, copies, rootKey }) => {
    const reports = reportSettings(yearOf(state)).weekly
      ? weeklyReports(state, yearId, { ...reportSettings(yearOf(state)), wants, copyOf: copyFinder(copies), rootKey })
      : [];
    return reportSteps(reports, keeper.haves).map((s) => ({ ...s, group: WEEKLY }));
  };

  /** The Reports tab's reports to make or bring up to date (never removed: an old one just stops being updated). */
  const manualSteps = (state, { copies }) => {
    const settings = reportSettings(yearOf(state));
    const folderId = manualFolderId(state);
    if (!folderId || folderId !== keeper.manualFolder) return [];
    const wants = manualReports(state, yearId, {
      ...settings, copyOf: copyFinder(copies), defaultWeek: currentWeekNumber(yearOf(state), todayISO()),
    });
    return reportSteps(wants, keeper.manualHaves).filter((s) => s.kind !== 'remove').map((s) => ({ ...s, group: MANUAL, folderId }));
  };

  /** What needs doing (not things that failed with the same contents, until something changes). */
  keeper.steps = (state, context) => [...weeklySteps(state, context), ...manualSteps(state, context)]
    .filter((s) => !s.want || keeper.failed.get(`${s.group}:${s.want.key}`) !== s.want.hash);

  async function runStep(step) {
    if (step.kind === 'remove') {
      await files.remove(step.have);
      keeper.haves = keeper.haves.filter((h) => h.id !== step.have.id);
      return;
    }
    if (step.group === MANUAL) return runManual(step);
    const parentId = await adapter.folderFor(step.want.path);
    const made = step.kind === 'create'
      ? await files.create(WEEKLY, step.want, parentId)
      : await files.update(WEEKLY, step.have, step.want, parentId);
    keeper.haves = [...keeper.haves.filter((h) => h.id !== step.have?.id), made];
    return undefined;
  }

  /** A Reports tab report: made, or updated in place. Looks again first, so two computers never make it twice. */
  async function runManual({ kind, want, have, folderId }) {
    let current = have;
    if (kind === 'create') {
      keeper.manualHaves = await files.list(MANUAL, { folderId });
      current = keeper.manualHaves.find((h) => h.key === want.key);
    }
    const made = current ? await files.update(MANUAL, current, want, folderId) : await files.create(MANUAL, want, folderId);
    keeper.manualHaves = [...keeper.manualHaves.filter((h) => h.id !== made.id && h.key !== want.key), made];
  }

  /**
   * Work through the steps one at a time. `goOn()` false stops (a change to settle, signed out…);
   * `show(text)` says what's happening; `problem(err)` reports a failure (the step isn't tried again
   * until its contents change); `stoppers` = error messages that stop the run instead.
   */
  keeper.run = async (steps, { goOn, show, problem, stoppers }) => {
    keeper.left = steps.length;
    try {
      for (const step of steps) {
        if (!goOn()) return;
        show(describe(step));
        try {
          await runStep(step);
        } catch (err) {
          if (stoppers.includes(err.message)) return;
          if (step.want) keeper.failed.set(`${step.group}:${step.want.key}`, step.want.hash);
          problem(err);
        }
        keeper.left -= 1;
      }
    } finally {
      keeper.left = 0;
    }
  };

  return keeper;
}

function describe(step) {
  if (step.kind === 'remove') return `Removing a weekly report that’s no longer needed (“${step.have.name}”)`;
  const doing = step.kind === 'create' ? 'Making' : 'Updating';
  if (step.group === MANUAL) return `${doing} the report “${step.want.name}”`;
  return `${doing} the weekly report for ${step.want.path.slice(1).join(' › ')}`;
}

/** Whether weekly reports are on for the open year (they are unless turned off on the Reports tab). */
export function weeklyReportsOn(state) {
  return reportSettings(state && activeYear(state)).weekly;
}
