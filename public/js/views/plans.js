// Plans: each school year is one plan (a file in Google Drive, or kept on this
// computer only). The plan button in the top bar opens this menu: switch plans,
// start a new year, open one shared with you, bring in a file, download a copy.

import { h, openModal, toast } from '../dom.js';
import { suggestNextYear } from '../model.js';
import { store } from '../store.js';
import { apiKey, clientId, driveAvailable } from '../deviceSettings.js';
import { connectDrive, google } from '../google.js';
import { pickPlanFromDrive } from '../drive.js';
import { listPlanFiles } from '../driveFiles.js';
import { fromWorkspaceFile, newYearPlan } from '../workspaceFile.js';
import {
  allCachedPlans, computerPlans, createPlan, current, downloadCopy, importPlannerData, moveToDrive, oldPlannerData,
  openDrivePlan, openSavedPlan, removeComputerPlan,
} from '../workspace.js';
import { showNotice } from '../notices.js';

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
  return h('button', { class: 'plan-button', title: 'Switch plans, start a new year, share or download', onclick: openPlansMenu },
    h('span', { class: 'plan-icon', 'aria-hidden': 'true' }, '📒'),
    h('span', { class: 'plan-name' }, current.name),
    whereTag(current), ' ▾');
}

function whereTag(plan) {
  if (!plan.fileId) return h('span', { class: 'where-tag local' }, 'this computer only');
  if (plan.canEdit === false) return h('span', { class: 'where-tag view' }, 'view only');
  return null;
}

export function openPlansMenu() {
  openModal('Your plans', (close) => plansPanel(close));
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
    h('div', { class: 'plans-actions' },
      h('button', { class: 'btn', onclick: () => { close(); openNewYear(); } }, '🌱 Start a new school year'),
      h('button', { class: 'btn light', onclick: done(openShared), disabled: !driveConnected() || !apiKey(), title: driveConnected() ? '' : 'Connect Google Drive first' }, '🤝 Open a plan shared with me'),
      fileButton(close)),
    oldPlannerOffer(close));
}

function thisPlan(done) {
  return h('div', { class: 'plans-section this-plan' },
    h('h3', {}, 'Open now: ', current.name),
    h('div', { class: 'button-row' },
      h('button', { class: 'btn small light', onclick: downloadCopy, title: 'Saves this plan as a file you can keep or send' }, '⬇ Download a copy'),
      !current.fileId && driveConnected()
        ? h('button', { class: 'btn small', onclick: done(async () => { await moveToDrive(); toast('This plan is now in your Google Drive.'); }) }, '☁ Save to Google Drive')
        : null,
      current.fileId ? h('a', { class: 'btn small light', href: `https://drive.google.com/file/d/${encodeURIComponent(current.fileId)}/view`, target: '_blank', rel: 'noopener', title: 'Open the file in Google Drive (to share it, or see past versions)' }, 'Share or see past versions in Drive ↗') : null));
}

function drivePlans(close) {
  const box = h('div', { class: 'plans-section' }, h('h3', {}, '☁ In Google Drive'));
  if (!driveAvailable()) {
    box.append(h('p', { class: 'google-status error' }, 'Google Drive isn’t set up for this website yet — see the error in the bottom-left corner.'));
    return box;
  }
  if (!driveConnected()) {
    box.append(h('p', { class: 'hint' }, 'Connect Google Drive to see your plans there, and to use them on any computer.'),
      h('button', { class: 'btn', disabled: google.status === 'working', onclick: () => connectDrive(clientId()) },
        google.status === 'working' ? 'Connecting…' : 'Connect Google Drive'),
      google.message ? h('p', { class: `google-status ${google.status === 'error' ? 'error' : ''}` }, google.message) : null);
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
    const copied = new Set(plans.flatMap((p) => p.state.years.map((y) => y.id)));
    if (!state || state.years.every((y) => copied.has(y.id))) return;
    box.replaceChildren(h('div', { class: 'plans-section old-planner' },
      h('h3', {}, '📦 Your plans from the planner on this computer'),
      h('p', { class: 'hint' }, driveConnected()
        ? 'Copy them into your Google Drive (one plan per school year). Nothing is deleted here.'
        : 'Connect Google Drive first to copy them there — or copy them into this browser now.'),
      h('button', { class: 'btn', onclick: async () => {
        close();
        const made = await attempt(() => importPlannerData(state));
        if (made) toast(`Copied ${made.map((p) => p.name).join(', ')}${driveConnected() ? ' to Google Drive' : ''}.`);
      } }, driveConnected() ? 'Move my plans to Google Drive' : 'Copy my plans into this browser')));
  });
  return box;
}

// ---------- new school year ----------

export function openNewYear() {
  const from = store.state?.years.find((y) => y.id === store.state.activeYearId);
  const next = from ? suggestNextYear(from) : { name: '', startDate: '', endDate: '' };
  openModal('Start a new school year', (close) => {
    const name = h('input', { value: next.name });
    const start = h('input', { type: 'date', value: next.startDate });
    const end = h('input', { type: 'date', value: next.endDate });
    const copy = h('input', { type: 'checkbox', checked: Boolean(from) });
    const create = async () => {
      if (!name.value.trim() || !start.value || !end.value || end.value < start.value) {
        toast('Please give the year a name, and a last day after the first day.');
        return;
      }
      close();
      const plan = newYearPlan(store.state, { name: name.value.trim(), startDate: start.value, endDate: end.value }, { copy: copy.checked });
      const made = await attempt(() => createPlan(plan));
      if (made) toast(`Welcome to ${name.value.trim()}! Switch back to past years with the plan button at the top.`);
    };
    return h('div', { class: 'modal-body' },
      h('label', { class: 'field' }, h('span', {}, 'Name'), name),
      h('div', { class: 'two-col' },
        h('label', { class: 'field' }, h('span', {}, 'First day'), start),
        h('label', { class: 'field' }, h('span', {}, 'Last day'), end)),
      from ? h('label', { class: 'check big' }, copy,
        `Copy schools, grades, instruments, lesson decks and essential outcomes (with eval criteria and lesson order) from ${from.name}`) : null,
      h('p', { class: 'hint' }, driveConnected()
        ? 'It’s saved as a new plan in your Google Drive. Calendars start empty; past years stay just as they are.'
        : 'Google Drive isn’t connected, so it’s kept on this computer for now (you can save it to Drive later). Calendars start empty.'),
      h('div', { class: 'button-row end' },
        h('button', { class: 'btn light', onclick: close }, 'Cancel'),
        h('button', { class: 'btn', onclick: create }, 'Create year')));
  });
}
