// The right side of "Images": the chosen picture's name, sharing, description, tags (your own tag
// groups), instruments, when it fits (imageWhen.js), and which lessons on the schedule get it.

import { editable, h, toast } from '../dom.js';
import { add, find, remove, update } from '../model.js';
import { addTag, editImage, tagsByGroup } from '../library.js';
import { driveOpenUrl, findLocation } from '../locations.js';
import { commit, setUi, store, undo } from '../store.js';
import { checkSharing, isShared, shareRefused } from '../imageSharing.js';
import { imageUses } from '../imagePick.js';
import { google } from '../google.js';
import { current, emptyNote, menuItem, popMenu, year } from './common.js';
import { askName } from './folderTree.js';
import { whenEditor } from './imageWhen.js';

const change = (image, fields) => commit((s) => editImage(s, image.id, fields));

export function imageDetails(image) {
  return h('div', { class: 'image-details' },
    h('label', { class: 'field' }, h('span', {}, 'Name'),
      editable(image.name, (name) => change(image, { name }))),
    newBanner(image),
    driveLine(image),
    sharingLine(image),
    h('label', { class: 'field' }, h('span', {}, 'Description'),
      editable(image.description, (description) => change(image, { description }), { allowEmpty: true, placeholder: 'e.g. Waving under a “Welcome” banner' })),
    tagSection(image),
    instrumentSection(image),
    whenEditor(image),
    usedBy(image),
    h('div', { class: 'button-row' },
      h('button', { class: 'btn light danger', onclick: () => removeImage(image), title: 'Only the planner’s details go. The picture stays in Google Drive.' }, 'Remove from Planner')));
}

function newBanner(image) {
  if (!image.isNew) return null;
  return h('div', { class: 'new-banner' },
    h('span', { class: 'new-mark' }, '!'),
    h('span', {}, 'Newly added from a watched Google Drive folder. Tag it — or click “Got it”.'),
    h('button', { class: 'btn small light', onclick: () => change(image, {}) }, 'Got it'));
}

function driveLine(image) {
  const loc = findLocation(image, 'drive');
  if (!loc) return null;
  return h('p', { class: 'deck-source' }, '☁️ ',
    h('a', { href: driveOpenUrl(loc), target: '_blank', rel: 'noopener', title: 'Opens the picture in a new tab' }, 'Open in Google Drive ↗'));
}

function sharingLine(image) {
  const shared = isShared(image);
  if (shareRefused(image)) {
    return h('div', { class: 'share-line warn-box' },
      h('strong', {}, '⚠ Couldn’t be placed in lesson copies'),
      h('span', {}, 'Google didn’t let the planner share it for a moment to place it. In Google Drive: open the picture → Share → General access → “Anyone with the link” (Viewer). It can stay that way.'),
      h('button', { class: 'btn small light', onclick: () => checkSharing([image], { again: true }) }, 'Check again'));
  }
  if (shared === true) return h('p', { class: 'share-line ok' }, '✓ Shared with “Anyone with the link” in Google Drive.');
  if (shared === null) {
    return h('p', { class: 'share-line' }, google.status === 'connected' ? 'Checking how it’s shared…' : 'Connect Google Drive to check how it’s shared.');
  }
  return h('p', { class: 'share-line' }, '🔒 Private. To place it in a lesson copy, the planner shares it with “Anyone with the link” for a few seconds while Google fetches it, then turns that off again.');
}

// ---------- tags ----------

function tagSection(image) {
  const groups = tagsByGroup(store.state, year().id);
  return h('section', { class: 'image-section' },
    h('div', { class: 'section-head' }, h('h3', {}, 'Tags'),
      h('button', { class: 'icon-btn add-icon', 'data-tip': 'New tag category', 'aria-label': 'New tag category', onclick: newTagGroup }, '＋')),
    groups.length ? null : h('p', { class: 'hint' }, 'Use ＋ to make your own tag categories — e.g. “Season” or “Theme”.'),
    groups.map(({ group, tags }) => tagGroupRow(image, group, tags)));
}

function tagGroupRow(image, group, tags) {
  const addInput = h('input', {
    class: 'tag-add', placeholder: '+ tag', 'aria-label': `New ${group.name} tag`,
    onkeydown: (e) => {
      const name = e.target.value.trim();
      if (e.key !== 'Enter' || !name) return;
      commit((s) => { const tag = addTag(s, { yearId: year().id, groupId: group.id, name }); editImage(s, image.id, (i) => { if (!i.tagIds.includes(tag.id)) i.tagIds.push(tag.id); }); });
    },
  });
  return h('div', { class: 'tag-group' },
    h('div', { class: 'tag-group-head' }, h('span', {}, group.name), tagGroupMenu(group)),
    h('div', { class: 'tag-chips' }, tags.map((tag) => tagChip(image, tag)), addInput));
}

function tagChip(image, tag) {
  const on = image.tagIds.includes(tag.id);
  return h('button', {
    class: `tag-chip ${on ? 'on' : ''}`, 'aria-pressed': on ? 'true' : 'false',
    onclick: () => change(image, (i) => { i.tagIds = on ? i.tagIds.filter((id) => id !== tag.id) : [...i.tagIds, tag.id]; }),
  }, tag.name);
}

function tagGroupMenu(group) {
  const tags = store.state.tags.filter((t) => t.groupId === group.id);
  return popMenu({ label: '⋯', title: `Options for ${group.name}`, menuClass: 'folder-menu' },
    menuItem('Rename', () => askName('Rename tag category', group.name, (name) => commit((s) => update(s, 'tagGroups', group.id, { name }))), { icon: '✏️' }),
    tags.length ? h('div', { class: 'menu-group' }, 'Remove a tag') : null,
    tags.map((t) => menuItem(t.name, () => removeTag(t), { icon: '×', tip: 'Removes this tag from every picture' })),
    menuItem(`Remove “${group.name}”`, () => removeTagGroup(group), { icon: '🗑️', tip: 'Removes this tag category and its tags from every picture' }));
}

function newTagGroup() {
  askName('New tag category', '', (name) => commit((s) => add(s, 'tagGroups', { yearId: year().id, name })), 'e.g. Season');
}

function removeTag(tag) {
  commit((s) => remove(s, 'tags', tag.id));
  toast(`Removed the tag “${tag.name}”.`, { label: 'Undo', run: undo });
}

function removeTagGroup(group) {
  commit((s) => remove(s, 'tagGroups', group.id));
  toast(`Removed “${group.name}” and its tags.`, { label: 'Undo', run: undo });
}

// ---------- instruments ----------

function instrumentSection(image) {
  const instruments = current('instruments');
  if (!instruments.length) return null;
  return h('section', { class: 'image-section' },
    h('h3', {}, 'Instruments it shows'),
    h('p', { class: 'hint' }, 'When pictures fit a week equally well, one showing an instrument the lesson uses is chosen first.'),
    h('div', { class: 'grade-toggles' }, instruments.map((i) => {
      const on = image.instrumentIds.includes(i.id);
      return h('button', {
        class: `grade-toggle ins-toggle ${on ? 'on' : ''}`, style: { '--ins': i.color }, 'aria-pressed': on ? 'true' : 'false',
        onclick: () => change(image, (x) => { x.instrumentIds = on ? x.instrumentIds.filter((id) => id !== i.id) : [...x.instrumentIds, i.id]; }),
      }, i.name);
    })));
}

// ---------- where it's used ----------

const nameOf = (collection, id) => find(store.state, collection, id)?.name ?? '';

function usedBy(image) {
  const uses = imageUses(store.state, image.id, isShared);
  return h('section', { class: 'image-section' },
    h('h3', {}, 'Lessons that get this picture', uses.length ? h('span', { class: 'count-badge' }, uses.length) : null),
    uses.length ? null : emptyNote('None on the Lesson Schedule right now. (Only lessons with “Picture” ticked under “Filled in automatically” get one.)'),
    uses.length && shareRefused(image) ? h('p', { class: 'warn-box' }, '⚠ These lessons can’t show it until it’s shared with “Anyone with the link” in Google Drive.') : null,
    h('ul', { class: 'usage-copies' }, uses.map(({ entry, week }) => h('li', {},
      h('button', { class: 'link-btn', onclick: () => setUi({ tab: 'lessons', lessonId: entry.lessonId }) },
        `${nameOf('lessons', entry.lessonId)} — ${nameOf('schools', entry.schoolId)} › ${nameOf('grades', entry.gradeId)} › Week ${week?.number ?? '?'}`)))));
}

function removeImage(image) {
  commit((s) => remove(s, 'images', image.id));
  setUi({ imageId: null });
  toast(`Removed “${image.name}” from the planner. The picture is still in Google Drive.`, { label: 'Undo', run: undo });
}
