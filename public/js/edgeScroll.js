// While dragging, holding the mouse near the top or bottom of the page scrolls it (pure, tested).
// The closer to the edge (or past it, e.g. over the tabs), the faster.

export const EDGE_PX = 80; // how close to the top/bottom edge before auto-scrolling
export const MIN_STEP = 6; // pixels per drag event just inside the zone
export const MAX_STEP = 40; // pixels per drag event at (or past) the edge

/** How far to scroll for a pointer at `y` in a view from `top` to `bottom`: negative = up, 0 = stay. */
export function edgeStep(y, top, bottom) {
  const zone = Math.min(EDGE_PX, (bottom - top) / 3);
  const depth = Math.max(top + zone - y, y - (bottom - zone));
  if (depth <= 0) return 0;
  const step = Math.round(MIN_STEP + (MAX_STEP - MIN_STEP) * Math.min(1, depth / zone));
  return y < (top + bottom) / 2 ? -step : step;
}
