// "+ Add" → "Files or folders…" on Lesson Templates: the look-before-adding window. Every copy made in the
// templates folder — also each lesson inside a picked folder — is shown with a picture, a link to open and change
// it in Google, its name (can be changed) and "Add this one". Only the ones kept are added; the rest go to the
// trash. What's going on lives in copyReview.js (no DOM); this file only draws it.
// The cards use the Template Maker's look (css/templateMaker.css).

import { h } from '../dom.js';
import { showNotice } from '../notices.js';
import { createCopyReview, openLink } from '../copyReview.js';

let open = null; // { review, body, home, onDone } while a look is going on (one at a time)

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** Open the window for copies just made. `add(nodes)` brings the kept ones in; `onDone(result)` once decided. */
export function openCopyReview({ calls, nodes, add, home, onDone }) {
  const review = createCopyReview({ calls, nodes, add });
  open = { review, body: null, home, onDone };
  review.onChange(redraw);
  show();
  review.loadPictures();
}

// Coming back from changing a copy in Google (another tab): its picture is drawn again.
window.addEventListener('focus', () => { if (open?.body?.isConnected) open.review.refreshPictures(); });

function show() {
  const layer = document.getElementById('modal');
  open.body = h('div', { class: 'tm', 'data-tour': 'copy-review' });
  const card = h('div', { class: 'modal-card tm-card', role: 'dialog', 'aria-label': 'Look before adding' },
    h('div', { class: 'tm-title' }, h('h2', {}, '👀 Look before adding'),
      h('button', { class: 'tm-close', title: 'Close', 'aria-label': 'Close', onclick: closeUndecided }, '×')),
    open.body);
  layer.replaceChildren(card);
  layer.classList.add('show');
  layer.onclick = (e) => { if (e.target === layer) closeUndecided(); };
  draw();
}

function hide() {
  const layer = document.getElementById('modal');
  layer.classList.remove('show');
  layer.replaceChildren();
  if (open) open.body = null;
}

/** Closed without deciding: nothing is added; the copies wait (a day) in case she wants to look again. */
function closeUndecided() {
  const now = open;
  hide();
  if (now?.review.state.phase !== 'review') return;
  showNotice({
    id: 'copy-review', tone: 'info', title: 'Nothing added yet',
    message: `${plural(now.review.state.files.length, 'copy')} ${now.review.state.files.length === 1 ? 'is' : 'are'} waiting for you to look at. Copies you don’t add are thrown away tomorrow.`,
    actions: [{ label: 'Look at them', run: () => { if (open === now) show(); } }],
    seconds: null,
  });
}

let drawing = false;
function redraw() {
  if (drawing) return;
  drawing = true;
  setTimeout(() => { drawing = false; draw(); }, 30);
}

function draw() {
  const body = open?.body;
  if (!body?.isConnected) return;
  const active = document.activeElement?.dataset?.focus;
  const [start, end] = [document.activeElement?.selectionStart, document.activeElement?.selectionEnd];
  body.replaceChildren(...page(open.review, open.home));
  const again = active && body.querySelector(`[data-focus="${active}"]`);
  if (again) { again.focus(); again.setSelectionRange?.(start, end); }
}

function page(review, home) {
  const { files } = review.state;
  return [
    h('p', { class: 'tm-hint' }, `Copies of what you picked are in 📁 ${home}. Your original files are never changed. Open any copy to check it or change it in Google, rename it here, and untick the ones you don’t want — only the ticked ones are added to your templates.`),
    files.length > 1 ? h('div', { class: 'tm-row' },
      h('button', { class: 'btn small light', onclick: () => review.setAll(true) }, 'Tick all'),
      h('button', { class: 'btn small light', onclick: () => review.setAll(false) }, 'Untick all')) : null,
    h('div', { class: 'tm-files' }, files.map((f) => card(review, f))),
    bar(review),
  ].filter(Boolean);
}

function card(review, file) {
  const editable = review.state.phase === 'review';
  return h('article', { class: `tm-file${file.keep ? ' made' : ''}`, 'data-tour': 'cr-file' },
    h('div', { class: 'tm-made' },
      h('div', { class: 'tm-look-wrap' },
        h('a', { class: 'tm-look', href: openLink(file.id), target: '_blank', rel: 'noopener', title: 'Open it in Google' }, picture(file)),
        h('button', {
          class: 'tm-repicture', title: 'Draw the picture again', 'aria-label': `Draw the picture of ${file.title} again`,
          disabled: file.pictureState === 'loading' || !editable, onclick: () => review.reloadPicture(file.id),
        }, '🔄')),
      h('div', { class: 'tm-file-title' },
        h('input', {
          class: 'tm-name-input', value: file.title, disabled: !editable, 'aria-label': 'Template name', dataset: { focus: `cr-${file.id}` },
          oninput: (e) => review.rename(file.id, e.target.value),
        }),
        file.path ? h('div', { class: 'tm-from' }, `in 📁 ${file.path}`) : null,
        h('a', { href: openLink(file.id), target: '_blank', rel: 'noopener', 'data-tour': 'cr-open', 'data-tip': 'Opens in a new tab. Change anything you like there; when you come back, the picture here shows your changes.' }, '👀 Open it to check or change it'),
        h('label', { class: 'tm-keep', 'data-tour': 'cr-keep' },
          h('input', { type: 'checkbox', checked: file.keep, disabled: !editable, onchange: (e) => review.setKeep(file.id, e.target.checked) }),
          'Add this one to my templates'))));
}

function picture(file) {
  if (file.picture) return h('img', { src: file.picture, alt: `The first page of ${file.title}`, referrerpolicy: 'no-referrer' });
  if (file.pictureState === 'none') return h('span', { class: 'tm-look-note' }, '📄 No picture from Google yet — click to open it');
  return h('span', { class: 'tm-look-note' }, h('span', { class: 'tm-spinner' }), 'Getting a picture…');
}

function bar(review) {
  const { phase, files } = review.state;
  if (phase !== 'review') return h('div', { class: 'tm-bar' }, h('div', { class: 'tm-status' }, h('span', { class: 'tm-spinner' }), 'Adding them to your Lesson Templates…'));
  const kept = files.filter((f) => f.keep).length;
  return h('div', { class: 'tm-bar' },
    h('div', {}, h('strong', {}, 'Have a look first.'), h('div', { class: 'small' }, `${kept} of ${files.length} ticked. Unticked copies are thrown away.`)),
    h('div', { class: 'tm-row' },
      h('button', { class: 'btn light', onclick: () => decide(review.throwAll) }, 'Throw them all away'),
      h('button', { class: 'btn tm-make', disabled: !kept, onclick: () => decide(review.addKept), 'data-tour': 'cr-add' },
        kept ? `✓ Add ${plural(kept, 'template')}` : 'Nothing ticked to add')));
}

async function decide(how) {
  const now = open;
  let result;
  try {
    result = await how();
  } catch {
    showNotice({ id: 'copy-review', tone: 'error', title: 'Lesson Templates', message: 'The copies are in your Drive folder, but couldn’t be added to this plan. They will show up by themselves when the planner next looks in that folder.' });
    result = { added: [], folders: [], skipped: [], failed: [] };
  }
  if (open !== now) return;
  hide();
  open = null;
  now.onDone(result);
}
