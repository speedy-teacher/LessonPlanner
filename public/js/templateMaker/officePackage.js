// Getting a picture's file out of a presentation or document. Google's APIs only give a short-lived picture
// address that the browser may show but not download, so the file is fetched as PowerPoint/Word (Google's
// own files are exported, Office files downloaded as they are) — those are zip files with the pictures inside.
// The pictures on the first slide (or in the document) are then matched to the ones Google listed by their
// place and size.
//
// Pure logic (uses the browser's / Node's DecompressionStream), shared by the browser and the Node tests.

/** Picture kinds that can be used in Lesson Planner (other kinds, e.g. EMF drawings, are skipped). */
export const PICTURE_TYPES = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', bmp: 'image/bmp', webp: 'image/webp', tif: 'image/tiff', tiff: 'image/tiff', svg: 'image/svg+xml' };

// ---------- zip ----------

/** The files in a zip: Map(name → { method, size, offset }). `bytes` = Uint8Array. */
export function zipEntries(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let end = bytes.length - 22;
  while (end >= 0 && view.getUint32(end, true) !== 0x06054b50) end -= 1;
  if (end < 0) throw new Error('not_a_zip');
  const count = view.getUint16(end + 10, true);
  let at = view.getUint32(end + 16, true);
  const entries = new Map();
  const decoder = new TextDecoder();
  for (let i = 0; i < count; i += 1) {
    const nameLength = view.getUint16(at + 28, true);
    const name = decoder.decode(bytes.subarray(at + 46, at + 46 + nameLength));
    entries.set(name, { method: view.getUint16(at + 10, true), size: view.getUint32(at + 20, true), header: view.getUint32(at + 42, true) });
    at += 46 + nameLength + view.getUint16(at + 30, true) + view.getUint16(at + 32, true);
  }
  return { bytes, view, entries };
}

/** One file from the zip as bytes (null when it isn't there). */
export async function zipFile(zip, name) {
  const entry = zip.entries.get(name);
  if (!entry) return null;
  const h = entry.header;
  const start = h + 30 + zip.view.getUint16(h + 26, true) + zip.view.getUint16(h + 28, true);
  const raw = zip.bytes.subarray(start, start + entry.size);
  if (entry.method === 0) return raw.slice();
  const stream = new Blob([raw]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

const zipText = async (zip, name) => {
  const bytes = await zipFile(zip, name);
  return bytes ? new TextDecoder().decode(bytes) : null;
};

// ---------- the parts inside ----------

/** A part's links: Map(rId → full part name). */
async function links(zip, part) {
  const slash = part.lastIndexOf('/');
  const folder = part.slice(0, slash);
  const xml = await zipText(zip, `${folder}/_rels/${part.slice(slash + 1)}.rels`);
  const out = new Map();
  for (const m of (xml ?? '').matchAll(/<Relationship\b[^>]*>/g)) {
    const id = attr(m[0], 'Id');
    const target = attr(m[0], 'Target');
    if (id && target) out.set(id, resolve(folder, target));
  }
  return out;
}

const attr = (tag, name) => new RegExp(`\\b${name}="([^"]*)"`).exec(tag)?.[1] ?? null;

function resolve(folder, target) {
  if (target.startsWith('/')) return target.slice(1);
  const parts = folder.split('/');
  for (const piece of target.split('/')) {
    if (piece === '..') parts.pop();
    else if (piece !== '.') parts.push(piece);
  }
  return parts.join('/');
}

/** The first slide's part name in a PowerPoint file. */
async function firstSlide(zip) {
  const xml = await zipText(zip, 'ppt/presentation.xml');
  const rid = /<p:sldId\b[^>]*>/.exec(xml ?? '')?.[0];
  const slide = rid ? (await links(zip, 'ppt/presentation.xml')).get(attr(rid, 'r:id')) : null;
  return slide ?? 'ppt/slides/slide1.xml';
}

/** The pictures on a PowerPoint file's first slide: [{ part, box }] (box in EMU). */
export async function slidePictures(zip) {
  const slide = await firstSlide(zip);
  const xml = (await zipText(zip, slide)) ?? '';
  const rels = await links(zip, slide);
  return [...xml.matchAll(/<p:pic>[\s\S]*?<\/p:pic>/g)].map((m) => ({
    part: rels.get(attr(/<a:blip\b[^>]*>/.exec(m[0])?.[0] ?? '', 'r:embed')) ?? null, box: xfrm(m[0]),
  })).filter((p) => p.part);
}

function xfrm(xml) {
  const off = /<a:off\b[^>]*>/.exec(xml)?.[0] ?? '';
  const ext = /<a:ext\b[^>]*cx="[^>]*>/.exec(xml)?.[0] ?? '';
  return { x: Number(attr(off, 'x') ?? 0), y: Number(attr(off, 'y') ?? 0), width: Number(attr(ext, 'cx') ?? 0), height: Number(attr(ext, 'cy') ?? 0) };
}

/** The pictures in a Word file, in order: [{ part, box }] (only size is known; x/y null). */
export async function documentPictures(zip) {
  const part = 'word/document.xml';
  const xml = (await zipText(zip, part)) ?? '';
  const rels = await links(zip, part);
  return [...xml.matchAll(/<w:drawing>[\s\S]*?<\/w:drawing>/g)].map((m) => {
    const extent = /<wp:extent\b[^>]*>/.exec(m[0])?.[0] ?? '';
    return {
      part: rels.get(attr(/<a:blip\b[^>]*>/.exec(m[0])?.[0] ?? '', 'r:embed')) ?? null,
      box: { x: null, y: null, width: Number(attr(extent, 'cx') ?? 0), height: Number(attr(extent, 'cy') ?? 0) },
    };
  }).filter((p) => p.part);
}

// ---------- matching ----------

/** How far apart two places/sizes are (EMU). Unknown places (Docs) compare size only. */
function distance(a, b) {
  const place = a.x === null || b.x === null ? 0 : Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
  return place + Math.abs(a.width - b.width) + Math.abs(a.height - b.height);
}

/** Close enough to be the same picture: within a tenth of its size (or about 1/20 inch for tiny ones). */
const closeEnough = (box, d) => d <= Math.max(45720, 0.1 * (box.width + box.height));

/**
 * Pair Google's pictures with the zip's: Map(picture key → zip part). Each zip picture is used once; ties go to
 * the one in the same order. Pictures with no close match are left out (they can't be saved).
 */
export function matchPictures(pictures, found) {
  const out = new Map();
  const used = new Set();
  pictures.forEach((p, i) => {
    let best = null;
    found.forEach((f, j) => {
      if (used.has(j)) return;
      const d = distance(p.box, f.box) + (i === j ? 0 : 1);
      if (!best || d < best.d) best = { d, j };
    });
    if (best && closeEnough(p.box, best.d)) {
      used.add(best.j);
      out.set(p.key, found[best.j].part);
    }
  });
  return out;
}

/** A picture's bytes and kind from the zip: { bytes, mimeType, extension } or null when its kind can't be used. */
export async function pictureFile(zip, part) {
  const extension = part.split('.').pop().toLowerCase();
  const mimeType = PICTURE_TYPES[extension];
  if (!mimeType) return null;
  const bytes = await zipFile(zip, part);
  return bytes ? { bytes, mimeType, extension } : null;
}
