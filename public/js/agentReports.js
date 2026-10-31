// Assistant commands for the Reports tab: which weeks, schools and grades a report covers, one file
// per school or per grade, how each lesson is written, and the weekly reports. See agentCommands.js.
// (Making the report in Google Drive is the teacher's click: the Make button on the Reports tab.)

import { update } from './model.js';
import { asColumn, changedReports, manualReports, reportRows, reportSettings } from './reportPlan.js';
import { fail, grade, idsOf, listOf, namesOf, patchFrom, school, weekOf, year } from './agentHelpers.js';

function save(state, patch, manual = {}) {
  const y = year(state);
  update(state, 'years', y.id, { reports: changedReports(y, patch, manual) });
  return reportSettings(y);
}

function describe(state, s) {
  const m = s.manual;
  return {
    lessonText: s.label || '{{copy_name}}', rowsAbove: s.above, rowsBelow: s.below,
    columnsBefore: s.left, columnsAfter: s.right, columnNames: s.columnNames, footer: s.footer, weeklyReports: s.weekly,
    fromWeek: m.fromWeek, toWeek: m.toWeek,
    schools: m.schoolIds.length ? namesOf(state, 'schools', m.schoolIds) : 'all',
    grades: m.gradeIds.length ? namesOf(state, 'grades', m.gradeIds) : 'all',
    oneFilePer: m.perGrade ? 'grade' : 'school', folder: m.folder?.name ?? null, keepUpToDate: m.keepUpToDate,
    keptUpToDate: s.watched.map((w) => w.name),
  };
}

function filePer(value) {
  const v = String(value).toLowerCase();
  if (v !== 'school' && v !== 'grade') fail('oneFilePer should be "school" (a tab per grade) or "grade".');
  return v === 'grade';
}

/** "all" (or an empty list) = every one. */
const chosen = (state, refs, one) => (String(refs).toLowerCase() === 'all' ? [] : idsOf(state, refs, one));

export const REPORT_COMMANDS = {
  reportSettings: {
    summary: 'See the Reports tab choices: weeks, schools, grades, one file per school or grade, how lessons are written, and whether weekly reports are on.',
    params: {},
    run: (state) => describe(state, reportSettings(year(state))),
  },
  setReportOptions: {
    summary: 'Change what each lesson shows in reports: its text (words like {{copy_name}}, {{template_name}}, {{week_number}}; "" = {{copy_name}}), extra rows above or below it (e.g. ["{{essential_outcome}}"]; [] = none), columns before or after it ([{ name, value }]) and whether column names show. Or turn the weekly reports in each week folder on or off.',
    changes: true,
    params: {
      lessonText: ['e.g. "{{copy_name}} / {{template_name}}"'], rowsAbove: ['List of row texts above each lesson'],
      rowsBelow: ['List of row texts below each lesson'], columnsBefore: ['Columns left of the lesson: [{ name, value }], e.g. { "name": "Outcome", "value": "{{essential_outcome}}" }'],
      columnsAfter: ['Columns right of the lesson, like columnsBefore'], columnNames: ['true or false: show the column names at the top'], footer: ['true or false: the "Automatically maintained by Lesson Planner" line'],
      weeklyReports: ['true or false'],
    },
    run: (state, a) => {
      const rows = (v) => listOf(v).map((t) => String(t).trim()).filter(Boolean);
      const columns = (v) => listOf(v).map(asColumn);
      const patch = patchFrom(a, {
        lessonText: (v) => String(v ?? '').trim(), rowsAbove: rows, rowsBelow: rows, columnsBefore: columns, columnsAfter: columns, columnNames: (v) => v === true || v === 'true',
        footer: (v) => v === true || v === 'true', weeklyReports: (v) => v === true || v === 'true',
      });
      const renamed = {
        lessonText: 'label', rowsAbove: 'above', rowsBelow: 'below', columnsBefore: 'left', columnsAfter: 'right', columnNames: 'columnNames', footer: 'footer', weeklyReports: 'weekly',
      };
      const s = save(state, Object.fromEntries(Object.entries(patch).map(([k, v]) => [renamed[k], v])));
      return { done: 'Report options saved.', ...describe(state, s) };
    },
  },
  setupReport: {
    summary: 'Choose what the Reports tab report covers: weeks (number or a date in the week), schools and grades (names, or "all"), and one file per school (a tab per grade) or per grade.',
    changes: true,
    params: {
      fromWeek: ['First week'], toWeek: ['Last week (default: same as fromWeek)'],
      schools: ['Names, or "all"'], grades: ['Names, or "all"'], oneFilePer: ['"school" or "grade"'],
      keepUpToDate: ['true or false: when the teacher clicks Make, also keep those reports up to date automatically'],
    },
    run: (state, a) => {
      const manual = patchFrom(a, {
        fromWeek: (v) => weekOf(state, v).number, toWeek: (v) => weekOf(state, v).number,
        schools: (v) => chosen(state, v, school), grades: (v) => chosen(state, v, grade), oneFilePer: filePer,
        keepUpToDate: (v) => v === true || v === 'true',
      });
      const { schools, grades, oneFilePer, keepUpToDate, ...weeks } = manual;
      if (weeks.fromWeek && !weeks.toWeek) weeks.toWeek = Math.max(weeks.fromWeek, reportSettings(year(state)).manual.toWeek ?? 0);
      if (weeks.fromWeek && weeks.toWeek < weeks.fromWeek) fail('The last week has to come after the first week.');
      const s = save(state, {}, {
        ...weeks, ...(schools ? { schoolIds: schools } : {}), ...(grades ? { gradeIds: grades } : {}),
        ...(oneFilePer === undefined ? {} : { perGrade: oneFilePer }),
        ...(keepUpToDate === undefined ? {} : { keepUpToDate }),
      });
      return { done: 'Report set up. The teacher clicks “Make” on the Reports tab to save it in Google Drive.', ...describe(state, s) };
    },
  },
  stopKeepingReportUpToDate: {
    summary: 'Take a report off the list that is kept up to date (by its name, as shown in reportSettings keptUpToDate). Its file in Google Drive is not deleted.',
    changes: true,
    params: { report: ['The report name', true] },
    run: (state, a) => {
      const y = year(state);
      const list = reportSettings(y).watched;
      const entry = list.find((w) => w.id === a.report || w.name.toLowerCase() === String(a.report).trim().toLowerCase())
        ?? fail(`No report called "${a.report}" is kept up to date. Choices: ${list.map((w) => w.name).join(', ') || 'none'}.`);
      const s = save(state, { watched: list.filter((w) => w.id !== entry.id) });
      return { done: `“${entry.name}” is no longer kept up to date. Its file in Google Drive was not deleted.`, ...describe(state, s) };
    },
  },
  previewReport: {
    summary: 'What the Reports tab report would show: each file, its tabs, and their rows (links show once lesson copies exist).',
    params: {},
    run: (state) => {
      const s = reportSettings(year(state));
      return manualReports(state, year(state).id, { ...s, copyOf: () => null, defaultWeek: 1 })
        .map((f) => ({ file: f.name, tabs: f.tabs.map((t) => ({ tab: t.title, rows: reportRows(t).map((r) => r.map((c) => c.text)) })) }));
    },
  },
};
