// Redraws for news from the background, at a quiet moment.
//
// Work running in the background (making lesson copies, checking pictures' sharing) has news to show,
// sometimes every second. Redrawing the whole page for each would swallow clicks — a button replaced
// between pressing and letting go never gets the click — so that news waits for a quiet moment:
// several updates make one redraw, and none happens while `isBusy()` (a mouse button held, a drag).

/** A function that asks for `redraw` once things are quiet: `delay` ms later, then whenever not busy. */
export function quietRedraw(redraw, { delay = 1500, retry = 250, isBusy = () => false } = {}) {
  let timer = null;
  const tick = () => {
    if (isBusy()) { timer = setTimeout(tick, retry); return; }
    timer = null;
    redraw();
  };
  return () => { if (!timer) timer = setTimeout(tick, delay); };
}

/** True while a mouse button is held down or something is being dragged on the page. */
export function watchHands(doc) {
  let busy = false;
  ['pointerdown', 'dragstart'].forEach((type) => doc.addEventListener(type, () => { busy = true; }, true));
  ['pointerup', 'pointercancel', 'dragend', 'drop'].forEach((type) => doc.addEventListener(type, () => { busy = false; }, true));
  return () => busy;
}

// A dropdown list (<select>) that is open closes as soon as the page is redrawn, because the redraw puts a
// new list in its place — so a teacher scrolling a long list (e.g. "Choose an eval…") lost it at random.
// The browser can't be asked whether a list is open, so it's worked out from what the hands do.

const OPEN_KEYS = new Set([' ', 'F4']);
const CLOSE_KEYS = new Set(['Escape', 'Enter', 'Tab']);
/** Longest a list counts as open with nothing happening (picking the option already chosen gives no news). */
export const MENU_HOLD_MS = 60000;

function isDropdown(el) {
  return el?.tagName === 'SELECT' && !el.multiple && !(el.size > 1);
}

function opensWith(e) {
  return OPEN_KEYS.has(e.key) || (e.altKey && e.key === 'ArrowDown');
}

/**
 * Follows whether a dropdown list on the page is open. `onClose()` runs each time one closes.
 * Returns `isOpen()`.
 */
export function watchMenus(doc, onClose = () => {}, { now = () => Date.now() } = {}) {
  let open = null;
  let since = 0;
  const close = () => { if (!open) return; open = null; onClose(); };
  const openOn = (el) => { open = el; since = now(); };
  doc.addEventListener('pointerdown', (e) => {
    if (open) { close(); return; } // a click on the page (or on the list itself) closes it
    if (isDropdown(e.target)) openOn(e.target);
  }, true);
  doc.addEventListener('keydown', (e) => {
    if (!isDropdown(e.target)) return;
    if (open && CLOSE_KEYS.has(e.key)) close();
    else if (!open && opensWith(e)) openOn(e.target);
  }, true);
  ['change', 'focusout'].forEach((type) => doc.addEventListener(type, (e) => { if (e.target === open) close(); }, true));
  return () => {
    if (open && now() - since > MENU_HOLD_MS) { open = null; }
    return Boolean(open);
  };
}
