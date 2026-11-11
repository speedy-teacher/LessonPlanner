// A pretend Google Drive (+ Slides, Docs and Sheets) that answers the same calls the real one does, so the
// whole tool can be tested without Google. Only what Template Maker uses is pretended.
//
//   const g = fakeGoogle();  g.add({ name, mimeType, parents, content | text | bytes })  → file
//   driveCalls(googleClient({ token: () => 't', fetchFn: g.fetch, sleep: async () => {} }))
//
// Content: Slides/Sheets = the API's JSON; Docs = fakeDoc() (rendered to the API's JSON when read);
// Lesson Planner files = `text`; pictures and Office files = `bytes`. `converted` = what an Office file
// becomes when copied as Google's kind; `exported` = the Office zip a Google file exports as.

import { applyDocRequest, renderDoc } from './fakeDocs.js';

const DRIVE = 'https://www.googleapis.com/drive/v3/files';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3/files';

export function fakeGoogle() {
  const files = new Map();
  const log = [];
  const trouble = [];
  let n = 0;
  let rev = 0;

  function add(file) {
    n += 1;
    const id = file.id ?? `file${n}`;
    const record = {
      name: 'Untitled', mimeType: 'application/octet-stream', parents: [], trashed: false, appProperties: {}, properties: {},
      capabilities: { canEdit: true, canAddChildren: true }, modifiedTime: new Date(Date.UTC(2026, 9, 1, 8, 0, n)).toISOString(),
      headRevisionId: `rev${(rev += 1)}`, ...structuredClone(file), id,
    };
    files.set(id, record);
    return record;
  }

  const touch = (file) => { file.headRevisionId = `rev${(rev += 1)}`; file.modifiedTime = new Date(Date.UTC(2026, 9, 2, 8, 0, rev)).toISOString(); };
  const meta = (f) => {
    const { content: _c, text: _t, bytes: _b, converted: _v, exported: _e, ...rest } = f;
    return structuredClone(rest);
  };
  const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  const missing = () => json({ error: { code: 404, message: 'File not found' } }, 404);

  async function fetchFn(url, init = {}) {
    const method = init.method ?? 'GET';
    log.push({ method, url });
    const problem = trouble.findIndex((t) => t.test(url, method));
    if (problem !== -1) {
      const t = trouble[problem];
      if (--t.times <= 0) trouble.splice(problem, 1);
      return json({ error: { code: t.status, message: t.message ?? 'Trouble', errors: [{ reason: t.reason ?? 'backendError' }] } }, t.status);
    }
    return route(new URL(url), method, init);
  }

  async function route(u, method, init) {
    const path = u.pathname;
    if (u.origin + path === DRIVE && method === 'GET') return json({ files: search(u.searchParams.get('q')).map(meta) });
    if (u.origin + path === UPLOAD && method === 'POST') return upload(init);
    const drive = /^\/(upload\/)?drive\/v3\/files\/([^/]+)(\/copy|\/export)?$/.exec(path);
    if (drive) return driveFile(decodeURIComponent(drive[2]), { upload: Boolean(drive[1]), extra: drive[3], method, u, init });
    const thumb = /^\/v1\/presentations\/([^/]+)\/pages\/([^/]+)\/thumbnail$/.exec(path);
    if (thumb) return files.get(decodeURIComponent(thumb[1])) ? json({ contentUrl: `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 90"><rect width="160" height="90" fill="#ece4f6"/></svg>')}` }) : missing();
    const api = /^\/(?:v1\/presentations|v1\/documents|v4\/spreadsheets)\/([^/:]+)(:batchUpdate)?$/.exec(path);
    if (api) return editorCall(decodeURIComponent(api[1]), Boolean(api[2]), init);
    return json({ error: { code: 400, message: `fake: no route for ${method} ${u}` } }, 400);
  }

  function driveFile(id, { upload: isUpload, extra, method, u, init }) {
    const file = files.get(id);
    if (!file) return missing();
    if (extra === '/copy') return copy(file, JSON.parse(init.body));
    if (extra === '/export') return file.exported ? new Response(file.exported) : json({ error: { code: 400, message: 'cannot export' } }, 400);
    if (isUpload) { file.text = init.body; touch(file); return json({ headRevisionId: file.headRevisionId }); }
    if (method === 'PATCH') return patch(move(file, u), JSON.parse(init.body));
    if (u.searchParams.get('alt') === 'media') return new Response(file.text ?? file.bytes ?? '');
    return json(meta(file));
  }

  /** addParents / removeParents in the address: the file moves folder. */
  function move(file, u) {
    const [to, from] = ['addParents', 'removeParents'].map((k) => u.searchParams.get(k));
    if (from) file.parents = file.parents.filter((p) => p !== from);
    if (to && !file.parents.includes(to)) file.parents.push(to);
    return file;
  }

  function patch(file, body) {
    for (const key of ['name', 'trashed']) if (key in body) file[key] = body[key];
    for (const key of ['appProperties', 'properties']) {
      for (const [k, v] of Object.entries(body[key] ?? {})) { if (v === null) delete file[key][k]; else file[key][k] = v; }
    }
    touch(file);
    return json(meta(file));
  }

  // Like Google, a copy may give slide elements, sheets and headers new ids: code must not rely on them.
  function renamed(content, stamp) {
    if (!content) return content;
    const elements = (list = []) => list.forEach((el) => { el.objectId = `${el.objectId}_c${stamp}`; elements(el.elementGroup?.children); });
    for (const slide of content.slides ?? []) elements(slide.pageElements);
    for (const sheet of content.sheets ?? []) if (sheet.properties) sheet.properties.sheetId += 1000 * stamp;
    if (content.headers) content.headers = Object.fromEntries(Object.entries(content.headers).map(([id, h]) => [`${id}_c${stamp}`, h]));
    return content;
  }

  function copy(file, body) {
    const converting = body.mimeType && body.mimeType !== file.mimeType;
    if (converting && !file.converted) return json({ error: { code: 400, message: 'cannot convert' } }, 400);
    const made = add({
      name: body.name ?? `Copy of ${file.name}`, mimeType: body.mimeType ?? file.mimeType, parents: body.parents ?? file.parents,
      appProperties: body.appProperties ?? {}, properties: body.properties ?? {},
      content: renamed(structuredClone(converting ? file.converted : file.content), (n += 1)), exported: file.exported, text: file.text, bytes: file.bytes,
    });
    return json(meta(made));
  }

  async function upload(init) {
    const raw = new Uint8Array(await init.body.arrayBuffer());
    const text = new TextDecoder('latin1').decode(raw);
    const boundary = /boundary=(\S+)/.exec(init.headers['Content-Type'])[1];
    const [, metaPart, dataPart] = text.split(`--${boundary}`);
    const body = JSON.parse(metaPart.slice(metaPart.indexOf('\r\n\r\n') + 4).trim());
    const dataStart = text.indexOf(dataPart) + dataPart.indexOf('\r\n\r\n') + 4;
    const dataEnd = text.lastIndexOf(`\r\n--${boundary}--`);
    const made = add({ ...body, bytes: raw.slice(dataStart, dataEnd) });
    return json(meta(made));
  }

  function editorCall(id, isWrite, init) {
    const file = files.get(id);
    if (!file) return missing();
    if (!isWrite) return json(file.mimeType.endsWith('document') ? renderDoc(file.content) : file.content);
    for (const request of JSON.parse(init.body).requests) applyRequest(file, request);
    touch(file);
    return json({ replies: [] });
  }

  function applyRequest(file, request) {
    if (file.mimeType.endsWith('presentation')) applySlidesRequest(file.content, request);
    else if (file.mimeType.endsWith('document')) applyDocRequest(file.content, request);
    else applySheetsRequest(file.content, request);
  }

  function search(query) {
    const tests = [];
    for (const m of query.matchAll(/(app)?[pP]roperties has \{ key='([^']+)' and value='([^']+)' \}/g)) {
      const [, app, key, value] = m;
      tests.push((f) => (app ? f.appProperties : f.properties)[key] === value);
    }
    for (const m of query.matchAll(/'([^']+)' in parents/g)) tests.push((f) => f.parents.includes(m[1]));
    return [...files.values()].filter((f) => !f.trashed && tests.every((t) => t(f))).reverse();
  }

  /** Answer the next `times` calls whose address contains `part` with an error. */
  function failNext(part, { status = 429, reason, message, method = null, times = 1 } = {}) {
    trouble.push({ test: (url, m) => url.includes(part) && (!method || m === method), status, reason, message, times });
  }

  return { add, files, log, fetch: fetchFn, failNext, get: (id) => files.get(id) };
}

// ---------- Slides and Sheets edits ----------

function slidesElements(presentation) {
  const all = (els = []) => els.flatMap((el) => (el.elementGroup ? [el, ...all(el.elementGroup.children)] : [el]));
  return (presentation.slides ?? []).flatMap((s) => all(s.pageElements).map((el) => ({ el, slide: s })));
}

function textHolder(presentation, { objectId, cellLocation }) {
  const { el } = slidesElements(presentation).find((x) => x.el.objectId === objectId);
  return cellLocation ? el.table.tableRows[cellLocation.rowIndex].tableCells[cellLocation.columnIndex].text : el.shape.text;
}

function setText(holder, change) {
  const text = (holder.textElements ?? []).map((t) => t.textRun?.content ?? '').join('');
  const next = change(text);
  holder.textElements = [{ startIndex: 0, endIndex: next.length, textRun: { content: next } }];
}

function applySlidesRequest(presentation, r) {
  if (r.deleteText) {
    const { startIndex, endIndex } = r.deleteText.textRange;
    setText(textHolder(presentation, r.deleteText), (t) => t.slice(0, startIndex) + t.slice(endIndex));
  } else if (r.insertText) {
    const at = r.insertText.insertionIndex;
    setText(textHolder(presentation, r.insertText), (t) => t.slice(0, at) + r.insertText.text + t.slice(at));
  } else if (r.createShape) {
    const { objectId, shapeType, elementProperties: p } = r.createShape;
    presentation.slides.find((s) => s.objectId === p.pageObjectId).pageElements.push({ objectId, size: p.size, transform: p.transform, shape: { shapeType } });
  } else if (r.updatePageElementAltText) {
    const { el } = slidesElements(presentation).find((x) => x.el.objectId === r.updatePageElementAltText.objectId);
    Object.assign(el, { title: r.updatePageElementAltText.title, description: r.updatePageElementAltText.description });
  } else if (r.updateShapeProperties) {
    const { el } = slidesElements(presentation).find((x) => x.el.objectId === r.updateShapeProperties.objectId);
    el.shape.shapeProperties = r.updateShapeProperties.shapeProperties;
  } else if (r.deleteObject) {
    for (const s of presentation.slides) s.pageElements = s.pageElements.filter((el) => el.objectId !== r.deleteObject.objectId);
  }
}

function applySheetsRequest(spreadsheet, r) {
  const { start, rows } = r.updateCells;
  const sheet = spreadsheet.sheets.find((s) => s.properties.sheetId === start.sheetId);
  const block = sheet.data[0];
  const row = block.rowData[start.rowIndex - (block.startRow ?? 0)];
  row.values[start.columnIndex - (block.startColumn ?? 0)].userEnteredValue = rows[0].values[0].userEnteredValue;
}
