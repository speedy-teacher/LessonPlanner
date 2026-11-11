// One picked file: its template name, the lesson/week numbers found (ticked = becomes a placeholder) and
// the first-page pictures (ticked = in Slides it becomes a picture spot; saved to the pictures folder if there
// is one). Once made: a picture of the template, "Open it", and "Add this one" (unticked = thrown away).

import { h } from '../dom.js';
import { KINDS } from '../templateMaker/fileKinds.js';
import { preview } from '../templateMaker/numberMatch.js';
import { AUTO_FIELD_PLACEHOLDERS } from '../model.js';

const LESSON_FIELDS = [['lessonNumber', 'lesson in the week'], ['lessonNumberAbs', 'lesson in the year']];

export function fileCard(file, session, { editable, savingPictures }) {
  const kind = file.prepared?.kind;
  return h('article', { class: `tm-file ${file.status}`, 'data-tour': 'tm-file' },
    h('div', { class: 'tm-file-head' },
      h('span', { class: 'tm-file-icon' }, kind ? KINDS[kind].icon : '📄'),
      h('div', { class: 'tm-file-title' },
        file.prepared ? nameInput(file, session, editable) : h('div', { class: 'tm-name-input' }, file.source.name),
        h('div', { class: 'tm-from' }, `from “${file.source.name}”${file.prepared?.draft ? ' · turned into Google’s kind of file' : ''}`)),
      editable ? h('button', { class: 'tm-remove', title: 'Take this file out', 'aria-label': 'Take this file out', onclick: () => session.removeFile(file.uid) }, '×') : null),
    statusLine(file, session),
    file.prepared && file.status !== 'made' ? choicesOf(file, session, { editable, savingPictures }) : null,
  );
}

function nameInput(file, session, editable) {
  return h('input', {
    class: 'tm-name-input', value: file.prepared.name, disabled: !editable, 'aria-label': 'Template name', dataset: { focus: `name-${file.uid}` },
    oninput: (e) => session.rename(file.uid, e.target.value),
  });
}

function statusLine(file, session) {
  if (file.status === 'reading' || file.status === 'making') return h('div', { class: 'tm-status' }, h('span', { class: 'tm-spinner' }), file.step || 'Working…');
  if (file.status === 'problem' || file.status === 'failed') return h('div', { class: 'tm-status bad' }, `⚠ ${file.error}`);
  if (file.status === 'made') return madeLine(file, session);
  return null;
}

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

function madeLine(file, session) {
  const { made } = file;
  const missed = made.failedPictures.length;
  const spots = made.pictures ? ` · ${plural(made.pictures, 'picture spot')}` : '';
  const reviewing = session.state.phase === 'review';
  return h('div', {},
    h('div', { class: 'tm-made' },
      h('a', { class: 'tm-look', href: made.link, target: '_blank', rel: 'noopener', title: 'Open it in Google' },
        file.picture ? h('img', { src: file.picture, alt: `The first slide of ${made.lesson.name}`, referrerpolicy: 'no-referrer' }) : h('span', {}, made.preview ? '…' : '📄')),
      h('div', {},
        h('div', { class: 'tm-status good' }, `✓ Template made · ${plural(made.changes, 'placeholder')}${spots}`),
        h('a', { href: made.link, target: '_blank', rel: 'noopener' }, '👀 Open it to check'),
        reviewing ? h('label', { class: 'tm-keep', 'data-tour': 'tm-keep' },
          h('input', { type: 'checkbox', checked: Boolean(file.keep), onchange: (e) => session.setKeep(file.uid, e.target.checked) }),
          'Add this one to my templates') : null)),
    missed ? h('div', { class: 'tm-notice gold small' }, `${missed} picture${missed === 1 ? '' : 's'} couldn’t be saved (that kind of picture can’t be copied), so ${missed === 1 ? 'it stays' : 'they stay'} in the template as ${missed === 1 ? 'it is' : 'they are'}.`) : null);
}

function choicesOf(file, session, { editable, savingPictures }) {
  const { scan, choices, kind } = file.prepared;
  return h('div', {},
    h('div', { class: 'tm-section-title' }, 'Lesson and week numbers'),
    scan.matches.length
      ? h('div', { class: 'tm-matches' }, scan.matches.map((m) => matchRow(file, m, choices, { session, editable })))
      : h('p', { class: 'tm-hint small' }, 'No lesson or week numbers found — the template will be a plain copy.'),
    scan.pictures.length ? picturesOf(file, session, { kind, editable, savingPictures }) : null,
  );
}

function matchRow(file, m, choices, { session, editable }) {
  const field = choices.matches[m.key];
  const on = Boolean(field);
  const { before, after } = preview(m, field || m.field);
  return h('label', { class: `tm-match${on ? '' : ' off'}` },
    h('input', { type: 'checkbox', checked: on, disabled: !editable, onchange: (e) => session.tickMatch(file.uid, m.key, e.target.checked ? m.field : false) }),
    h('span', { class: 'tm-where' }, m.where),
    h('span', { class: 'tm-change' },
      h('span', { class: 'tm-before' }, `“${before}”`), h('span', { class: 'tm-arrow' }, '→'), highlighted(after),
      m.kind === 'lesson' && on ? fieldPick(file, m, field, { session, editable }) : null),
  );
}

/** The line afterwards, with the placeholder standing out. */
function highlighted(text) {
  const parts = text.split(/(\{\{[a-z_]+\}\})/);
  return h('span', {}, '“', parts.map((p) => (Object.values(AUTO_FIELD_PLACEHOLDERS).includes(p) ? h('span', { class: 'tm-placeholder' }, p) : p)), '”');
}

function fieldPick(file, m, field, { session, editable }) {
  return h('select', {
    class: 'tm-field-pick', disabled: !editable, 'aria-label': 'Which lesson number',
    onchange: (e) => session.tickMatch(file.uid, m.key, e.target.value),
  }, LESSON_FIELDS.map(([value, label]) => h('option', { value, selected: value === field }, label)));
}

function picturesOf(file, session, { kind, editable, savingPictures }) {
  const { scan, choices } = file.prepared;
  let what = 'Ticked pictures are saved to your pictures folder. In a document the picture stays where it is (the planner can only swap pictures in Slides for now).';
  if (kind === 'slides') {
    what = `Ticked pictures (like a bitmoji) are taken out of the template and become a picture spot — the planner puts the week’s picture there.${savingPictures ? ' They are also saved to your pictures folder.' : ''}`;
  }
  return h('div', {},
    h('div', { class: 'tm-section-title' }, 'Pictures on the first page'),
    h('p', { class: 'tm-hint small' }, what),
    h('div', { class: 'tm-pictures' }, scan.pictures.map((p, i) => {
      const on = Boolean(choices.pictures[p.key]);
      return h('label', { class: `tm-picture${on ? ' on' : ''}` },
        h('input', { type: 'checkbox', checked: on, disabled: !editable, onchange: (e) => session.tickPicture(file.uid, p.key, e.target.checked) }),
        p.url ? h('img', { src: p.url, alt: p.title || `Picture ${i + 1}`, referrerpolicy: 'no-referrer', loading: 'lazy' }) : h('div', { class: 'tm-hint' }, '🖼️'),
        h('div', { class: 'tm-caption' }, p.title || `Picture ${i + 1}`));
    })),
  );
}
