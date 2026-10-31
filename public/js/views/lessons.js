// "Lesson Templates": the library of lessons. Each lesson is one slide deck.
// Built for dozens of decks: search, categories, and which evals use each one.

import { editable, h, toast } from '../dom.js';
import {
  addStep, AUTO_FIELD_PLACEHOLDERS, AUTO_FIELDS, criteriaFor, PICTURE_FIELDS, TEXT_FIELDS, duplicateLesson, editLesson, find, lessonEvals, lessonUsageByGrade, outcomeLabel, remove,
} from '../model.js';
import { addDeck, foldersIn, moveDeck } from '../library.js';
import { canFillIn, driveOpenLabel, driveOpenUrl, fillInProblem } from '../locations.js';
import { commit, setUi, store, undo } from '../store.js';
import { current, emptyNote, year } from './common.js';
import { lessonPreview } from './lessonPreview.js';
import { showEval } from './outcomes.js';
import { deckTree, instrumentFilter, openFolders, visibleDecks } from './deckTree.js';
import { addMenu } from './deckImport.js';
import { copiesOfLesson, copyStatus } from '../exportBridge.js';
import { lessonPictures, wantsPicture } from '../imagePick.js';
import { checkSharing, isShared, shareRefused } from '../imageSharing.js';

function selectedLesson() {
  const l = find(store.state, 'lessons', store.ui.lessonId);
  return l && l.yearId === year().id ? l : visibleDecks()[0] || null;
}

/** A new lesson deck with the usual details filled in (used by the Outcomes tab too). */
export function newLesson(state, name, category = '') {
  return addDeck(state, { yearId: year().id, name, category });
}

export function renderLessons() {
  const selected = selectedLesson();
  return h('div', { class: 'outcomes-layout templates-layout' },
    h('aside', { class: 'side card deck-side' },
      h('div', { class: 'deck-side-head' },
        h('h3', {}, 'Lesson templates', h('span', { class: 'count-badge' }, current('lessons').length)),
        addMenu()),
      h('input', {
        class: 'search', type: 'search', placeholder: '🔍 Search lessons…', value: store.ui.lessonSearch || '',
        dataset: { key: 'lesson-search' },
        oninput: (e) => setUi({ lessonSearch: e.target.value }),
      }),
      instrumentFilterChip(),
      deckTree(selected)),
    h('section', { class: 'main-col card' },
      selected ? lessonEditor(selected) : emptyNote('Add a lesson deck to get started.')),
  );
}

/** "Only lessons that use Ukulele ×" — after choosing "Lessons that use …" on an instrument. */
function instrumentFilterChip() {
  const ins = instrumentFilter();
  if (!ins) return null;
  return h('div', { class: 'ins-filter' },
    h('span', {}, 'Only lessons that use'),
    h('span', { class: 'ins-tag', style: { '--ins': ins.color } }, ins.name),
    h('button', { class: 'btn small light', title: 'Show all lessons again', onclick: () => setUi({ lessonInstrumentId: null }) }, '× Show all'));
}

function lessonEditor(l) {
  const categories = [...new Set(current('lessons').filter((x) => x.category).map((x) => x.category))].sort();
  const fillable = canFillIn(l);
  const fields = fillable ? TEXT_FIELDS.map((key) => ({ key, label: AUTO_FIELDS[key], value: '' })) : [];
  return h('div', { class: 'template-editor' },
    h('div', { class: 'editor-head' },
      h('label', { class: 'field grow' }, h('span', {}, 'Lesson name'),
        editable(l.name, (name) => commit((s) => editLesson(s, l.id, { name })))),
      h('label', { class: 'field' }, h('span', {}, 'Category'),
        editable(l.category, (category) => commit((s) => editLesson(s, l.id, { category })), { list: 'lesson-categories', placeholder: 'e.g. Ukulele', allowEmpty: true }),
        h('datalist', { id: 'lesson-categories' }, categories.map((c) => h('option', { value: c })))),
      folderPicker(l),
      h('button', { class: 'btn light', onclick: () => duplicate(l) }, 'Duplicate'),
      h('button', {
        class: 'btn light danger', onclick: () => deleteLesson(l),
        title: l.locations.length ? 'Only the planner’s deck goes. The slide file stays where it is.' : null,
      }, l.locations.length ? 'Remove from Planner' : 'Delete')),
    newBanner(l),
    locationList(l),
    h('div', { class: 'template-body' },
      h('div', { class: 'template-preview' }, lessonPreview(l.id, { fields })),
      h('div', {},
        h('h3', {}, 'Instruments this lesson uses'),
        h('p', { class: 'hint' }, 'The Outcome & Eval Calendar warns you if one isn’t at the school that week.'),
        instrumentToggles(l),
        fillable ? autoFieldsSection() : h('p', { class: 'hint fill-note' }, `Filled in automatically: ${fillInProblem(l)}`))),
    usedIn(l),
  );
}

/** Which folder the deck is in (decks can also be dragged onto folders on the left). */
function folderPicker(l) {
  const options = [];
  const walk = (parentId, depth) => foldersIn(store.state, year().id, parentId).forEach((f) => {
    options.push(h('option', { value: f.id, selected: f.id === l.folderId }, `${'  '.repeat(depth)}📁 ${f.name}`));
    walk(f.id, depth + 1);
  });
  walk(null, 0);
  return h('label', { class: 'field' }, h('span', {}, 'Folder'),
    h('select', {
      class: 'inline-edit',
      onchange: (e) => {
        const folderId = e.target.value || null;
        commit((s) => moveDeck(s, l.id, folderId));
        if (folderId) openFolders([folderId]);
        setUi({ deckFolderId: folderId });
      },
    }, h('option', { value: '', selected: !l.folderId }, 'Top level'), options));
}

function newBanner(l) {
  if (!l.isNew) return null;
  return h('div', { class: 'new-banner' },
    h('span', { class: 'new-mark' }, '!'),
    h('span', {}, 'Newly added from a watched Google Drive folder. Change any of its details below — or click “Got it” — to mark it as seen.'),
    h('button', { class: 'btn small light', onclick: () => commit((s) => editLesson(s, l.id, {})) }, 'Got it'));
}

/** Where the deck's slides live (it can be in more than one place). */
function locationList(l) {
  if (!l.locations.length) return null;
  return h('ul', { class: 'deck-source' }, l.locations.map((loc) => h('li', {}, locationLabel(loc))));
}

function locationLabel(loc) {
  if (loc.kind === 'drive') {
    return ['☁️ Google Drive · ', h('a', { href: driveOpenUrl(loc), target: '_blank', rel: 'noopener', title: 'Opens the file in a new tab' }, `${driveOpenLabel(loc, 'Template')} ↗`)];
  }
  const root = find(store.state, 'localRoots', loc.rootId);
  const path = root ? [root.name, loc.path].filter(Boolean).join('/') : loc.path;
  return ['💻 On the computer: ', h('code', {}, path)];
}

function instrumentToggles(l) {
  const instruments = current('instruments');
  if (!instruments.length) return emptyNote('Add instruments under Setup › School Year.');
  return h('div', { class: 'grade-toggles' }, instruments.map((i) => {
    const on = l.instrumentIds.includes(i.id);
    return h('button', {
      class: `grade-toggle ins-toggle ${on ? 'on' : ''}`,
      style: { '--ins': i.color },
      'aria-pressed': on ? 'true' : 'false',
      title: `${on ? 'Remove' : 'Add'} ${i.name}`,
      onclick: () => commit((s) => editLesson(s, l.id, {
        instrumentIds: on ? l.instrumentIds.filter((x) => x !== i.id) : [...l.instrumentIds, i.id],
      })),
    }, i.name);
  }));
}

/** Only for files that open in Google Docs, Sheets or Slides (and lessons with no file yet). */
function autoFieldsSection() {
  return [
    h('h3', {}, 'Filled in automatically'),
    h('p', { class: 'hint' }, 'When this lesson is on the Lesson Schedule, its copy gets these details filled in (see Setup › School Year › Lesson copies). In the file, type the text on the right (e.g. {{school}}) wherever a detail goes — click it to copy. Any that aren’t in the file are simply skipped.'),
    h('div', { class: 'auto-fields big' }, Object.entries(AUTO_FIELDS).map(([key, label]) => autoFieldCode(key, label))),
  ];
}

const PICTURE_TIP = 'Where the picture goes: draw a rectangle with no fill and no border, then set its alt text (Advanced options) Title and Description to IMAGE_ANCHOR. The picture for each week is chosen from the Images tab. Click to copy.';

function placeholderButton(key, label) {
  const placeholder = AUTO_FIELD_PLACEHOLDERS[key];
  const tip = PICTURE_FIELDS.includes(key) ? PICTURE_TIP : `Type ${placeholder} in the slides where the ${label.toLowerCase()} goes. Click to copy.`;
  return h('button', {
    type: 'button', class: 'placeholder-code', 'data-tip': tip,
    onclick: () => copyText(placeholder),
  }, placeholder);
}

/** Every detail is filled in wherever it's found, so just its name and the code to copy. */
function autoFieldCode(key, label) {
  return h('div', { class: 'auto-field-row' }, h('span', { class: 'check' }, label), placeholderButton(key, label));
}

function copyText(text) {
  navigator.clipboard?.writeText(text).then(() => toast(`Copied ${text}`), () => toast(`Type this: ${text}`));
}

/** Grade → essential outcome → eval, for every eval this deck is part of. */
function usedIn(l) {
  const groups = lessonUsageByGrade(store.state, l.id);
  return h('section', { class: 'used-by' },
    h('h3', {}, 'Used in the following content'),
    groups.length ? null : emptyNote('Not used in any eval yet.'),
    groups.map(({ grade, outcomes }) => h('div', { class: 'usage-grade' },
      h('h4', { class: 'group-head' }, grade ? grade.name : 'No grade chosen yet'),
      h('ul', {}, outcomes.map(({ outcome, evals }) => h('li', {},
        h('button', {
          class: 'link-btn',
          title: 'Open this outcome',
          onclick: () => setUi({ tab: 'outcomes', outcomeId: outcome?.id }),
        }, outcomeLabel(outcome)),
        h('ul', { class: 'usage-evals' }, evals.map(({ criterion, positions }) => h('li', {},
          h('button', {
            class: 'link-btn',
            title: grade ? `Open this eval, with ${grade.name}’s lesson order` : 'Open this eval',
            onclick: () => showEval(criterion, grade?.id),
          }, criterion.title),
          h('span', { class: 'hint' }, ` — lesson ${positions.join(' & ')}`))))))))),
    addToEval(l),
    lessonPictureList(l),
    lessonCopies(l));
}

/** The picture each time this lesson is on the schedule — with a warning for ones Google can't place. */
function lessonPictureList(l) {
  if (!wantsPicture(l)) return null;
  checkSharing(current('images'));
  const pictures = lessonPictures(store.state, l.id, isShared);
  const unshared = pictures.filter((p) => p.image && shareRefused(p.image));
  const missing = pictures.filter((p) => !p.image);
  return h('div', { class: 'usage-grade' },
    h('h4', { class: 'group-head' }, 'Pictures on the Lesson Schedule'),
    pictures.length ? null : h('p', { class: 'hint' }, 'Put this lesson on the Lesson Schedule and each week gets a picture from the Images tab.'),
    unshared.length ? h('p', { class: 'warn-box' }, `⚠ Google didn’t let the planner share ${unshared.length === 1 ? 'a picture this lesson uses' : `${unshared.length} pictures this lesson uses`} for a moment, so ${unshared.length === 1 ? 'it isn’t' : 'they aren’t'} in the lesson copies. Share ${unshared.length === 1 ? 'it' : 'them'} with “Anyone with the link” in Google Drive (see the Images tab).`) : null,
    missing.length ? h('p', { class: 'warn-box' }, `⚠ No picture fits ${missing.length === 1 ? 'one of its weeks' : `${missing.length} of its weeks`} — tick “OK any time” on a picture, or give one a time that fits.`) : null,
    h('ul', { class: 'usage-copies' }, pictures.map(({ entry, week, image }) => h('li', {},
      `${placeLabel(entry)} › Week ${week?.number ?? '?'}: `,
      image ? h('button', { class: 'link-btn', onclick: () => setUi({ tab: 'images', imageId: image.id, imageFolderId: image.folderId }) }, image.name) : h('em', {}, 'no picture fits'),
      image && shareRefused(image) ? h('span', { class: 'share-warn', 'data-tip': 'Not shared with “Anyone with the link”' }, ' ⚠') : null))));
}

function placeLabel(entry) {
  return [find(store.state, 'schools', entry.schoolId)?.name, find(store.state, 'grades', entry.gradeId)?.name].filter(Boolean).join(' › ');
}

/** Links to this lesson's copies on the Lesson Schedule (made by the export bridge). */
function lessonCopies(l) {
  const copies = copiesOfLesson(l.id);
  const state = copyStatus().state;
  let note = null;
  if (state === 'none') note = 'Choose a folder under Setup › School Year › Lesson copies, and every time this lesson is on the Lesson Schedule it gets its own filled-in copy.';
  else if (!copies.length) note = state === 'ready' ? 'No copies yet — put this lesson on the Lesson Schedule to make one.' : 'Copies show here when this computer can reach the lesson copies folder.';
  return h('div', { class: 'usage-grade' },
    h('h4', { class: 'group-head' }, 'Copies on the Lesson Schedule', copies.length ? h('span', { class: 'count-badge' }, copies.length) : null),
    note ? h('p', { class: 'hint' }, note) : null,
    copies.length ? h('ul', { class: 'usage-copies' }, copies.map((c) => h('li', {}, c.url
      ? h('a', { href: c.url, target: '_blank', rel: 'noopener', title: 'Opens this copy in a new tab' }, `${c.label} ↗`)
      : ['💻 ', h('code', {}, c.path)]))) : null);
}

/** Add this lesson to the end of an eval's lesson order, right here. */
function addToEval(l) {
  const outcomes = current('outcomes');
  const using = new Set(lessonEvals(store.state, l.id).map((e) => e.criterion?.id));
  const groups = outcomes
    .map((o) => ({ o, crits: criteriaFor(store.state, o.id).filter((c) => !using.has(c.id)) }))
    .filter((g) => g.crits.length);
  if (!groups.length) return null;
  return h('div', { class: 'add-to-eval' },
    h('span', {}, '+ Add to an eval:'),
    h('select', {
      class: 'inline-edit', 'aria-label': 'Add this lesson to an eval',
      onchange: (e) => {
        const crit = find(store.state, 'criteria', e.target.value);
        if (!crit) return;
        commit((s) => addStep(s, crit.id, l.id));
        toast(`Added “${l.name}” to “${crit.title}” (last in its lesson order).`, { label: 'Undo', run: undo });
      },
    },
    h('option', { value: '' }, 'Choose an eval…'),
    groups.map(({ o, crits }) => h('optgroup', { label: outcomeLabel(o) },
      crits.map((c) => h('option', { value: c.id }, c.title))))));
}

function duplicate(l) {
  const copy = commit((s) => duplicateLesson(s, l.id));
  setUi({ lessonId: copy.id, lessonSearch: '' });
}

function deleteLesson(l) {
  const evals = lessonEvals(store.state, l.id).length;
  commit((s) => remove(s, 'lessons', l.id));
  setUi({ lessonId: null });
  const done = l.locations.length ? `Removed “${l.name}” from the planner` : `Deleted “${l.name}”`;
  toast(evals ? `${done} and took it out of ${evals} eval${evals === 1 ? '' : 's'}.` : `${done}.`,
    { label: 'Undo', run: undo });
}

/** ↑ ↓ move through the lesson list. */
export function lessonKeys(e) {
  if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return false;
  const list = visibleDecks();
  const i = list.findIndex((l) => l.id === selectedLesson()?.id);
  const next = list[Math.max(0, Math.min(list.length - 1, i + (e.key === 'ArrowDown' ? 1 : -1)))];
  if (next) setUi({ lessonId: next.id, deckFolderId: next.folderId });
  return true;
}

