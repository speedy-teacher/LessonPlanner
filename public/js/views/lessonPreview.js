// Preview of a lesson's slide deck: the first slide's picture for decks in
// Google Drive ("Preview not available" for others), then the details that
// are filled in automatically.

import { h } from '../dom.js';
import { find, lessonInstruments } from '../model.js';
import { store } from '../store.js';
import { formatDate } from '../dates.js';
import { deckThumbnail, thumbnailFailed } from '../thumbnails.js';

/**
 * fields: [{ key, label, value }] from autoFill(). Empty values show as
 * «Label» placeholders (e.g. in the lesson library, before a date is set).
 */
export function lessonPreview(lessonId, { number, fields = [], warn = false, small = false } = {}) {
  const lesson = find(store.state, 'lessons', lessonId);
  return h('figure', { class: `slide-preview ${warn ? 'has-warn' : ''} ${small ? 'small' : ''}` },
    slideCanvas(lesson),
    fields.length ? h('div', { class: 'slide-fields' }, fields.map((f) => h('div', { class: 'slide-field' },
      h('span', { class: 'field-label' }, f.label),
      h('span', { class: `field-value ${f.value ? '' : 'placeholder'}` }, showValue(f))))) : null,
    caption(lesson, number, warn),
  );
}

/** The first slide's picture, or the deck's name with a note when there's no picture. */
export function slideCanvas(lesson) {
  const thumb = lesson ? deckThumbnail(lesson) : { status: 'none', reason: 'This lesson deck was removed.' };
  if (thumb.status === 'ready') {
    return h('div', { class: 'slide-canvas has-picture' },
      h('img', { src: thumb.url, alt: `First slide of ${lesson.name}`, referrerpolicy: 'no-referrer', onerror: () => thumbnailFailed(lesson) }));
  }
  const loading = thumb.status === 'loading';
  return h('div', { class: 'slide-canvas' },
    h('div', { class: 'slide-template' }, lesson ? lesson.name : 'Missing lesson'),
    h('div', { class: `slide-status ${loading ? 'loading' : ''}`, 'data-tip': loading ? null : thumb.reason },
      loading ? 'Loading preview…' : 'Preview not available'));
}

function caption(lesson, number, warn) {
  return h('figcaption', {},
    number ? h('span', { class: 'slide-num' }, number) : null,
    h('span', { class: 'slide-title' }, lesson?.name),
    instrumentTags(lesson),
    warn ? h('span', { class: 'warn', title: 'An instrument isn’t at the school that day' }, '⚠') : null);
}

/** Little colored tags for the instruments a lesson uses. */
export function instrumentTags(lesson) {
  return lessonInstruments(store.state, lesson)
    .map((i) => h('span', { class: 'ins-tag', style: { '--ins': i.color } }, i.name));
}

function showValue(field) {
  if (!field.value) return `«${field.label}»`;
  if (field.key !== 'date') return field.value;
  return field.value.split('/').map(formatDate).join(' – ');
}
