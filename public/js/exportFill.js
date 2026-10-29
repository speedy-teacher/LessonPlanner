// Updating a lesson copy's filled-in details in place (same file, same link, nothing in the trash).
//
// The template still has its placeholders ({{school}}…), and the planner knows what it typed into the
// copy last time. So for every bit of text in the template that has placeholders, the copy should
// read exactly that text with the old details in. If it does, the old details' exact positions are
// known and are swapped for the new ones; anything the teacher typed elsewhere is untouched. If any
// such text doesn't match (the teacher edited that spot, or the template changed), NotInPlace is
// thrown and the planner makes a fresh copy instead.
//
// Works on what Google's Slides / Docs / Sheets services say a file contains (plain JSON), so it can be
// tested without Google. Pictures (Slides only) go where the template has an IMAGE_ANCHOR shape.

export class NotInPlace extends Error {
  constructor(why) { super('not_in_place'); this.why = why; }
}

/** The text with each placeholder swapped for its value (`values` = { '{{school}}': 'School A', … }). */
export function fillText(text, values) {
  const keys = Object.keys(values);
  if (!keys.length) return text;
  const pattern = new RegExp(keys.map((k) => k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'), 'g');
  return text.replace(pattern, (m) => values[m]);
}

const hasPlaceholder = (text, values) => Object.keys(values).some((k) => text.includes(k));

/**
 * Where to swap old details for new ones in a copy whose text is `templateText` filled with `oldValues`:
 * [{ start, end, text }] in copy positions, last first (so earlier positions stay right while editing).
 */
export function swaps(templateText, oldValues, newValues) {
  const keys = Object.keys(oldValues);
  if (!keys.length) return [];
  const pattern = new RegExp(keys.map((k) => k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'), 'g');
  const out = [];
  let shift = 0;
  for (const match of templateText.matchAll(pattern)) {
    const before = oldValues[match[0]] ?? '';
    const after = newValues[match[0]] ?? '';
    const start = match.index + shift;
    if (before !== after) out.push({ start, end: start + before.length, text: after });
    shift += before.length - match[0].length;
  }
  return out.reverse();
}

/** Check one bit of text and work out its swaps; throws NotInPlace when the copy doesn't read as expected. */
function swapsFor(templateText, copyText, oldValues, newValues, where) {
  if (copyText !== fillText(templateText, oldValues)) throw new NotInPlace(`changed: ${where}`);
  return swaps(templateText, oldValues, newValues);
}

// ---------- Google Slides ----------

const runText = (elements = []) => elements.map((e) => e.textRun?.content ?? e.autoText?.content ?? '').join('');

/** Every bit of text in a presentation: Map "objectId" or "objectId:row:col" → { objectId, cellLocation?, text }. */
export function slidesTexts(presentation) {
  const texts = new Map();
  const walk = (el) => {
    if (el.shape?.text) texts.set(el.objectId, { objectId: el.objectId, text: runText(el.shape.text.textElements) });
    tableTexts(el, texts);
    (el.elementGroup?.children ?? []).forEach(walk);
  };
  for (const slide of presentation.slides ?? []) (slide.pageElements ?? []).forEach(walk);
  return texts;
}

function tableTexts(el, texts) {
  (el.table?.tableRows ?? []).forEach((row, r) => (row.tableCells ?? []).forEach((cell, c) => {
    if (!cell.text) return;
    texts.set(`${el.objectId}:${r}:${c}`, { objectId: el.objectId, cellLocation: { rowIndex: r, columnIndex: c }, text: runText(cell.text.textElements) });
  }));
}

/** Slides requests that swap old details for new ones in the copy. */
export function slidesUpdates(template, copy, oldValues, newValues) {
  const copyTexts = slidesTexts(copy);
  const requests = [];
  for (const [key, t] of slidesTexts(template)) {
    if (!hasPlaceholder(t.text, oldValues)) continue;
    const found = copyTexts.get(key);
    if (!found) throw new NotInPlace(`missing: ${key}`);
    requests.push(...swapsFor(t.text, found.text, oldValues, newValues, key).flatMap((s) => slidesSwap(t, s)));
  }
  return requests;
}

/** Delete the old detail and type the new one, at the same spot. */
function slidesSwap(t, s) {
  const target = { objectId: t.objectId, ...(t.cellLocation ? { cellLocation: t.cellLocation } : {}) };
  return [
    ...(s.end > s.start ? [{ deleteText: { ...target, textRange: { type: 'FIXED_RANGE', startIndex: s.start, endIndex: s.end } } }] : []),
    ...(s.text ? [{ insertText: { ...target, insertionIndex: s.start, text: s.text } }] : []),
  ];
}

// ---------- pictures (Google Slides) ----------

export const PICTURE_ID = 'lpPicture';

/** A shape marking where the picture goes: alt text title/name IMAGE_ANCHOR, or the description says so. */
function isAnchor(el) {
  const description = el.description ?? '';
  return el.title === 'IMAGE_ANCHOR' || description.includes('IMAGE_ANCHOR') || /"anchor"\s*:\s*"bitmoji"/.test(description);
}

/** Picture spots in a presentation: [{ objectId, pageObjectId, size, transform }]. */
export function pictureAnchors(presentation) {
  return (presentation.slides ?? []).flatMap((slide) => (slide.pageElements ?? []).filter(isAnchor)
    .map((el) => ({ objectId: el.objectId, pageObjectId: slide.objectId, size: el.size, transform: el.transform })));
}

/** Pictures the planner placed (found by their ids). */
export function placedPictures(presentation) {
  return (presentation.slides ?? []).flatMap((slide) => (slide.pageElements ?? []).filter((el) => el.objectId?.startsWith(PICTURE_ID)).map((el) => el.objectId));
}

/** Put a picture (by its address) on every spot, removing the see-through spot shapes. */
export function placePictureRequests(anchors, url) {
  return anchors.flatMap((a, i) => [
    { createImage: { objectId: `${PICTURE_ID}${i}_${a.objectId}`.slice(0, 50), url, elementProperties: { pageObjectId: a.pageObjectId, size: a.size, transform: a.transform } } },
    { deleteObject: { objectId: a.objectId } },
  ]);
}

/** Swap the pictures the planner placed for another one, keeping their place and size. */
export function swapPictureRequests(pictureIds, url) {
  return pictureIds.map((imageObjectId) => ({ replaceImage: { imageObjectId, url, imageReplaceMethod: 'CENTER_INSIDE' } }));
}

// ---------- Google Docs ----------

/** A document's text pieces in order: [{ index (document position), text }] — body only. */
function docRuns(content = []) {
  const runs = [];
  const walk = (elements) => elements.forEach((el) => {
    (el.paragraph?.elements ?? []).forEach((p) => { if (p.textRun) runs.push({ index: p.startIndex, text: p.textRun.content }); });
    (el.table?.tableRows ?? []).forEach((row) => row.tableCells.forEach((cell) => walk(cell.content ?? [])));
    if (el.tableOfContents) walk(el.tableOfContents.content ?? []);
  });
  walk(content);
  return runs;
}

/** Placeholders in a header, footer or footnote can't be followed (only the main text is). */
function hasOtherPlaceholders(doc, values) {
  const others = JSON.stringify([doc.headers ?? {}, doc.footers ?? {}, doc.footnotes ?? {}]);
  return hasPlaceholder(others, values);
}

/** Docs requests that swap old details for new ones in the copy. */
export function docsUpdates(template, copy, oldValues, newValues) {
  if (hasOtherPlaceholders(template, oldValues)) throw new NotInPlace('header or footer');
  const tRuns = docRuns(template.body?.content);
  const cRuns = docRuns(copy.body?.content);
  const templateText = tRuns.map((r) => r.text).join('');
  const copyText = cRuns.map((r) => r.text).join('');
  const toIndex = positionMap(cRuns);
  return swapsFor(templateText, copyText, oldValues, newValues, 'document').flatMap((s) => [
    ...(s.end > s.start ? [{ deleteContentRange: { range: { startIndex: toIndex(s.start), endIndex: toIndex(s.end - 1) + 1 } } }] : []),
    ...(s.text ? [{ insertText: { location: { index: toIndex(s.start) }, text: s.text } }] : []),
  ]);
}

/** Text position → document position (text pieces sit at their own document positions). */
function positionMap(runs) {
  const starts = [];
  let at = 0;
  for (const r of runs) { starts.push(at); at += r.text.length; }
  return (pos) => {
    let i = runs.length - 1;
    while (i > 0 && starts[i] > pos) i -= 1;
    return runs[i].index + (pos - starts[i]);
  };
}

// ---------- Google Sheets ----------

function cellText(value) {
  const v = value?.userEnteredValue;
  if (!v) return '';
  return v.stringValue ?? v.formulaValue ?? (v.numberValue !== undefined ? String(v.numberValue) : v.boolValue !== undefined ? String(v.boolValue).toUpperCase() : '');
}

/** Every filled cell: Map "sheetId:row:col" → { sheetId, row, col, text, formula }. */
export function sheetCells(spreadsheet) {
  const cells = new Map();
  for (const sheet of spreadsheet.sheets ?? []) {
    const sheetId = sheet.properties?.sheetId ?? 0;
    for (const grid of sheet.data ?? []) {
      (grid.rowData ?? []).forEach((row, r) => (row.values ?? []).forEach((value, c) => {
        const at = { sheetId, row: (grid.startRow ?? 0) + r, col: (grid.startColumn ?? 0) + c };
        cells.set(`${at.sheetId}:${at.row}:${at.col}`, { ...at, text: cellText(value), formula: value?.userEnteredValue?.formulaValue !== undefined });
      }));
    }
  }
  return cells;
}

/** Sheets requests that rewrite each cell that holds details, keeping its formatting. */
export function sheetsUpdates(template, copy, oldValues, newValues) {
  const copyCells = sheetCells(copy);
  const requests = [];
  for (const [key, t] of sheetCells(template)) {
    if (!hasPlaceholder(t.text, oldValues)) continue;
    const found = copyCells.get(key)?.text ?? '';
    if (found !== fillText(t.text, oldValues)) throw new NotInPlace(`changed: ${key}`);
    const text = fillText(t.text, newValues);
    if (text === found) continue;
    requests.push({
      updateCells: {
        range: { sheetId: t.sheetId, startRowIndex: t.row, endRowIndex: t.row + 1, startColumnIndex: t.col, endColumnIndex: t.col + 1 },
        rows: [{ values: [{ userEnteredValue: t.formula ? { formulaValue: text } : { stringValue: text } }] }],
        fields: 'userEnteredValue',
      },
    });
  }
  return requests;
}
