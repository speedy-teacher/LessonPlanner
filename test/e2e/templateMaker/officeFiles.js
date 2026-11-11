// Small PowerPoint and Word files (zips) for the tests, with pictures inside.

const enc = new TextEncoder();

/** A zip of { name: string | Uint8Array }. With `deflate` (e.g. node:zlib deflateRawSync), text files are compressed. */
export function makeZip(entries, { deflate = null } = {}) {
  const local = [];
  const central = [];
  let offset = 0;
  for (const [name, content] of Object.entries(entries)) {
    const data = typeof content === 'string' ? enc.encode(content) : content;
    const method = deflate && typeof content === 'string' ? 8 : 0;
    const stored = method === 8 ? new Uint8Array(deflate(data)) : data;
    const nameBytes = enc.encode(name);
    const head = new Uint8Array(30 + nameBytes.length);
    const h = new DataView(head.buffer);
    h.setUint32(0, 0x04034b50, true);
    h.setUint16(8, method, true);
    h.setUint32(18, stored.length, true);
    h.setUint32(22, data.length, true);
    h.setUint16(26, nameBytes.length, true);
    head.set(nameBytes, 30);
    const dir = new Uint8Array(46 + nameBytes.length);
    const d = new DataView(dir.buffer);
    d.setUint32(0, 0x02014b50, true);
    d.setUint16(10, method, true);
    d.setUint32(20, stored.length, true);
    d.setUint32(24, data.length, true);
    d.setUint16(28, nameBytes.length, true);
    d.setUint32(42, offset, true);
    dir.set(nameBytes, 46);
    local.push(head, stored);
    central.push(dir);
    offset += head.length + stored.length;
  }
  const size = central.reduce((s, c) => s + c.length, 0);
  const end = new Uint8Array(22);
  const e = new DataView(end.buffer);
  e.setUint32(0, 0x06054b50, true);
  e.setUint16(8, central.length, true);
  e.setUint16(10, central.length, true);
  e.setUint32(12, size, true);
  e.setUint32(16, offset, true);
  const out = new Uint8Array(offset + size + 22);
  let at = 0;
  for (const part of [...local, ...central, end]) { out.set(part, at); at += part.length; }
  return out;
}

/** Pretend picture bytes (a PNG's first bytes + a mark, so different pictures differ). */
export const pictureBytes = (mark) => new Uint8Array([0x89, 0x50, 0x4e, 0x47, ...enc.encode(mark)]);

const rel = (id, target) => `<Relationship Id="${id}" Type="x" Target="${target}"/>`;

/** A PowerPoint file whose first slide has these pictures: [{ x, y, cx, cy, file, bytes }]. */
export function pptx(pictures) {
  const pics = pictures.map((p, i) => `<p:pic><p:nvPicPr><p:cNvPr id="${i + 2}" name="Picture"/></p:nvPicPr><p:blipFill><a:blip r:embed="rIdP${i}"><a:extLst><a:ext uri="{x}"/></a:extLst></a:blip></p:blipFill><p:spPr><a:xfrm><a:off x="${p.x}" y="${p.y}"/><a:ext cx="${p.cx}" cy="${p.cy}"/></a:xfrm></p:spPr></p:pic>`).join('');
  const entries = {
    'ppt/presentation.xml': '<p:presentation><p:sldIdLst><p:sldId id="256" r:id="rId7"/></p:sldIdLst></p:presentation>',
    'ppt/_rels/presentation.xml.rels': `<Relationships>${rel('rId7', 'slides/slide1.xml')}</Relationships>`,
    'ppt/slides/slide1.xml': `<p:sld><p:cSld><p:spTree>${pics}</p:spTree></p:cSld></p:sld>`,
    'ppt/slides/_rels/slide1.xml.rels': `<Relationships>${pictures.map((p, i) => rel(`rIdP${i}`, `../media/${p.file}`)).join('')}</Relationships>`,
  };
  for (const p of pictures) entries[`ppt/media/${p.file}`] = p.bytes;
  return makeZip(entries);
}

/** A Word file with these pictures in order: [{ cx, cy, file, bytes }]. */
export function docx(pictures) {
  const drawings = pictures.map((p, i) => `<w:p><w:r><w:drawing><wp:inline><wp:extent cx="${p.cx}" cy="${p.cy}"/><a:graphic><pic:pic><pic:blipFill><a:blip r:embed="rIdP${i}"/></pic:blipFill></pic:pic></a:graphic></wp:inline></w:drawing></w:r></w:p>`).join('');
  const entries = {
    'word/document.xml': `<w:document><w:body>${drawings}</w:body></w:document>`,
    'word/_rels/document.xml.rels': `<Relationships>${pictures.map((p, i) => rel(`rIdP${i}`, `media/${p.file}`)).join('')}</Relationships>`,
  };
  for (const p of pictures) entries[`word/media/${p.file}`] = p.bytes;
  return makeZip(entries);
}
