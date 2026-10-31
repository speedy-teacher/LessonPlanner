// "Lesson copies" card (Setup › School Year): where this year's lesson copies go — a Google Drive
// folder or a folder on this computer — and how they're doing (see exportBridge.js).

import { h, toast } from '../dom.js';
import { update } from '../model.js';
import { commit, refresh } from '../store.js';
import { google } from '../google.js';
import { apiKey, clientId } from '../deviceSettings.js';
import { pickFolderFromDrive } from '../drive.js';
import { canUseComputerFolders, folderPermission, pickComputerFolder, rememberedFolder } from '../exportLocal.js';
import { copyStatus, folderKey, recheckCopies } from '../exportBridge.js';
import { current as plan } from '../workspace.js';
import { year } from './common.js';

const STATUS = {
  none: () => 'No folder chosen yet, so no copies are made.',
  checking: () => 'Checking the folder…',
  ready: () => '✓ Copies are kept up to date as you change the Lesson Schedule.',
  waiting: () => 'Connect Google Drive (above) and the copies catch up.',
  'view-only': () => 'This plan is view-only for you, so the copies are left as they are.',
  'needs-permission': () => 'The browser needs your OK again to save in this folder.',
  'other-computer': (s) => `The copies are saved on another computer${s.keeperName ? ` (chosen by ${s.keeperName})` : ''}. They update when the planner is opened there.`,
  'other-keeper': (s) => `${s.keeperName} keeps these copies — they update when ${s.keeperName} opens the planner.${s.behind ? ` (${s.behind} out of date right now.)` : ''}`,
  problem: () => 'The planner couldn’t look in this folder. It tries again after your next change.',
};

export function copiesCard() {
  const y = year();
  const output = y.output ?? null;
  const status = copyStatus();
  return h('section', { class: 'card setup-card copies-card', 'data-tour': 'copies-card' },
    h('h3', {}, 'Lesson copies'),
    h('p', { class: 'hint' }, 'Every lesson on the Lesson Schedule gets its own copy of its template, sorted into School › Grade › Week folders, with the “Filled in automatically” details typed in. Your templates are never changed. Change a lesson in its template — copies are remade when their details change.'),
    folderLine(output),
    h('p', { class: `copies-status ${status.state}` }, (STATUS[status.state] ?? STATUS.none)(status)),
    pictureProblems(status.pictures ?? []),
    buttons(output, status));
}

/** Pictures that couldn't go into copies this visit, and why (see pictureHolds.js). */
function pictureProblems(pictures) {
  if (!pictures.length) return null;
  return h('ul', { class: 'copies-pictures' }, pictures.map((p) => h('li', {},
    h('strong', {}, `⚠ ${p.picture ? `“${p.picture}”` : 'A picture'}${p.lesson ? ` (in “${p.lesson}”)` : ''}: `),
    p.onHold ? 'not in its copies yet. ' : 'trying again now. ',
    h('span', { class: 'hint' }, p.advice))));
}

function folderLine(output) {
  if (!output) return null;
  return h('p', { class: 'folder-choice' },
    h('span', {}, output.kind === 'drive' ? '☁️ Google Drive folder: ' : '💻 Folder on the computer: '),
    h('strong', {}, output.name),
    h('span', { class: 'hint' }, ` › ${plan?.name ?? 'this plan'} › School › Grade › Week`));
}

function buttons(output, status) {
  const connected = google.status === 'connected';
  return h('div', { class: 'button-row' },
    status.state === 'needs-permission' ? h('button', { class: 'btn', onclick: allowAgain }, 'Allow saving in the folder') : null,
    h('button', {
      class: 'btn light', disabled: !connected || !apiKey(),
      title: connected ? 'Opens Google’s folder picker' : 'Connect Google Drive first',
      onclick: chooseDriveFolder,
    }, output?.kind === 'drive' ? 'Choose another Drive folder…' : 'Choose a Google Drive folder…'),
    canUseComputerFolders() ? h('button', {
      class: 'btn light', onclick: chooseComputerFolder,
      'data-tip': 'Details can’t be filled in on the computer — the files are copied as they are. Google Drive templates are saved as Office files.',
    }, 'Use a folder on this computer…') : null,
    output ? h('button', { class: 'btn light danger', onclick: stopCopies }, 'Stop making copies') : null);
}

function setOutput(output) {
  const y = year();
  commit((s) => update(s, 'years', y.id, { output }));
  recheckCopies();
}

async function chooseDriveFolder() {
  const [picked] = await pickFolderFromDrive({ token: google.token, apiKey: apiKey(), clientId: clientId() }).catch(() => []);
  if (!picked) return;
  setOutput({ kind: 'drive', folderId: picked.id, name: picked.name, keeperId: google.userId, keeperName: google.userName });
  toast(`Lesson copies go to “${picked.name}” now.`);
}

async function chooseComputerFolder() {
  const handle = await pickComputerFolder(folderKey(year().id));
  if (!handle) return;
  setOutput({ kind: 'local', name: handle.name, keeperId: google.userId, keeperName: google.userName });
  toast(`Lesson copies go to “${handle.name}” on this computer now.`);
}

async function allowAgain() {
  const handle = await rememberedFolder(folderKey(year().id));
  if (handle) await folderPermission(handle, { ask: true }).catch(() => null);
  recheckCopies();
  refresh();
}

function stopCopies() {
  setOutput(null);
  toast('No more lesson copies are made. The ones already made stay where they are.');
}
