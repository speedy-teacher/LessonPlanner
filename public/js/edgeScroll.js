// While dragging, holding the mouse in the top or bottom quarter of the page scrolls it (pure, tested).
// Gentle just outside the middle half, speeding up toward the very edge (fastest past it, e.g. over
// the tabs). The middle half never scrolls, so there's a calm place to drop. Speeds are per second, so
// moving the mouse around doesn't make it faster.

export const ZONE_SHARE = 0.25; // top and bottom quarter of the view scroll
export const MIN_SPEED = 40; // pixels per second just outside the middle half
export const MAX_SPEED = 1200; // pixels per second at (or past) the very edge

/** Scroll speed (pixels per second) for a pointer at `y` in a view from `top` to `bottom`: negative = up, 0 = stay. */
export function edgeSpeed(y, top, bottom) {
  const zone = (bottom - top) * ZONE_SHARE;
  const depth = Math.max(top + zone - y, y - (bottom - zone));
  if (zone <= 0 || depth <= 0) return 0;
  const closeness = Math.min(1, depth / zone);
  const speed = MIN_SPEED + (MAX_SPEED - MIN_SPEED) * closeness ** 3;
  return y < (top + bottom) / 2 ? -speed : speed;
}

/** How far to scroll in `ms` milliseconds. */
export function edgeStep(y, top, bottom, ms) {
  return (edgeSpeed(y, top, bottom) * ms) / 1000;
}
