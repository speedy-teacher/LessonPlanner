// Blank slide preview. Real slide artwork isn't connected yet, so this
// shows the template name and the fields that would be filled in.

import { h } from '../dom.js';
import { find } from '../model.js';
import { store } from '../store.js';
import { formatDate } from '../dates.js';

/**
 * fields: [{ key, label, value }] from autoFill(). Empty values show as
 * «Label» placeholders (e.g. in the lesson library, before a date is set).
 */
export function slidePreview(slide, { number, fields = [], warn = false, small = false } = {}) {
  const template = find(store.state, 'templates', slide.templateId);
  const instrument = find(store.state, 'instruments', slide.instrumentId);
  return h('figure', { class: `slide-preview ${warn ? 'warn' : ''} ${small ? 'small' : ''}` },
    h('div', { class: 'slide-canvas' },
      h('div', { class: 'slide-template' }, template ? template.name : 'No template'),
      h('div', { class: 'slide-fields' }, fields.map((f) => h('div', { class: 'slide-field' },
        h('span', { class: 'field-label' }, f.label),
        h('span', { class: `field-value ${f.value ? '' : 'placeholder'}` }, showValue(f)))))),
    caption(slide, instrument, number, warn),
  );
}

function caption(slide, instrument, number, warn) {
  return h('figcaption', {},
    number ? h('span', { class: 'slide-num' }, number) : null,
    h('span', { class: 'slide-title' }, slide.title),
    instrument ? h('span', { class: 'ins-tag', style: { '--ins': instrument.color } }, instrument.name) : null,
    warn ? h('span', { class: 'warn', title: 'This instrument isn’t at the school that day' }, '⚠') : null);
}

function showValue(field) {
  if (!field.value) return `«${field.label}»`;
  return field.key === 'date' ? formatDate(field.value) : field.value;
}
