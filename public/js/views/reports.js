// "Reports" tab: choose weeks, schools and grades, see a preview, and make Google Sheets reports
// (each lesson linked to its copy, plus the instruments at the school that week) in a Drive folder.
// Also turns the weekly reports (one in every week folder of the lesson copies) on or off,
// and sets how each lesson is written in every report.

import { h, toast } from '../dom.js';
import { update } from '../model.js';
import { commit, refreshSoon, setUi, store } from '../store.js';
import { google } from '../google.js';
import { apiKey, clientId } from '../deviceSettings.js';
import { pickFolderFromDrive } from '../drive.js';
import { todayISO } from '../dates.js';
import { AUTO_FIELD_PLACEHOLDERS, AUTO_FIELDS, TEXT_FIELDS } from '../model.js';
import { schoolWeeks } from '../weekPlan.js';
import { showNotice } from '../notices.js';
import {
  changedReports, copyFinder, currentWeekNumber, DEFAULT_LABEL, LABEL_WORDS, manualReports, reportFolder, reportRows, reportSettings, reportWidth,
  watchedEntry, watchedReport, withWatched,
} from '../reportPlan.js';
import { listDriveCopies, makeReports } from '../reportMaker.js';
import { copyStatus, keptReportFiles, knownCopies, recheckCopies, weeklyReportFiles } from '../exportBridge.js';
import { current, emptyNote, year } from './common.js';

// Copies looked up for the preview when this computer doesn't keep them (this visit only).
const looked = { key: null, copies: null, busy: false };
let made = []; // the files the last "Make the report" made (this visit only)
let making = false;

const settings = () => reportSettings(year());

/** Save a change to the year's report settings (`patch` for the top level, `manual` for the report form). */
function saveSettings({ manual, ...patch }) {
  const y = year();
  commit((s) => update(s, 'years', y.id, { reports: changedReports(y, patch, manual) }));
}

const thisWeek = () => currentWeekNumber(year(), todayISO());

function copiesForPreview() {
  const mine = knownCopies();
  if (mine) return mine;
  const y = year();
  const key = JSON.stringify([y.id, y.output, google.token]);
  if (looked.key !== key && !looked.busy && google.status === 'connected' && y.output?.kind === 'drive') {
    looked.busy = true;
    listDriveCopies({ token: google.token, year: y })
      .then((copies) => { Object.assign(looked, { key, copies }); })
      .catch(() => { Object.assign(looked, { key, copies: [] }); })
      .finally(() => { looked.busy = false; refreshSoon(); });
  }
  return looked.key === key ? looked.copies : [];
}

function reportFiles(copies = copiesForPreview()) {
  const s = settings();
  return manualReports(store.state, year().id, { ...s, copyOf: copyFinder(copies), defaultWeek: thisWeek() });
}

export function renderReports() {
  if (!current('schools').length || !current('grades').length) {
    return emptyNote('Add at least one school and one grade under Setup › School Year to make reports.');
  }
  const files = reportFiles();
  return h('div', { class: 'reports-layout' },
    h('div', { class: 'reports-side' }, formCard(files), labelCard(), weeklyCard()),
    previewCard(files));
}

// ---------- the report form ----------

function formCard(files) {
  const { manual } = settings();
  return h('section', { class: 'card reports-card', 'data-tour': 'report-form' },
    h('h3', {}, '📊 Make a report'),
    h('p', { class: 'hint' }, 'A Google Sheet with each week’s lessons in order (each one links to its lesson copy) and the instruments at the school that week. Each school gets its own file.'),
    weekPickers(manual),
    chooser('Schools', current('schools'), manual.schoolIds, (schoolIds) => saveSettings({ manual: { schoolIds } })),
    chooser('Grades', current('grades'), manual.gradeIds, (gradeIds) => saveSettings({ manual: { gradeIds } }), { colors: true }),
    fileChoice(manual),
    folderChoice(),
    makeButton(files),
    madeList(),
    keepSection());
}

function weekPickers(manual) {
  const weeks = schoolWeeks(year());
  const from = manual.fromWeek ?? thisWeek();
  const to = Math.max(from, manual.toWeek ?? from);
  const select = (value, onPick, min = 1) => h('select', { class: 'report-week', onchange: (e) => onPick(Number(e.target.value)) },
    weeks.filter((w) => w.number >= min).map((w) => h('option', { value: w.number, selected: w.number === value },
      `Week ${w.number} · ${w.weekStart.slice(5).replace('-', '/')}`)));
  return h('div', { class: 'report-row' },
    h('span', { class: 'mini-label' }, 'Weeks:'),
    select(from, (n) => saveSettings({ manual: { fromWeek: n, toWeek: Math.max(n, to) } })),
    h('span', {}, 'to'),
    select(to, (n) => saveSettings({ manual: { fromWeek: from, toWeek: n } }), from));
}

/** Toggle buttons; none chosen = all of them (so new schools and grades are included too). */
function chooser(label, items, chosenIds, onChange, { colors = false } = {}) {
  const all = !chosenIds.length;
  const isOn = (item) => all || chosenIds.includes(item.id);
  const toggle = (item) => {
    const next = items.filter((i) => (i.id === item.id ? !isOn(i) : isOn(i))).map((i) => i.id);
    if (!next.length) return toast(`Pick at least one ${label === 'Schools' ? 'school' : 'grade'}.`);
    return onChange(next.length === items.length ? [] : next);
  };
  return h('div', { class: 'grade-toggles' },
    h('span', { class: 'mini-label' }, `${label}:`),
    items.map((item) => h('button', {
      class: `grade-toggle ${isOn(item) ? 'on' : ''}`, 'aria-pressed': isOn(item) ? 'true' : 'false',
      style: colors ? { '--grade': item.color } : null, onclick: () => toggle(item),
    }, colors ? item.short || item.name : item.name)));
}

function fileChoice(manual) {
  const radio = (perGrade, text) => h('label', { class: 'check' },
    h('input', { type: 'radio', name: 'report-files', checked: manual.perGrade === perGrade, onchange: () => saveSettings({ manual: { perGrade } }) }),
    text);
  return h('div', { class: 'report-files' },
    radio(false, 'One file per school, with a tab for each grade'),
    radio(true, 'A separate file for each grade'));
}

function folderChoice() {
  const folder = reportFolder(year());
  const connected = google.status === 'connected';
  return h('div', { class: 'report-row' },
    h('span', { class: 'mini-label' }, 'Save in:'),
    folder ? h('strong', {}, `☁️ ${folder.name}`) : h('span', { class: 'hint' }, 'no folder chosen yet'),
    h('button', {
      class: 'btn small light', disabled: !connected || !apiKey(),
      title: connected ? 'Opens Google’s folder picker' : 'Connect Google Drive first', onclick: chooseFolder,
    }, folder ? 'Change…' : 'Choose a Drive folder…'));
}

async function chooseFolder() {
  const [picked] = await pickFolderFromDrive({ token: google.token, apiKey: apiKey(), clientId: clientId() }).catch(() => []);
  if (!picked) return;
  saveSettings({ manual: { folder: { folderId: picked.id, name: picked.name } } });
  toast(`Reports go to “${picked.name}”.`);
}

function makeButton(files) {
  const folder = reportFolder(year());
  const connected = google.status === 'connected';
  let why = '';
  if (!connected) why = 'Connect Google Drive first.';
  else if (!folder) why = 'Choose a Drive folder first.';
  const what = files.length === 1 ? 'the report' : `${files.length} reports`;
  const label = making ? 'Making…' : `Make ${what}${settings().manual.keepUpToDate ? ' and keep up to date' : ''}`;
  return h('div', { class: 'report-row' },
    h('button', { class: 'btn', 'data-tour': 'report-make', disabled: Boolean(why) || making || !files.length, onclick: () => make(folder) }, label),
    why ? h('span', { class: 'hint' }, why) : null);
}

async function make(folder) {
  making = true;
  refreshSoon();
  try {
    // Look at the lesson copies right now, so every lesson links to its copy.
    const copies = knownCopies() ?? await listDriveCopies({ token: google.token, year: year() });
    const files = reportFiles(copies);
    made = await makeReports({ token: google.token, yearId: year().id, files, folderId: folder.folderId });
    const watching = settings().manual.keepUpToDate;
    if (watching) watchReports(files, folder);
    toast(`${made.length === 1 ? 'Report' : `${made.length} reports`} saved in “${folder.name}”${watching ? ' and kept up to date' : ''}.`);
    recheckCopies(); // look at the folder again, so keeping them up to date finds these files
  } catch (err) {
    console.warn('Reports:', err);
    toast(err.message === 'api_off'
      ? 'Reports need the Google Sheets API switched on in your Google project (Google Drive setup guide, step 3).'
      : 'The report couldn’t be made. Check the folder and your Google Drive connection, then try again.');
  } finally {
    making = false;
    refreshSoon();
  }
}

function madeList() {
  if (!made.length) return null;
  return h('ul', { class: 'report-made' }, made.map((m) => h('li', {},
    h('a', { href: m.url, target: '_blank', rel: 'noopener' }, `📄 ${m.name}`),
    m.updated ? h('span', { class: 'hint' }, ' (updated)') : null)));
}

// ---------- keeping them up to date ----------

/** Add reports just made to the list that's kept up to date (remembering how they were made). */
function watchReports(files, folder) {
  const { manual, watched } = settings();
  saveSettings({ watched: withWatched(watched, files.map((f) => watchedEntry(manual, f, folder))) });
}

/** Take a report off the list: its file in Drive is left alone. */
function stopWatching(entry, name) {
  saveSettings({ watched: settings().watched.filter((w) => w.id !== entry.id) });
  recheckCopies();
  showNotice({
    id: `report-unwatched-${entry.id}`, tone: 'info', title: 'Report no longer kept up to date',
    message: `“${name}” wasn’t deleted from your Google Drive — it was only removed from the Lesson Planner’s list, so it won’t be updated any more.`,
    seconds: 15,
  });
}

/** What stops the watched reports being kept up to date right now, in plain words ('' = nothing). */
function keepProblem() {
  if (year().output?.kind !== 'drive') return 'This needs the lesson copies in a Google Drive folder (Setup › School Year › Lesson copies).';
  return '';
}

function keepStatus() {
  const problem = keepProblem();
  if (problem) return problem;
  const state = copyStatus().state;
  if (state === 'ready') return '✓ Kept up to date about a minute after you change the Lesson Schedule or Instrument Schedule.';
  return state === 'other-keeper' || state === 'other-computer'
    ? 'They’re updated by the computer that keeps the lesson copies.'
    : 'They’re updated once Google Drive is connected and the lesson copies are checked.';
}

/** One row of the list: the report, where it is, and a button to stop keeping it up to date. */
function watchedRow(entry, found, look) {
  const file = watchedReport(store.state, year().id, entry, look);
  const name = file?.name ?? entry.name;
  const there = found.find((f) => f.folderId === entry.folder.folderId && f.key === file?.key);
  return h('li', { class: 'report-watched' },
    there ? h('a', { href: there.url, target: '_blank', rel: 'noopener' }, `📄 ${name}`) : h('span', {}, `📄 ${name}`),
    h('span', { class: 'hint' }, ` ☁️ ${entry.folder.name}${file ? '' : ' · its school or grades are gone'}`),
    h('button', { class: 'btn small light', 'data-tip': 'Stop keeping this report up to date (its file stays in Drive)', onclick: () => stopWatching(entry, name) }, 'Remove'));
}

/** One place for everything that's kept current: the reports made here, and the weekly reports. */
function keepSection() {
  const { manual, weekly, watched } = settings();
  const look = { settings: settings(), copyOf: () => null, defaultWeek: thisWeek() };
  const found = keptReportFiles();
  return h('div', { class: 'report-keep' },
    checkbox(manual.keepUpToDate, 'Keep these reports up to date automatically (when I click Make)', (keepUpToDate) => saveSettings({ manual: { keepUpToDate } })),
    h('h4', {}, 'Reports kept up to date'),
    watched.length
      ? h('ul', { class: 'report-made' }, watched.map((w) => watchedRow(w, found, look)))
      : h('p', { class: 'hint' }, 'None yet. Tick the box above, then click Make, and the reports are added here.'),
    watched.length ? h('p', { class: 'hint' }, keepStatus()) : null,
    weekly ? h('p', { class: 'hint' }, `🗓️ Weekly reports in every week folder are kept up to date too (${weeklyReportFiles().length} so far).`) : null);
}

// ---------- how lessons are written ----------

// The box the word buttons add to: 'label', or 'above'/'below' + row number (the last one typed in).
let wordTarget = { list: 'label', index: 0 };

const WORDS = {
  ...LABEL_WORDS,
  ...Object.fromEntries(TEXT_FIELDS.map((key) => [AUTO_FIELD_PLACEHOLDERS[key], AUTO_FIELDS[key]])),
};

/**
 * Save once the cursor has moved on (Tab to the next box): the redraw then puts the cursor back
 * in the box it moved to, not the one just left.
 */
const afterFocusMoves = (save) => setTimeout(save, 0);

/** A text box for the lesson line or one extra column's value; it saves when you press Enter or click away. */
function rowInput(value, { list, index = 0, placeholder = '' }, onSave) {
  return h('input', {
    class: 'inline-edit report-label', value, placeholder, dataset: { key: `report-${list}-${index}` },
    onfocus: () => { wordTarget = { list, index }; },
    onchange: (e) => afterFocusMoves(() => onSave(e.target.value.trim())),
    onkeydown: (e) => { if (e.key === 'Enter') e.target.blur(); },
  });
}

/** Change one extra column's name and/or value (`patch` null = take it out). */
function saveColumn(list, index, patch) {
  const columns = [...settings()[list]];
  if (patch === null) columns.splice(index, 1); else columns[index] = { ...columns[index], ...patch };
  saveSettings({ [list]: columns });
}

function addColumn(list) {
  const target = { list, index: settings()[list].length };
  saveSettings({ [list]: [...settings()[list], { name: '', value: '' }] }); // redrawing may focus (and target) another box…
  wordTarget = target; // …so the new column's value is where words go
  focusLater({ ...target, part: 'name' });
}

// The extra columns around the lesson: setting → its icon, where it goes, add-button text, and tutorial name.
const EXTRAS = {
  left: { icon: '⬅️', where: 'A column before the lesson', add: '+ Column before', tour: 'report-add-before' },
  right: { icon: '➡️', where: 'A column after the lesson', add: '+ Column after', tour: 'report-add-after' },
};

/** Each extra column: "Column name" : value. */
function columnsList(list) {
  const { icon, where } = EXTRAS[list];
  return settings()[list].map((column, index) => h('div', { class: 'report-extra-row' },
    h('span', { class: 'extra-icon', 'data-tip': where }, icon),
    h('input', {
      class: 'inline-edit report-column-name', 'data-tour': 'report-column-name', value: column.name, placeholder: 'Column name', 'aria-label': 'Column name',
      dataset: { key: `report-${list}-${index}-name` },
      onchange: (e) => afterFocusMoves(() => saveColumn(list, index, { name: e.target.value.trim() })),
      onkeydown: (e) => { if (e.key === 'Enter') e.target.blur(); },
    }),
    h('span', { class: 'column-colon' }, ':'),
    rowInput(column.value, { list, index, placeholder: 'e.g. {{essential_outcome}}' }, (value) => saveColumn(list, index, { value })),
    h('button', { class: 'icon-btn', title: 'Take this column out', 'aria-label': 'Take this column out', onclick: () => saveColumn(list, index, null) }, '✕')));
}

const addButtons = (...lists) => h('div', { class: 'report-add-row' },
  lists.map((list) => h('button', { class: 'btn small light', 'data-tour': EXTRAS[list].tour, 'data-tip': EXTRAS[list].where, onclick: () => addColumn(list) }, EXTRAS[list].add)));

const focusLater = ({ list, index, part }) => setTimeout(() => {
  document.querySelector(`[data-key="report-${list}-${index}${part ? `-${part}` : ''}"]`)?.focus();
}, 0);

/** A word button adds its word to the box last typed in (the lesson line when that row is gone). */
function addWord(word) {
  const s = settings();
  const { list, index } = wordTarget;
  const target = list !== 'label' && index < s[list].length ? wordTarget : { list: 'label', index: 0 };
  const before = target.list === 'label' ? s.label : s[target.list][target.index].value;
  const text = before ? `${before} ${word}` : word;
  if (target.list === 'label') saveSettings({ label: text }); else saveColumn(target.list, target.index, { value: text });
  focusLater(target);
}

function labelCard() {
  const s = settings();
  return h('section', { class: 'card reports-card', 'data-tour': 'report-label' },
    h('h3', {}, '✏️ What each lesson shows'),
    // Rows above/below each lesson (settings `above`/`below`) still work in reports; their buttons are hidden for now.
    h('p', { class: 'hint' }, 'Used in every report. Add columns before or after each lesson, e.g. its essential outcome. Click a word to add it to the box you last typed in.'),
    h('div', { class: 'report-lesson-rows' },
      columnsList('left'),
      h('label', { class: 'field report-lesson-line' }, '🔗 The lesson (linked to its copy)',
        rowInput(s.label, { list: 'label', placeholder: DEFAULT_LABEL }, (label) => saveSettings({ label }))),
      columnsList('right'),
      addButtons('left', 'right')),
    h('div', { class: 'label-words', 'data-tour': 'report-words' }, Object.entries(WORDS).map(([word, about]) => h('button', {
      class: 'pill small', 'data-tip': about, dataset: { word }, onclick: () => addWord(word),
    }, word))),
    checkbox(s.columnNames, 'Show column names at the top', (columnNames) => saveSettings({ columnNames })),
    checkbox(s.footer, 'Show “Automatically maintained by Lesson Planner” at the bottom of each report', (footer) => saveSettings({ footer })));
}

const checkbox = (checked, text, onChange) => h('label', { class: 'check big' },
  h('input', { type: 'checkbox', checked, onchange: (e) => onChange(e.target.checked) }),
  h('span', {}, text));

// ---------- weekly reports ----------

function weeklyCard() {
  const { weekly } = settings();
  const output = year().output;
  const files = weeklyReportFiles();
  let status = 'Choose a Google Drive folder for lesson copies (Setup › School Year) to get weekly reports.';
  if (output?.kind === 'local') status = 'Weekly reports need the lesson copies in a Google Drive folder.';
  else if (output && copyStatus().state === 'ready') status = `✓ ${files.length} weekly ${files.length === 1 ? 'report' : 'reports'} in the copies folder.`;
  else if (output) status = 'They’re made by the computer that keeps the lesson copies.';
  return h('section', { class: 'card reports-card', 'data-tour': 'report-weekly' },
    h('h3', {}, '🗓️ Weekly reports'),
    h('label', { class: 'check big' },
      h('input', { type: 'checkbox', checked: weekly, onchange: (e) => saveSettings({ weekly: e.target.checked }) }),
      h('span', {}, 'Put a “Week n report” in every week folder of the lesson copies, and keep it up to date')),
    weekly ? h('p', { class: 'hint' }, status) : h('p', { class: 'hint' }, 'Off: weekly reports already made go to the Drive trash.'));
}

// ---------- preview ----------

function previewCard(files) {
  const fileIndex = Math.min(store.ui.reportFile ?? 0, Math.max(0, files.length - 1));
  const file = files[fileIndex];
  const tabIndex = Math.min(store.ui.reportTab ?? 0, Math.max(0, (file?.tabs.length ?? 1) - 1));
  return h('section', { class: 'card reports-preview', 'data-tour': 'report-preview' },
    h('h3', {}, '👀 Preview'),
    files.length > 1 ? h('div', { class: 'pills' }, files.map((f, i) => h('button', {
      class: `pill ${i === fileIndex ? 'active' : ''}`, onclick: () => setUi({ reportFile: i, reportTab: 0 }),
    }, `📄 ${f.name}`))) : null,
    file ? previewFile(file, tabIndex) : emptyNote('Nothing to show for these choices.'));
}

function previewFile(file, tabIndex) {
  return h('div', { class: 'sheet-preview' },
    h('div', { class: 'sheet-name' }, `📄 ${file.name}`),
    h('div', { class: 'sheet-body' }, sheetTable(file.tabs[tabIndex])),
    h('div', { class: 'sheet-tabs' }, file.tabs.map((t, i) => h('button', {
      class: `sheet-tab ${i === tabIndex ? 'active' : ''}`, onclick: () => setUi({ reportTab: i }),
    }, t.title))));
}

function sheetTable(tab) {
  const width = reportWidth(tab);
  return h('table', { class: 'sheet-table' }, reportRows(tab).map((row) => h('tr', {},
    row.length
      ? row.map((cell) => h('td', {
        colspan: cell.span ?? 1, class: `cell-${cell.style}`, style: cell.color ? { background: cell.color, color: cell.ink } : null,
      }, cellText(cell)))
      : h('td', { colspan: width, class: 'cell-blank' }))));
}

function cellText(cell) {
  const linkAt = cell.url && cell.linkText ? cell.text.indexOf(cell.linkText) : -1;
  if (linkAt >= 0) {
    const end = linkAt + cell.linkText.length;
    return [cell.text.slice(0, linkAt), h('a', { href: cell.url, target: '_blank', rel: 'noopener' }, cell.linkText), cell.text.slice(end)];
  }
  if (cell.url) return h('a', { href: cell.url, target: '_blank', rel: 'noopener' }, cell.text);
  if (cell.style === 'lesson') return h('span', { 'data-tip': 'No copy of this lesson yet, so no link (yet)' }, cell.text);
  return cell.text.split('\n').flatMap((line, i) => (i ? [h('br'), line] : [line]));
}
