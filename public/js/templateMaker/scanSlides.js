// Google Slides: finding lesson/week numbers (every slide) and pictures (first slide) in a presentation
// as the Slides API returns it, and the edits that turn the chosen ones into Lesson Planner placeholders.
//
// A picture becomes Lesson Planner's picture spot: a see-through rectangle in the same place and size,
// with alt text IMAGE_ANCHOR (exportFill.js in Lesson Planner puts the week's picture there).
//
// Pure logic, shared by the browser and the Node tests.

import { toEmu } from './fileKinds.js';
import { findNumbers, placeholderFor } from './numberMatch.js';

export const ANCHOR = 'IMAGE_ANCHOR';
const ANCHOR_PREFIX = 'lpAnchor_';

/** Every piece of text in the presentation: [{ slide, objectId, cell, text }] (cell = { rowIndex, columnIndex } in tables). */
export function slidesTexts(presentation) {
  const out = [];
  (presentation.slides ?? []).forEach((slide, i) => {
    for (const el of flatten(slide.pageElements)) textsOf(el, i + 1, out);
  });
  return out;
}

function flatten(elements = []) {
  return elements.flatMap((el) => (el.elementGroup ? [el, ...flatten(el.elementGroup.children)] : [el]));
}

function textsOf(el, slide, out) {
  if (el.shape?.text) out.push({ slide, objectId: el.objectId, cell: null, text: joined(el.shape.text) });
  (el.table?.tableRows ?? []).forEach((row, rowIndex) => {
    (row.tableCells ?? []).forEach((cell, columnIndex) => {
      if (cell.text) out.push({ slide, objectId: el.objectId, cell: { rowIndex, columnIndex }, text: joined(cell.text) });
    });
  });
}

const joined = (text) => (text.textElements ?? []).map((t) => t.textRun?.content ?? t.autoText?.content ?? '').join('');

/** The lesson/week numbers: [{ key, where, …match, target }] — `key` stays the same in a copy of the file. */
export function slidesMatches(presentation) {
  return slidesTexts(presentation).flatMap(({ slide, objectId, cell, text }) => findNumbers(text).map((m, i) => ({
    ...m, key: `${objectId}|${cell ? `${cell.rowIndex}:${cell.columnIndex}` : ''}|${i}`, where: `Slide ${slide}`,
    target: { objectId, cell },
  })));
}

/** Pictures on the first slide (not inside groups): [{ key, objectId, pageObjectId, size, transform, url, title, box }]. */
export function slidesPictures(presentation) {
  const first = presentation.slides?.[0];
  if (!first) return [];
  return (first.pageElements ?? []).filter((el) => el.image).map((el) => ({
    key: el.objectId, objectId: el.objectId, pageObjectId: first.objectId, size: el.size, transform: el.transform,
    url: el.image.contentUrl ?? null, title: el.title || el.description || '', box: boxOf(el),
  }));
}

/** Where a page element is, in EMU: { x, y, width, height }. */
export function boxOf(el) {
  const t = el.transform ?? {};
  const unit = t.unit === 'PT' ? 12700 : 1;
  return {
    x: (t.translateX ?? 0) * unit, y: (t.translateY ?? 0) * unit,
    width: toEmu(el.size?.width) * (t.scaleX ?? 1), height: toEmu(el.size?.height) * (t.scaleY ?? 1),
  };
}

/** The Slides edits that type the placeholders in for these matches (each may carry `chosenField`). */
export function slidesTextRequests(matches) {
  return [...matches].sort((a, b) => b.start - a.start).flatMap((m) => {
    const where = { objectId: m.target.objectId, ...(m.target.cell ? { cellLocation: m.target.cell } : {}) };
    const requests = [];
    if (m.end > m.start) requests.push({ deleteText: { ...where, textRange: { type: 'FIXED_RANGE', startIndex: m.start, endIndex: m.end } } });
    requests.push({ insertText: { ...where, insertionIndex: m.start, text: placeholderFor(m, m.chosenField) } });
    return requests;
  });
}

/** The Slides edits that swap these pictures for Lesson Planner's see-through picture spots. */
export function slidesAnchorRequests(pictures) {
  return pictures.flatMap((p) => {
    const objectId = `${ANCHOR_PREFIX}${p.objectId}`.slice(0, 50);
    return [
      { createShape: { objectId, shapeType: 'RECTANGLE', elementProperties: { pageObjectId: p.pageObjectId, size: p.size, transform: p.transform } } },
      {
        updateShapeProperties: {
          objectId, fields: 'shapeBackgroundFill.propertyState,outline.propertyState',
          shapeProperties: { shapeBackgroundFill: { propertyState: 'NOT_RENDERED' }, outline: { propertyState: 'NOT_RENDERED' } },
        },
      },
      { updatePageElementAltText: { objectId, title: ANCHOR, description: JSON.stringify({ anchor: 'bitmoji' }) } },
      { deleteObject: { objectId: p.objectId } },
    ];
  });
}
