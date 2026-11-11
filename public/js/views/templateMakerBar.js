// The bar at the bottom of the Template Maker window: what will happen ("3 templates · 7 placeholders ·
// 2 pictures") and the Make button; while making, how far along it is; afterwards, what was added.

import { h } from '../dom.js';

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** How far along making is: { done, total, percent } (adding them to the plan counts as the last step). */
export function progressOf(state) {
  const making = state.files.filter((f) => ['making', 'made', 'failed'].includes(f.status));
  const finished = making.filter((f) => f.status !== 'making').length;
  const total = making.length + 1;
  return { done: finished, total: making.length, percent: Math.round((finished / total) * 100) };
}

/** What making would do now: { templates, placeholders, pictures }. */
export function summaryOf(state) {
  const ready = state.files.filter((f) => f.status === 'ready');
  const count = (f, part) => Object.values(f.prepared.choices[part]).filter(Boolean).length;
  return {
    templates: ready.length,
    placeholders: ready.reduce((s, f) => s + count(f, 'matches'), 0),
    pictures: ready.reduce((s, f) => s + count(f, 'pictures'), 0),
  };
}

/** `onShow()` closes the window and shows the new templates. */
export function makeBar(session, { onShow }) {
  const { state } = session;
  if (!state.files.length) return null;
  return h('div', { class: 'tm-bar' }, ...barContent(session, state, onShow));
}

function barContent(session, state, onShow) {
  if (state.phase === 'choose') {
    const s = summaryOf(state);
    const reading = state.files.some((f) => f.status === 'reading');
    return [
      h('div', {}, h('strong', {}, plural(s.templates, 'template')), ` · ${plural(s.placeholders, 'placeholder')}${s.pictures ? ` · ${plural(s.pictures, 'picture')}` : ''}`,
        reading ? h('div', { class: 'tm-hint small' }, 'Still reading some files…') : null),
      h('button', { class: 'btn tm-make', disabled: !s.templates, onclick: () => session.makeAll(), 'data-tour': 'tm-make' }, `✨ Make ${plural(s.templates, 'template')}`),
    ];
  }
  if (state.phase === 'making') {
    const p = progressOf(state);
    return [h('div', { class: 'tm-progress' }, h('div', { class: 'small' }, `Making templates… ${p.done} of ${p.total}`),
      h('div', { class: 'tm-track' }, h('div', { class: 'tm-fill', style: { width: `${p.percent}%` } })))];
  }
  return doneContent(session, state, onShow);
}

function doneContent(session, state, onShow) {
  const failed = state.files.filter((f) => f.status === 'failed').length;
  let words = `🎉 ${plural(state.save.count ?? 0, 'template')} added to your Lesson Templates (marked ❗ new).`;
  if (state.save.status === 'failed') words = `⚠ ${state.save.message}`;
  if (state.save.status === 'idle') words = '⚠ No templates could be made.';
  return [
    h('div', {}, h('strong', {}, words), failed ? h('div', { class: 'small' }, `${plural(failed, 'file')} couldn’t be made — see the note on ${failed === 1 ? 'it' : 'each'}.`) : null),
    h('div', { class: 'tm-row' },
      state.save.status === 'saved' ? h('button', { class: 'btn', onclick: onShow, 'data-tour': 'tm-show' }, 'Show me') : null,
      h('button', { class: 'btn light', onclick: () => session.startOver() }, 'Make more')),
  ];
}
