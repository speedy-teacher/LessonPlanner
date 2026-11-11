// Google Docs: finding lesson/week numbers (the whole document, its headers and footers) and the pictures
// on the first page, in a document as the Docs API returns it, and the edits that type the placeholders in.
//
// Lesson Planner can only put the week's picture into Google Slides for now, so in a document a chosen
// picture stays where it is — it is still saved to the pictures folder and added to the teacher's pictures.
//
// Pure logic, shared by the browser and the Node tests.

import { toEmu } from './fileKinds.js';
import { findNumbers, placeholderFor } from './numberMatch.js';

/** Roughly how much text fits on a page (Google Docs has no pages in its data; a page break ends one sooner). */
export const FIRST_PAGE_CHARS = 2500;
const OBJECT = '￼'; // stands for a picture or other non-text part (it takes up one place in the document)

/** Every paragraph: [{ segmentId, where, start, text }] — `start` = the document position of its first character. */
export function docsParagraphs(doc) {
  const out = [];
  collect(doc.body?.content, { segmentId: null, where: 'Text' }, out);
  for (const [id, header] of Object.entries(doc.headers ?? {})) collect(header.content, { segmentId: id, where: 'Header' }, out);
  for (const [id, footer] of Object.entries(doc.footers ?? {})) collect(footer.content, { segmentId: id, where: 'Footer' }, out);
  return out;
}

function collect(content = [], at, out) {
  for (const item of content) {
    const start = item.startIndex ?? 0;
    if (item.paragraph) out.push({ ...at, start, text: paragraphText(item.paragraph, start), paragraph: item.paragraph });
    const cells = (item.table?.tableRows ?? []).flatMap((row) => row.tableCells ?? []);
    for (const cell of cells) collect(cell.content, at, out);
  }
}

function paragraphText(paragraph, start) {
  let text = '';
  for (const el of paragraph.elements ?? []) {
    const gap = (el.startIndex ?? start) - (start + text.length);
    if (gap > 0) text += OBJECT.repeat(gap);
    text += el.textRun?.content ?? OBJECT.repeat(Math.max(0, (el.endIndex ?? 0) - (el.startIndex ?? 0)));
  }
  return text;
}

/** The lesson/week numbers: [{ key, where, …match, target }] with document positions. */
export function docsMatches(doc) {
  const counts = new Map();
  return docsParagraphs(doc).flatMap((p) => {
    const n = (counts.get(p.segmentId) ?? 0) + 1;
    counts.set(p.segmentId, n);
    return findNumbers(p.text).map((m, i) => ({
      ...m, start: p.start + m.start, end: p.start + m.end, key: `${p.segmentId ?? 'body'}|${n}|${i}`, where: p.where,
      target: { segmentId: p.segmentId },
    }));
  });
}

/** The Docs edits that type the placeholders in for these matches (each may carry `chosenField`). */
export function docsTextRequests(matches) {
  return [...matches].sort((a, b) => b.start - a.start).flatMap((m) => {
    const segment = m.target.segmentId ? { segmentId: m.target.segmentId } : {};
    const requests = [];
    if (m.end > m.start) requests.push({ deleteContentRange: { range: { ...segment, startIndex: m.start, endIndex: m.end } } });
    requests.push({ insertText: { location: { ...segment, index: m.start }, text: placeholderFor(m, m.chosenField) } });
    return requests;
  });
}

/** Pictures on the first page (up to the first page break, or about a page of text): [{ key, objectId, url, title, box }]. */
export function docsPictures(doc) {
  const ids = [];
  let chars = 0;
  for (const p of docsParagraphs(doc).filter((x) => x.segmentId === null)) {
    for (const el of p.paragraph.elements ?? []) if (el.inlineObjectElement) ids.push(['inline', el.inlineObjectElement.inlineObjectId]);
    for (const id of p.paragraph.positionedObjectIds ?? []) ids.push(['positioned', id]);
    chars += p.text.length;
    if (chars > FIRST_PAGE_CHARS || (p.paragraph.elements ?? []).some((el) => el.pageBreak)) break;
  }
  return ids.map(([kind, id]) => pictureOf(doc, kind, id)).filter(Boolean);
}

function embeddedOf(doc, kind, id) {
  if (kind === 'inline') return doc.inlineObjects?.[id]?.inlineObjectProperties?.embeddedObject;
  return doc.positionedObjects?.[id]?.positionedObjectProperties?.embeddedObject;
}

function pictureOf(doc, kind, id) {
  const embedded = embeddedOf(doc, kind, id);
  if (!embedded?.imageProperties) return null;
  const { width, height } = embedded.size ?? {};
  return {
    key: id, objectId: id, url: embedded.imageProperties.contentUri ?? null, title: embedded.title || embedded.description || '',
    box: { x: null, y: null, width: toEmu(width), height: toEmu(height) },
  };
}
