// Plans: each school year is one plan (a file in Google Drive, or kept on this
// computer only). The plan button in the top bar opens this menu: switch plans,
// start a new year, open one shared with you, bring in a file, download a copy.

import { h, openModal, toast, tour } from '../dom.js';
import { suggestNextYear } from '../model.js';
import { apiKey, clientId, driveAvailable } from '../deviceSettings.js';
import { connectDrive, google } from '../google.js';
import { pickPlanFromDrive } from '../drive.js';
import { listPlanFiles } from '../driveFiles.js';
import { broughtInYearIds } from '../planList.js';
import { fromWorkspaceFile, newYearPlan } from '../workspaceFile.js';
import {
  allCachedPlans, computerPlans, current, downloadCopy, importPlannerData, moveToDrive, myPlanState, oldPlannerData,
  openDrivePlan, openSavedPlan, pieces, removeComputerPlan, saveOpenPlan, startNewYear,
} from '../workspace.js';
import { showNotice } from '../notices.js';
import { askFolderThen, currentFolderRow, folderChooser } from './planFolders.js';
import { canMoveToPieces, joinFlow, openShareSetup } from './shareSetup.js';

const PROBLEMS = {
  signed_out: 'Google signed you out. Click anywhere to reconnect, then try again.',
  offline: 'Couldn’t reach Google. Check the internet connection and try again.',
  not_a_plan: 'That file isn’t a Lesson Planner plan.',
  no_access: 'Google Drive didn’t allow opening that file.',
  not_found: 'That file is gone from Google Drive.',
};

/** Run a plan action; explain anything that goes wrong in plain words. */
async function attempt(action) {
  try {
    return await action();
  } catch (err) {
    console.warn(err);
    showNotice({ id: 'plans', tone: 'error', title: 'Plans', message: PROBLEMS[err.message] || 'Something went wrong. Please try again in a minute.' });
    return null;
  }
}

const driveConnected = () => google.status === 'connected';

// ---------- top bar ----------

/** The open plan's name in the top bar; click to switch plans. */
export function planButton() {
  if (!current) return null;
  return h('button', { class: 'plan-button', 'data-tour': 'plan-button', title: 'Switch plans, start a new year, share or download', onclick: openPlansMenu },
    h('span', { class: 'plan-icon', 'aria-hidden': 'true' }, '📒'),
    h('span', { class: 'plan-name' }, current.name),
    whereTag(current), ' ▾');
}

function whereTag(plan) {
  if (!plan.fileId) return h('span', { class: 'where-tag local' }, 'this computer only');
  if (plan.canEdit === false) return h('span', { class: 'where-tag view' }, 'view only');
  return null;
}

let liveMenu = null; // the open plans menu: { holder, close, status }

export function openPlansMenu() {
  openModal('Your plans', (close) => {
    const holder = h('div', {}, plansPanel(close));
    liveMenu = { holder, close, status: google.status };
    return holder;
  });
}

/** Redraw the open plans menu (and new-year window) when the Google Drive connection changes (e.g. it finishes connecting). */
export function refreshPlansMenu() {
  refreshNewYear();
  if (!liveMenu?.holder.isConnected) { liveMenu = null; return; }
  if (liveMenu.status === google.status) return;
  liveMenu.status = google.status;
  liveMenu.holder.replaceChildren(plansPanel(liveMenu.close));
}

/** Shown in place of the planner when no plan is open yet (the first visit on a computer). */
export function welcome() {
  return h('section', { class: 'card welcome-card' },
    h('h2', {}, '🎵 Welcome to the Lesson Planner'),
    h('p', {}, 'Each school year is one plan. Keep it in your Google Drive to use it on any computer (and share it), or keep it on this computer only.'),
    plansPanel(() => {}));
}

// ---------- the plans menu ----------

function plansPanel(close) {
  const done = (fn) => async () => { if (await attempt(fn) !== null) close(); };
  return h('div', { class: 'plans-panel' },
    current ? thisPlan(done) : null,
    drivePlans(close),
    computerPlanList(close),
    h('div', { class: 'plans-actions', 'data-tour': 'plans-actions' },
      h('button', { class: 'btn', 'data-tour': 'start-year', onclick: () => { close(); openNewYear(); } }, '🌱 Start a new school year'),
      h('button', { class: 'btn light', onclick: done(openShared), disabled: !driveConnected() || !apiKey(), title: driveConnected() ? '' : 'Connect Google Drive first' }, '🤝 Open a plan shared with me'),
      fileButton(close)),
    oldPlannerOffer(close));
}

function thisPlan(done) {
  return h('div', { class: 'plans-section this-plan' },
    h('h3', {}, 'Open now: ', current.name),
    current.fileId && driveConnected() ? currentFolderRow(attempt) : null,
    h('div', { class: 'button-row' },
      h('button', { class: 'btn small light', onclick: downloadCopy, title: 'Saves this plan as a file you can keep or send' }, '⬇ Download a copy'),
      !current.fileId && driveConnected()
        ? h('button', { class: 'btn small', onclick: done(saveToDrive) }, '☁ Save to Google Drive')
        : null,
      pieces ? piecesButtons() : oneFileButtons()));
}

/** The buttons of an older one-file plan. */
function oneFileButtons() {
  return [
    current.fileId ? driveLink(current.fileId, 'Share or see past versions in Drive ↗', 'Open the file in Google Drive (to share it, or see past versions)') : null,
    canMoveToPieces()
      ? h('button', { class: 'btn small', 'data-tour': 'share-department', onclick: openShareSetup, title: 'Share the School Year with colleagues; your lessons and templates stay yours' }, '🤝 Share with your department…')
      : null,
  ];
}

/** The buttons of a plan in pieces: share the School Year, or use a colleague's. */
function piecesButtons() {
  const year = pieces.recs.schoolYear;
  const own = Boolean(year?.fileId) && year.canEdit !== false;
  return [
    own ? tour('share-school-year', driveLink(year.fileId, 'Share the School Year in Drive ↗', 'Open the School Year in Google Drive to share it with your department')) : null,
    current.fileId && driveConnected()
      ? h('button', {
        class: 'btn small light', 'data-tour': 'use-colleague-year', onclick: () => { liveMenu?.close(); joinFlow({ title: 'Use a colleague’s School Year' }); },
        title: 'Use the School Year a colleague already made; your lessons, templates and pictures stay yours',
      }, '🤝 Use a colleague’s School Year…')
      : null,
  ];
}

function driveLink(fileId, label, title) {
  return h('a', { class: 'btn small light', href: `https://drive.google.com/file/d/${encodeURIComponent(fileId)}/view`, target: '_blank', rel: 'noopener', title }, label);
}

function saveToDrive() {
  askFolderThen({
    title: 'Save to Google Drive', button: 'Save to Drive',
    text: `${current.name} will be saved in your Google Drive, so you can use it on any computer.`,
    action: async (folderId) => {
      if (await attempt(() => moveToDrive({ folderId })) !== null) toast('This plan is now in your Google Drive.');
    },
  });
}

function drivePlans(close) {
  const box = h('div', { class: 'plans-section', 'data-tour': 'welcome-drive' }, h('h3', {}, '☁ In Google Drive'));
  if (!driveAvailable()) {
    box.append(h('p', { class: 'google-status error' }, 'Google Drive isn’t set up for this website yet — see the error in the bottom-left corner.'));
    return box;
  }
  if (!driveConnected()) {
    // h() skips empty parts (plain .append would write "null").
    box.append(h('div', { class: 'plans-stack' }, h('p', { class: 'hint' }, 'Connect Google Drive to see your plans there, and to use them on any computer.'),
      h('button', { class: 'btn', disabled: google.status === 'working', onclick: () => connectDrive(clientId()) },
        google.status === 'working' ? 'Connecting…' : 'Connect Google Drive'),
      google.message ? h('p', { class: `google-status ${google.status === 'error' ? 'error' : ''}` }, google.message) : null));
    return box;
  }
  const list = h('ul', { class: 'plan-list' }, h('li', { class: 'hint' }, 'Looking in your Drive…'));
  box.append(list);
  attempt(() => listPlanFiles(google.token)).then((files) => {
    if (!files) return list.replaceChildren();
    if (!files.length) return list.replaceChildren(h('li', { class: 'hint' }, 'No plans in your Drive yet.'));
    return list.replaceChildren(...files.map((f) => planRow({
      name: f.name, isOpen: current?.fileId === f.fileId,
      note: f.ownedByMe ? '' : `shared by ${f.owner || 'someone'}${f.canEdit ? '' : ' · view only'}`,
      open: async () => { close(); await attempt(() => openDrivePlan(f.fileId)); },
    })));
  });
  return box;
}

function computerPlanList(close) {
  const box = h('div', { class: 'plans-section' });
  computerPlans().then((plans) => {
    if (!plans.length) return;
    box.replaceChildren(h('h3', {}, '💻 On this computer only'),
      h('ul', { class: 'plan-list' }, plans.map((p) => planRow({
        name: p.name, isOpen: current?.key === p.key,
        open: async () => { close(); await openSavedPlan(p.key); },
        remove: current?.key === p.key ? null : () => confirmRemove(p, close),
      }))));
  });
  return box;
}

function planRow({ name, note = '', isOpen, open, remove = null }) {
  return h('li', { class: `plan-row ${isOpen ? 'open' : ''}` },
    h('button', { class: 'plan-open', onclick: open, disabled: isOpen }, h('span', {}, name), note ? h('span', { class: 'hint' }, note) : null, isOpen ? h('span', { class: 'where-tag' }, 'open now') : null),
    remove ? h('button', { class: 'icon-btn', title: `Remove ${name} from this computer`, 'aria-label': `Remove ${name}`, onclick: remove }, '×') : null);
}

function confirmRemove(plan, closeMenu) {
  closeMenu();
  openModal(`Remove ${plan.name}?`, (close) => h('div', { class: 'modal-body' },
    h('p', {}, 'This plan is only on this computer, so removing it deletes it for good. Download a copy first if you might want it.'),
    h('div', { class: 'button-row end' },
      h('button', { class: 'btn light', onclick: close }, 'Keep it'),
      h('button', { class: 'btn danger', onclick: async () => { await removeComputerPlan(plan.key); close(); toast(`Removed ${plan.name}.`); } }, 'Remove'))));
}

async function openShared() {
  const [picked] = await pickPlanFromDrive({ token: google.token, apiKey: apiKey(), clientId: clientId() });
  if (picked) await openDrivePlan(picked.id);
}

/** Bring in a plan file (or an older planner file) from this computer. */
function fileButton(close) {
  const input = h('input', {
    type: 'file', accept: '.json,application/json', hidden: true,
    onchange: async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      close();
      const made = await attempt(async () => importPlannerData(fromWorkspaceFile(await file.text())));
      if (made) toast(`Brought in ${made.map((p) => p.name).join(', ')}.`);
    },
  });
  return h('label', { class: 'btn light' }, '📂 Open a plan file from this computer', input);
}

/** When the older planner's data is on this computer: offer to move it (once per year in it). */
function oldPlannerOffer(close) {
  const box = h('div', {});
  Promise.all([oldPlannerData(), allCachedPlans()]).then(([state, plans]) => {
    const copied = broughtInYearIds(plans);
    if (!state || state.years.every((y) => copied.has(y.id))) return;
    box.replaceChildren(h('div', { class: 'plans-section old-planner' },
      h('h3', {}, '📦 Your plans from the planner on this computer'),
      h('p', { class: 'hint' }, driveConnected()
        ? 'Copy them into your Google Drive (one plan per school year). Nothing is deleted here.'
        : 'Connect Google Drive first to copy them there — or copy them into this browser now.'),
      h('button', { class: 'btn', onclick: () => { close(); copyOldPlans(state); } },
        driveConnected() ? 'Move my plans to Google Drive' : 'Copy my plans into this browser')));
  });
  return box;
}

async function bringIn(state, folderId = null) {
  const made = await attempt(() => importPlannerData(state, { folderId }));
  if (made) toast(`Copied ${made.map((p) => p.name).join(', ')}${driveConnected() ? ' to Google Drive' : ''}.`);
}

function copyOldPlans(state) {
  if (!driveConnected()) return bringIn(state);
  return askFolderThen({
    title: 'Move my plans to Google Drive', button: 'Move to Drive',
    text: 'Each school year becomes its own plan file in your Google Drive. Nothing is deleted on this computer.',
    action: (folderId) => bringIn(state, folderId),
  });
}

// ---------- new school year ----------

// The new-year window's Google Drive parts, redrawn when the connection changes: the click that opened the
// window also renews the sign-in, and the year must not be kept on this computer just because Drive was a
// moment late. { el, status, draw }
let liveNewYear = null;

export function openNewYear() {
  const own = current ? myPlanState() : null;
  const from = own?.years.find((y) => y.id === own.activeYearId);
  const next = from ? suggestNextYear(from) : { name: '', startDate: '', endDate: '' };
  openModal('Start a new school year', (close) => {
    const fields = { name: h('input', { value: next.name }), start: h('input', { type: 'date', value: next.startDate }), end: h('input', { type: 'date', value: next.endDate }) };
    const copy = h('input', { type: 'checkbox', checked: Boolean(from) });
    const bring = h('input', { type: 'checkbox', checked: true });
    const ownBox = h('div', {}, ownYearFields({ ...fields, copy, from }));
    const bringBox = h('div', { hidden: true }, from ? h('label', { class: 'check big' }, bring, `Bring my lesson order, templates and pictures from ${from.name}`) : null);
    const drive = { el: h('div', {}), kind: null, folder: null };
    const draw = () => {
      drive.folder = driveConnected() ? folderChooser() : null;
      drive.kind = schoolYearChoice((joining) => { ownBox.hidden = joining; bringBox.hidden = !joining; });
      ownBox.hidden = false;
      bringBox.hidden = true;
      drive.el.replaceChildren(...[drive.kind.el, ownBox, bringBox, drive.folder?.el, newYearHint()].filter(Boolean));
    };
    draw();
    liveNewYear = { el: drive.el, status: google.status, draw };
    const folderId = () => drive.folder?.folderId() ?? null;
    const create = () => (drive.kind.joining()
      ? joinColleague(close, { copy: bring.checked, folderId: folderId() })
      : makeYear(close, { ...fields, copy: copy.checked, folderId: folderId() }));
    return h('div', { class: 'modal-body' }, drive.el,
      h('div', { class: 'button-row end' },
        h('button', { class: 'btn light', onclick: close }, 'Cancel'),
        h('button', { class: 'btn', onclick: create }, 'Create year')));
  });
}

/** Redraw the new-year window's Google Drive parts when the connection changes (names and dates typed stay). */
function refreshNewYear() {
  if (!liveNewYear?.el.isConnected) { liveNewYear = null; return; }
  if (liveNewYear.status === google.status) return;
  liveNewYear.status = google.status;
  liveNewYear.draw();
}

function newYearHint() {
  return h('p', { class: 'hint' }, driveConnected()
    ? 'It’s saved in your Google Drive as a new School Year (to share with your department) and your Lesson Schedule. Calendars start empty; past years stay just as they are.'
    : 'Google Drive isn’t connected, so it’s kept on this computer for now (you can save it to Drive later). Calendars start empty.');
}

/** Name, dates and what to copy, for making a School Year of one's own. */
function ownYearFields({ name, start, end, copy, from }) {
  return [
    h('label', { class: 'field' }, h('span', {}, 'Name'), name),
    h('div', { class: 'two-col' },
      h('label', { class: 'field' }, h('span', {}, 'First day'), start),
      h('label', { class: 'field' }, h('span', {}, 'Last day'), end)),
    from ? h('label', { class: 'check big' }, copy,
      `Copy schools, grades, instruments, events and essential outcomes (with evals and your lesson order) from ${from.name}. Your templates and pictures always come along.`) : null,
  ];
}

/**
 * Make a new School Year, or use one a colleague already made (shown when Drive is connected only).
 * `onChange(joining)` is told when the choice changes; `joining()` says which is picked.
 */
function schoolYearChoice(onChange) {
  let joining = false;
  const radio = (value, text) => h('label', { class: 'check big' },
    h('input', { type: 'radio', name: 'new-year-school-year', checked: value === 'make', onchange: () => { joining = value === 'join'; onChange(joining); } }), text);
  const el = driveConnected()
    ? h('div', { class: 'field', 'data-tour': 'new-year-school-year' }, radio('make', '🌱 Make a new School Year'), radio('join', '🤝 Use one a colleague already made'))
    : null;
  return { el, joining: () => joining };
}

async function makeYear(close, { name, start, end, copy, folderId }) {
  if (!name.value.trim() || !start.value || !end.value || end.value < start.value) {
    toast('Please give the year a name, and a last day after the first day.');
    return;
  }
  close();
  const made = await attempt(() => startNewYear({ name: name.value.trim(), startDate: start.value, endDate: end.value }, { copy, folderId }));
  if (made) toast(`Welcome to ${name.value.trim()}! Switch back to past years with the plan button at the top.`);
}

/** Pick the colleague's School Year; this year's name and dates come from it. */
async function joinColleague(close, { copy, folderId }) {
  close();
  await saveOpenPlan();
  const mine = (shared) => {
    const year = shared.years[0];
    return newYearPlan(current ? myPlanState() : null, { name: year.name, startDate: year.startDate, endDate: year.endDate }, { copy }).state;
  };
  joinFlow({ title: 'Use a colleague’s School Year', mine, folderId });
}
