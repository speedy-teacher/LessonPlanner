// Which Google Drive folder a plan lives in: choose one when a plan goes into Drive,
// and move the open plan to another folder later. (Google's own folder picker is used,
// which also gives the planner permission to save in the folder you pick.)

import { h, openModal, toast } from '../dom.js';
import { apiKey, clientId } from '../deviceSettings.js';
import { google } from '../google.js';
import { pickFolderFromDrive } from '../drive.js';
import { FOLDER_NAME } from '../driveFiles.js';
import { current, moveCurrentPlan, planFolderName } from '../workspace.js';

const DEFAULT_LABEL = `${FOLDER_NAME} (made for you)`;

async function pickFolder() {
  const [picked] = await pickFolderFromDrive({ token: google.token, apiKey: apiKey(), clientId: clientId() });
  return picked ? { id: picked.id, name: picked.name } : null;
}

/**
 * "📁 Save in: <folder>  [Choose a folder…]". Starts at the open plan's folder (so a school's years
 * stay together), or the "Lesson Planner" folder. `chooser.folderId()` = the choice (null = default).
 */
export function folderChooser() {
  let folderId = current?.fileId ? current.folderId ?? null : null;
  const label = h('strong', {}, folderId ? 'the same folder as this plan' : DEFAULT_LABEL);
  if (folderId) planFolderName().then((name) => { if (name) label.textContent = name; }, () => {});
  const choose = h('button', {
    class: 'btn small light', type: 'button', disabled: !apiKey(),
    onclick: async () => {
      const picked = await pickFolder().catch(() => null);
      if (!picked) return;
      folderId = picked.id;
      label.textContent = picked.name;
    },
  }, 'Choose a folder…');
  const el = h('div', { class: 'folder-choice' }, h('span', {}, '📁 Save in Google Drive: '), label, choose);
  return { el, folderId: () => folderId };
}

/** Ask where in Drive to put plans, then run `action(folderId)`. */
export function askFolderThen({ title, text, button, action }) {
  openModal(title, (close) => {
    const chooser = folderChooser();
    return h('div', { class: 'modal-body' },
      h('p', {}, text),
      chooser.el,
      h('div', { class: 'button-row end' },
        h('button', { class: 'btn light', onclick: close }, 'Cancel'),
        h('button', { class: 'btn', onclick: () => { close(); action(chooser.folderId()); } }, button)));
  });
}

/** "📁 In folder: <name>  [Move to another folder…]" for the open Drive plan. */
export function currentFolderRow(attempt) {
  const name = h('strong', {}, '…');
  planFolderName().then((n) => { name.textContent = n || '—'; }, () => { name.textContent = '—'; });
  const move = async () => {
    const picked = await attempt(pickFolder);
    if (!picked || picked.id === current.folderId) return;
    if (await attempt(() => moveCurrentPlan(picked.id)) === null) return;
    name.textContent = picked.name;
    toast(`Moved ${current.name} to “${picked.name}”.`);
  };
  return h('div', { class: 'folder-choice' },
    h('span', {}, '📁 In folder: '), name,
    current.canEdit === false ? null
      : h('button', { class: 'btn small light', disabled: !apiKey(), onclick: move }, 'Move to another folder…'));
}
