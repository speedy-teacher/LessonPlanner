// Tiny helpers for building the page without a framework.

/**
 * h('button', { class: 'pill', onclick: fn, dataset: { id } }, 'Text', child)
 * Props starting with "on" become event listeners; `false`/`null` children are skipped.
 */
export function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(props || {})) setProp(el, key, value);
  appendAll(el, children);
  return el;
}

const SPECIAL_PROPS = {
  class: (el, v) => { el.className = v; },
  dataset: (el, v) => Object.assign(el.dataset, v),
  style: (el, v) => (typeof v === 'object' ? setStyles(el, v) : el.setAttribute('style', v)),
  value: (el, v) => { el.value = v; },
  checked: (el, v) => { el.checked = v; },
};

// setProperty is needed for CSS variables like '--chip'.
function setStyles(el, styles) {
  for (const [name, value] of Object.entries(styles)) {
    if (value !== null && value !== undefined) el.style.setProperty(name.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`), value);
  }
}

function setProp(el, key, value) {
  if (value === undefined || value === null || value === false) return;
  if (key.startsWith('on')) el.addEventListener(key.slice(2), value);
  else if (SPECIAL_PROPS[key]) SPECIAL_PROPS[key](el, value);
  else el.setAttribute(key, value === true ? '' : value);
}

function appendAll(el, children) {
  for (const child of children.flat(Infinity)) {
    if (child === null || child === undefined || child === false) continue;
    el.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
}

/** Name a part of the page for the tutorials (tutorials.js lights it up by this name). Returns `el`. */
export function tour(name, el) {
  el.dataset.tour = name;
  return el;
}

/** An input that saves when you press Enter or click away. */
export function editable(value, onSave, { allowEmpty = false, ...props } = {}) {
  const save = (e) => {
    const next = e.target.value.trim();
    if ((next || allowEmpty) && next !== value) onSave(next);
    else e.target.value = value;
  };
  return h('input', {
    class: 'inline-edit', value, ...props,
    onchange: save,
    onkeydown: (e) => {
      if (e.key === 'Enter') e.target.blur();
      if (e.key === 'Escape') { e.target.value = value; e.target.blur(); }
    },
  });
}

/** A text box + button that adds an item. Keeps focus so you can add many in a row. */
export function adder(placeholder, onAdd, key) {
  const input = h('input', { class: 'adder-input', placeholder, dataset: { key } });
  const submit = () => {
    const text = input.value.trim();
    if (!text) return;
    onAdd(text);
  };
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });
  return h('div', { class: 'adder' }, input, h('button', { class: 'btn small', onclick: submit, title: 'Add' }, '+ Add'));
}

export function iconButton(label, title, onclick, extraClass = '') {
  return h('button', { class: `icon-btn ${extraClass}`, title, 'aria-label': title, onclick }, label);
}

// ---------- toast ----------

let toastTimer = null;

/** Little message at the bottom of the screen, optionally with an Undo button. */
export function toast(message, action) {
  const box = document.getElementById('toast');
  box.replaceChildren(h('span', {}, message));
  if (action) {
    box.append(h('button', { class: 'btn small light', onclick: () => { action.run(); box.classList.remove('show'); } }, action.label));
  }
  box.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => box.classList.remove('show'), 5000);
}

// ---------- tooltip ----------

/** Show a friendly tooltip when hovering any element with data-tip. */
export function installTooltips() {
  const tip = document.getElementById('tooltip');
  document.addEventListener('mouseover', (e) => {
    const target = e.target.closest('[data-tip]');
    if (!target) { tip.classList.remove('show'); return; }
    // An empty title stops the browser also showing a parent's title tooltip on top of this one.
    if (!target.hasAttribute('title')) target.setAttribute('title', '');
    tip.textContent = target.dataset.tip;
    const rect = target.getBoundingClientRect();
    tip.classList.add('show');
    const left = Math.min(rect.left, window.innerWidth - tip.offsetWidth - 12);
    const below = rect.bottom + 8 + tip.offsetHeight < window.innerHeight;
    tip.style.left = `${Math.max(8, left)}px`;
    tip.style.top = `${below ? rect.bottom + 8 : rect.top - tip.offsetHeight - 8}px`;
  });
  document.addEventListener('dragstart', () => tip.classList.remove('show'));
}

// ---------- modal ----------

/** Open a simple dialog. `build(close)` returns the dialog's body. */
export function openModal(title, build) {
  const layer = document.getElementById('modal');
  const close = () => { layer.classList.remove('show'); layer.replaceChildren(); };
  const card = h('div', { class: 'modal-card', role: 'dialog', 'aria-label': title },
    h('h2', {}, title), build(close));
  layer.replaceChildren(card);
  layer.classList.add('show');
  layer.onclick = (e) => { if (e.target === layer) close(); };
  card.querySelector('input, select, button')?.focus();
  return close;
}
