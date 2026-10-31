// Assistant commands for the Reports tab: which weeks, schools and grades a report covers, one file
// per school or per grade, how each lesson is written, and the weekly reports. See agentCommands.js.
// (Making the report in Google Drive is the teacher's click: the Make button on the Reports tab.)

import { update } from './model.js';
import { manualReports, reportRows, reportSettings } from './reportPlan.js';
import { fail, grade, idsOf, namesOf, patchFrom, school, weekOf, year } from './agentHelpers.js';

function save(state, patch, manual = {}) {
  const y = year(state);
  const now = reportSettings(y);
  update(state, 'years', y.id, { reports: { label: now.label, weekly: now.weekly, ...patch, manual: { ...now.manual, ...manual } } });
  return reportSettings(y);
}

function describe(state, s) {
  const m = s.manual;
  return {
    lessonText: s.label || '{{copy_name}}', weeklyReports: s.weekly,
    fromWeek: m.fromWeek, toWeek: m.toWeek,
    schools: m.schoolIds.length ? namesOf(state, 'schools', m.schoolIds) : 'all',
    grades: m.gradeIds.length ? namesOf(state, 'grades', m.gradeIds) : 'all',
    oneFilePer: m.perGrade ? 'grade' : 'school', folder: m.folder?.name ?? null,
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
    summary: 'Change how each lesson is written in reports (words like {{copy_name}}, {{template_name}}, {{week_number}}; "" = {{copy_name}}), or turn the weekly reports in each week folder on or off.',
    changes: true,
    params: { lessonText: ['e.g. "{{copy_name}} / {{template_name}}"'], weeklyReports: ['true or false'] },
    run: (state, a) => {
      const patch = patchFrom(a, { lessonText: (v) => String(v ?? '').trim(), weeklyReports: (v) => v === true || v === 'true' });
      const s = save(state, { ...('lessonText' in patch ? { label: patch.lessonText } : {}), ...('weeklyReports' in patch ? { weekly: patch.weeklyReports } : {}) });
      return { done: 'Report options saved.', ...describe(state, s) };
    },
  },
  setupReport: {
    summary: 'Choose what the Reports tab report covers: weeks (number or a date in the week), schools and grades (names, or "all"), and one file per school (a tab per grade) or per grade.',
    changes: true,
    params: {
      fromWeek: ['First week'], toWeek: ['Last week (default: same as fromWeek)'],
      schools: ['Names, or "all"'], grades: ['Names, or "all"'], oneFilePer: ['"school" or "grade"'],
    },
    run: (state, a) => {
      const manual = patchFrom(a, {
        fromWeek: (v) => weekOf(state, v).number, toWeek: (v) => weekOf(state, v).number,
        schools: (v) => chosen(state, v, school), grades: (v) => chosen(state, v, grade), oneFilePer: filePer,
      });
      const { schools, grades, oneFilePer, ...weeks } = manual;
      if (weeks.fromWeek && !weeks.toWeek) weeks.toWeek = Math.max(weeks.fromWeek, reportSettings(year(state)).manual.toWeek ?? 0);
      if (weeks.fromWeek && weeks.toWeek < weeks.fromWeek) fail('The last week has to come after the first week.');
      const s = save(state, {}, {
        ...weeks, ...(schools ? { schoolIds: schools } : {}), ...(grades ? { gradeIds: grades } : {}),
        ...(oneFilePer === undefined ? {} : { perGrade: oneFilePer }),
      });
      return { done: 'Report set up. The teacher clicks “Make” on the Reports tab to save it in Google Drive.', ...describe(state, s) };
    },
  },
  previewReport: {
    summary: 'What the Reports tab report would show: each file, its tabs, and their rows (links show once lesson copies exist).',
    params: {},
    run: (state) => {
      const s = reportSettings(year(state));
      return manualReports(state, year(state).id, { manual: s.manual, label: s.label, copyOf: () => null, defaultWeek: 1 })
        .map((f) => ({ file: f.name, tabs: f.tabs.map((t) => ({ tab: t.title, rows: reportRows(t).map((r) => r.map((c) => c.text)) })) }));
    },
  },
};
