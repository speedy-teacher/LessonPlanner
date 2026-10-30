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
