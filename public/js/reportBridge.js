// Weekly reports for the export bridge (exportBridge.js): once the lesson copies are up to date, each
// week folder gets a "Week n report" Google Sheet listing that week's lessons in order, linked to their
// copies, plus the instruments at the school that week (reportPlan.js). Like the copies, it reconciles
// what's in Drive with what's wanted, so it doesn't matter which computer made a report or when.

import { activeYear, find } from './model.js';
import { copyFinder, reportSettings, reportSteps, weeklyReports } from './reportPlan.js';
import { driveReports } from './reportSheets.js';

const WEEKLY = 'weekly';

/** The weekly-report side of a Drive output folder. `adapter` = driveCopies() (its `send` and `folderFor`). */
export function weeklyReportKeeper(adapter, yearId) {
  const files = driveReports({ send: adapter.send, yearId });
  const keeper = { haves: [], failed: new Map(), left: 0 };

  keeper.load = async () => { keeper.haves = await files.list(WEEKLY); };

  /** What needs doing (not things that failed with the same contents, until something changes). */
  keeper.steps = (state, { wants, copies, rootKey }) => {
    const settings = reportSettings(find(state, 'years', yearId));
    const reports = settings.weekly
      ? weeklyReports(state, yearId, { wants, copyOf: copyFinder(copies), label: settings.label, rootKey })
      : [];
    return reportSteps(reports, keeper.haves).filter((s) => !s.want || keeper.failed.get(s.want.key) !== s.want.hash);
  };

  async function runStep(step) {
    if (step.kind === 'remove') {
      await files.remove(step.have);
      keeper.haves = keeper.haves.filter((h) => h.id !== step.have.id);
      return;
    }
    const parentId = await adapter.folderFor(step.want.path);
    const made = step.kind === 'create'
      ? await files.create(WEEKLY, step.want, parentId)
      : await files.update(WEEKLY, step.have, step.want, parentId);
    keeper.haves = [...keeper.haves.filter((h) => h.id !== step.have?.id), made];
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
          if (step.want) keeper.failed.set(step.want.key, step.want.hash);
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
  const where = step.want.path.slice(1).join(' › ');
  return `${step.kind === 'create' ? 'Making' : 'Updating'} the weekly report for ${where}`;
}

/** Whether weekly reports are on for the open year (they are unless turned off on the Reports tab). */
export function weeklyReportsOn(state) {
  return reportSettings(state && activeYear(state)).weekly;
}
