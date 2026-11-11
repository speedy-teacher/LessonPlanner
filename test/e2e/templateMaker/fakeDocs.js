// A pretend Google Doc for the fake Google Drive. Kept simply: each part (the body, each header/footer) is a
// list of paragraphs, each a list of text pieces and pictures ({ picture: id }). Reading renders the Docs
// API's JSON (positions counted the way Google does: the body starts at 1, headers at 0, a picture takes one
// place); edits change the parts by those positions.

/** fakeDoc({ body: [['Lesson 2\n'], ['Hi ', { picture: 'p1' }, '\n']], headers: { h1: [['Week 3\n']] }, pictures: { p1: {…} } }) */
export function fakeDoc({ body = [], headers = {}, footers = {}, pictures = {}, positioned = {} }) {
  return { body, headers, footers, pictures, positioned };
}

const START = { body: 1, segment: 0 };

function renderPart(paragraphs, start) {
  let at = start;
  return paragraphs.map((pieces) => {
    const first = at;
    const elements = [];
    const positionedObjectIds = [];
    for (const piece of pieces) {
      if (typeof piece === 'string') {
        elements.push({ startIndex: at, endIndex: at + piece.length, textRun: { content: piece } });
        at += piece.length;
      } else if (piece.picture) {
        elements.push({ startIndex: at, endIndex: at + 1, inlineObjectElement: { inlineObjectId: piece.picture } });
        at += 1;
      } else if (piece.positioned) {
        positionedObjectIds.push(piece.positioned);
      } else if (piece.pageBreak) {
        elements.push({ startIndex: at, endIndex: at + 1, pageBreak: {} });
        at += 1;
      }
    }
    return { startIndex: first, endIndex: at, paragraph: { elements, ...(positionedObjectIds.length ? { positionedObjectIds } : {}) } };
  });
}

const embedded = (p) => ({ embeddedObject: { title: p.title ?? '', size: p.size, imageProperties: { contentUri: p.url ?? 'https://example.test/picture' } } });

export function renderDoc(doc) {
  const segments = (parts) => Object.fromEntries(Object.entries(parts).map(([id, paragraphs]) => [id, { content: renderPart(paragraphs, START.segment) }]));
  return {
    body: { content: renderPart(doc.body, START.body) },
    headers: segments(doc.headers),
    footers: segments(doc.footers),
    inlineObjects: Object.fromEntries(Object.entries(doc.pictures).map(([id, p]) => [id, { inlineObjectProperties: embedded(p) }])),
    positionedObjects: Object.fromEntries(Object.entries(doc.positioned).map(([id, p]) => [id, { positionedObjectProperties: embedded(p) }])),
  };
}

/** The part as a flat list (one entry per position) and back. */
function flat(paragraphs) {
  return paragraphs.flatMap((pieces) => pieces.flatMap((p) => (typeof p === 'string' ? [...p] : [p])));
}

function unflat(items) {
  const paragraphs = [];
  let current = [];
  for (const item of items) {
    if (typeof item === 'string' && typeof current.at(-1) === 'string') current[current.length - 1] += item;
    else current.push(item);
    if (item === '\n' || (typeof item === 'string' && item.endsWith('\n'))) { paragraphs.push(current); current = []; }
  }
  if (current.length) paragraphs.push(current);
  return paragraphs;
}

function partOf(doc, segmentId) {
  if (!segmentId) return { get: () => doc.body, set: (p) => { doc.body = p; }, start: START.body };
  const holder = doc.headers[segmentId] ? doc.headers : doc.footers;
  return { get: () => holder[segmentId], set: (p) => { holder[segmentId] = p; }, start: START.segment };
}

/** Positioned pictures take no place, so they are set aside while editing and put back on their paragraph. */
function edit(part, change) {
  const items = flat(part.get());
  const moved = items.filter((x) => x?.positioned);
  const rest = items.filter((x) => !x?.positioned);
  change(rest);
  const paragraphs = unflat(rest);
  if (moved.length) paragraphs[0].unshift(...moved);
  part.set(paragraphs);
}

export function applyDocRequest(doc, r) {
  if (r.deleteContentRange) {
    const { segmentId, startIndex, endIndex } = r.deleteContentRange.range;
    const part = partOf(doc, segmentId);
    edit(part, (items) => items.splice(startIndex - part.start, endIndex - startIndex));
  } else if (r.insertText) {
    const { segmentId, index } = r.insertText.location;
    const part = partOf(doc, segmentId);
    edit(part, (items) => items.splice(index - part.start, 0, ...r.insertText.text));
  }
}
