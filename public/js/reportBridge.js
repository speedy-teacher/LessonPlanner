// Weekly reports for the export bridge (exportBridge.js): once the lesson copies are up to date, each
// week folder gets a "Week n report" Google Sheet listing that week's lessons in order, linked to their
// copies, plus the instruments at the school that week (reportPlan.js). Like the copies, it reconciles
// what's in Drive with what's wanted, so it doesn't matter which computer made a report or when.

import { activeYear, find } from './model.js';
import { todayISO } from './dates.js';
import {
  copyFinder, currentWeekNumber, reportSettings, reportSteps, watchedReport, weeklyReports,
} from './reportPlan.js';
import { driveReports, reportUrl } from './reportSheets.js';

const WEEKLY = 'weekly';
const MANUAL = 'manual';

/** The weekly-report side of a Drive output folder. `adapter` = driveCopies() (its `send` and `folderFor`). */
export function weeklyReportKeeper(adapter, yearId) {
  const files = driveReports({ send: adapter.send, yearId });
  // haves = weekly reports in the week folders; manualHaves = the watched reports found in each watched folder
  const keeper = { haves: [], manualHaves: new Map(), failed: new Map(), left: 0 };

  const yearOf = (state) => find(state, 'years', yearId);
  const watchedOf = (state) => reportSettings(yearOf(state)).watched;
  const folderIds = (state) => [...new Set(watchedOf(state).map((w) => w.folder.folderId))];

  /** Look at what's in Drive: the weekly reports, and the folders of the watched reports. */
  keeper.load = async (state) => {
    keeper.haves = await files.list(WEEKLY);
    keeper.manualHaves = new Map();
    await keeper.sync(state);
  };

  /** Look in watched folders not looked at yet (a report was just added to the list). */
  keeper.sync = async (state) => {
    const wanted = folderIds(state);
    for (const folderId of wanted) {
      if (!keeper.manualHaves.has(folderId)) keeper.manualHaves.set(folderId, await files.list(MANUAL, { folderId }));
    }
    for (const folderId of keeper.manualHaves.keys()) if (!wanted.includes(folderId)) keeper.manualHaves.delete(folderId);
  };

  /** The watched reports' files found in Drive: [{ key, name, url, folderId }]. */
  keeper.manualFiles = () => [...keeper.manualHaves.entries()].flatMap(([folderId, list]) => list
    .map((h) => ({ key: h.key, name: h.name, url: reportUrl(h.id), folderId })));

  const weeklySteps = (state, { wants, copies, rootKey }) => {
    const reports = reportSettings(yearOf(state)).weekly
      ? weeklyReports(state, yearId, { ...reportSettings(yearOf(state)), wants, copyOf: copyFinder(copies), rootKey })
      : [];
    return reportSteps(reports, keeper.haves).map((s) => ({ ...s, group: WEEKLY }));
  };

  /** The watched reports to make or bring up to date (one that isn't wanted any more is just left alone). */
  const manualSteps = (state, { copies }) => {
    const settings = reportSettings(yearOf(state));
    const context = { settings, copyOf: copyFinder(copies), defaultWeek: currentWeekNumber(yearOf(state), todayISO()) };
    return settings.watched.flatMap((entry) => {
      const found = keeper.manualHaves.get(entry.folder.folderId);
      const want = found && watchedReport(state, yearId, entry, context);
      if (!want) return [];
      return reportSteps([want], found.filter((h) => h.key === want.key))
        .filter((s) => s.kind !== 'remove').map((s) => ({ ...s, group: MANUAL, folderId: entry.folder.folderId }));
    });
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

  /** A watched report: made, or updated in place. Looks again first, so two computers never make it twice. */
  async function runManual({ kind, want, have, folderId }) {
    let current = have;
    if (kind === 'create') {
      keeper.manualHaves.set(folderId, await files.list(MANUAL, { folderId }));
      current = keeper.manualHaves.get(folderId).find((h) => h.key === want.key);
    }
    const made = current ? await files.update(MANUAL, current, want, folderId) : await files.create(MANUAL, want, folderId);
    keeper.manualHaves.set(folderId, [...keeper.manualHaves.get(folderId).filter((h) => h.id !== made.id && h.key !== want.key), made]);
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
