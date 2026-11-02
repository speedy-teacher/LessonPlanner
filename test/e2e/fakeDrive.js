// A pretend Google Drive that lives inside the page, for the browser tests (see README.md).
//
// It replaces `window.fetch` for Google Drive addresses only and answers exactly what public/js/driveFiles.js
// sends. A request to any other Google address is refused and counted (`violations()`), so a test can never
// reach the real Google. Addresses that are not Google's (the app's own files) go through untouched.
//
// Each file: { id, name, parents, mimeType, properties, owner: { displayName, permissionId }, ownedByMe,
//   canEdit, shared, text, revNo, modifiedAt }. `revNo` changes on every content write (headRevisionId).
// Files owned by someone else are only found/opened while `shared` is true (use `share()`).

export const ME = { displayName: 'Me Example', permissionId: 'perm-me' };
export const FOLDER_MIME = 'application/vnd.google-apps.folder';

let drive = null; // { files, counter, clock, realFetch, bad, calls }

const GOOGLE = /(^|\.)(googleapis\.com|google\.com|googleusercontent\.com|gstatic\.com)$/;

// ---------- turning it on and off ----------

/** Start pretending. Everything in the fake Drive is forgotten. */
export function install() {
  if (drive) uninstall();
  drive = { files: new Map(), counter: 0, clock: Date.now(), realFetch: window.fetch, bad: [], calls: [] };
  window.fetch = (input, init) => answer(input, init);
  return drive;
}

export function uninstall() {
  if (drive) window.fetch = drive.realFetch;
  drive = null;
}

/** Requests to Google addresses the fake did not understand (a case must have none). */
export function violations() {
  return drive ? [...drive.bad] : [];
}

/** Every Drive request answered so far: [{ method, path }]. */
export function calls() {
  return drive ? [...drive.calls] : [];
}

// ---------- helpers for the tests ----------

const slug = (text) => text.toLowerCase().replace(/[^a-z]+/g, '-');

/**
 * Put a file in the fake Drive. `data` (an object) or `text` is its contents. `owner` = a person's name
 * (their `ownerId` follows from it); no owner = mine. Returns the file's id.
 */
const FILE_DEFAULTS = { data: null, text: null, properties: {}, owner: null, canEdit: true, shared: true, parents: ['folder-lesson-planner'], mimeType: 'application/json' };

export function addFile(options) {
  const o = { ...FILE_DEFAULTS, ...options };
  drive.counter += 1;
  const id = `fake-${drive.counter}`;
  const mine = !o.owner;
  drive.files.set(id, {
    id, name: o.name, parents: o.parents, mimeType: o.mimeType, properties: { ...o.properties }, owner: mine ? ME : personOf(o.owner),
    ownedByMe: mine, canEdit: mine || o.canEdit, shared: mine || o.shared, text: o.text ?? (o.data ? JSON.stringify(o.data) : ''),
    revNo: 1, modifiedAt: tick(),
  });
  return id;
}

const personOf = (name) => ({ displayName: name, permissionId: `perm-${slug(name)}` });

function tick() {
  drive.clock += 1000;
  return new Date(drive.clock).toISOString();
}

function must(fileId) {
  const file = drive?.files.get(fileId);
  if (!file) throw new Error(`fakeDrive: no file ${fileId}`);
  return file;
}

/** A colleague changes their file: parse it, `change(data)` (return a new object, or change it in place), save. */
export function edit(fileId, change) {
  const file = must(fileId);
  const data = JSON.parse(file.text);
  file.text = JSON.stringify(change(data) ?? data);
  file.revNo += 1;
  file.modifiedAt = tick();
}

/** A file's contents, read as data. */
export function read(fileId) {
  return JSON.parse(must(fileId).text);
}

/** A file's current revision (changes on every write). */
export function revOf(fileId) {
  return `r${must(fileId).revNo}`;
}

/** Share a colleague's file with me as 'writer' (Editor) or 'reader' (Viewer), or stop sharing (null). */
export function share(fileId, role) {
  const file = must(fileId);
  file.shared = role !== null;
  if (role) file.canEdit = role === 'writer';
}

/** I share one of my own files with colleagues in Drive (true), or stop (false). */
export function shareMine(fileId, on = true) {
  must(fileId).sharedOut = on;
}

/** The ids of my files (the ones I own) whose label `lessonPlanner` is `kind`. */
export function mineOf(kind) {
  return [...drive.files.values()].filter((f) => f.ownedByMe && f.properties.lessonPlanner === kind).map((f) => f.id);
}

/** Look inside a file by id (name, labels…). */
export function describe(fileId) {
  const { text: _text, ...rest } = must(fileId);
  return rest;
}

// ---------- answering ----------

const reply = (status, body) => new Response(typeof body === 'string' ? body : JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

async function answer(input, init = {}) {
  const url = new URL(typeof input === 'string' ? input : input.url, location.href);
  if (!GOOGLE.test(url.hostname)) return drive.realFetch(input, init);
  const method = (init.method ?? 'GET').toUpperCase();
  const handled = route(url, method, init);
  if (!handled) {
    drive.bad.push(`${method} ${url.href}`);
    throw new Error(`fakeDrive: refused a request to Google: ${method} ${url.href}`);
  }
  drive.calls.push({ method, path: url.pathname });
  return handled;
}

const FILES = /^\/drive\/v3\/files\/?$/;
const FILE = /^\/drive\/v3\/files\/([^/]+)$/;
const REVISION = /^\/drive\/v3\/files\/([^/]+)\/revisions\/([^/]+)$/;
const UPLOAD = /^\/upload\/drive\/v3\/files\/?$/;
const UPLOAD_FILE = /^\/upload\/drive\/v3\/files\/([^/]+)$/;

/** [method, address pattern, handler(match, url, init)]: the requests we answer. */
const ROUTES = [
  ['GET', FILES, (_m, url) => listFiles(url)],
  ['POST', FILES, (_m, _url, init) => makeFolder(init)],
  ['POST', UPLOAD, (_m, _url, init) => upload(init)],
  ['PATCH', REVISION, (m) => opened(decodeURIComponent(m[1]), () => reply(200, {}))],
  ['GET', FILE, (m, url) => getFile(decodeURIComponent(m[1]), url)],
  ['PATCH', FILE, (m, url, init) => patchFile(decodeURIComponent(m[1]), url, init)],
  ['PATCH', UPLOAD_FILE, (m, _url, init) => replaceContent(decodeURIComponent(m[1]), init)],
];

/** The reply for a request we know, or null for one we don't. */
function route(url, method, init) {
  if (url.hostname !== 'www.googleapis.com') return null;
  for (const [verb, pattern, handle] of ROUTES) {
    const match = verb === method ? pattern.exec(url.pathname) : null;
    if (match) return handle(match, url, init);
  }
  return null;
}

/** Run `then(file)` for a file I can open, else answer 404 (nobody has it) or 403 (not shared with me). */
function opened(fileId, then) {
  const file = drive.files.get(fileId);
  if (!file) return reply(404, { error: { code: 404 } });
  if (!file.ownedByMe && !file.shared) return reply(403, { error: { code: 403 } });
  return then(file);
}

const metadata = (f) => ({
  id: f.id, name: f.name, parents: f.parents, mimeType: f.mimeType, headRevisionId: `r${f.revNo}`, modifiedTime: f.modifiedAt,
  ownedByMe: f.ownedByMe, capabilities: { canEdit: f.canEdit }, owners: [f.owner], properties: f.properties,
  // Like Drive: whether a file is shared with anyone (mine: only after I share it; a colleague's: yes).
  shared: f.ownedByMe ? Boolean(f.sharedOut) : true,
});

function getFile(fileId, url) {
  return opened(fileId, (file) => (url.searchParams.get('alt') === 'media' ? new Response(file.text) : reply(200, metadata(file))));
}

function listFiles(url) {
  const test = compile(url.searchParams.get('q') ?? '');
  const files = [...drive.files.values()]
    .filter((f) => (f.ownedByMe || f.shared) && !f.trashed && test(f))
    .sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt));
  return reply(200, { files: files.map(metadata) });
}

function makeFolder(init) {
  const body = JSON.parse(init.body);
  const id = addFile({ name: body.name, properties: body.properties ?? {}, mimeType: body.mimeType, parents: [] });
  return reply(200, { id });
}

/** A multipart upload: a JSON part (name, parents, labels) then the contents. */
function upload(init) {
  const boundary = /boundary=(.+)$/.exec(init.headers['Content-Type'])[1];
  const [, meta, contents] = String(init.body).split(`--${boundary}`).map((part) => part.replace(/^\r\n/, '').split('\r\n\r\n').slice(1).join('\r\n\r\n').replace(/\r\n$/, ''));
  const { name, parents, properties, mimeType } = JSON.parse(meta);
  const id = addFile({ name, text: contents, properties, parents, mimeType });
  return reply(200, metadata(drive.files.get(id)));
}

function replaceContent(fileId, init) {
  return opened(fileId, (file) => {
    if (!file.canEdit) return reply(403, { error: { code: 403 } });
    file.text = String(init.body);
    file.revNo += 1;
    file.modifiedAt = tick();
    return reply(200, { headRevisionId: `r${file.revNo}` });
  });
}

function patchFile(fileId, url, init) {
  return opened(fileId, (file) => {
    if (!file.canEdit) return reply(403, { error: { code: 403 } });
    const moveTo = url.searchParams.get('addParents');
    if (moveTo) {
      const away = url.searchParams.get('removeParents');
      file.parents = [moveTo, ...file.parents.filter((p) => p !== away && p !== moveTo)];
      return reply(200, { parents: file.parents });
    }
    const { name } = JSON.parse(init.body || '{}');
    if (name) file.name = name;
    return reply(200, { name: file.name });
  });
}

// ---------- the search words Drive understands (just those the planner sends) ----------

const TOKEN = /properties has \{ key='([^']*)' and value='([^']*)' \}|'me' in owners|trashed = false|mimeType = '([^']*)'|\(|\)|\band\b|\bor\b|\bnot\b|\S+/g;

/** One plain condition of a search, as a test on a file (null = not one we know). */
function leaf(t) {
  if (t?.key !== undefined) return (f) => f.properties[t.key] === t.value;
  if (t?.mime !== undefined) return (f) => f.mimeType === t.mime;
  if (t?.text === "'me' in owners") return (f) => f.ownedByMe;
  if (t?.text === 'trashed = false') return (f) => !f.trashed;
  return null;
}

/** `q` → a function telling whether a file matches. Anything not understood throws (so a test can't pass by luck). */
function compile(q) {
  const tokens = [...q.matchAll(TOKEN)].map((m) => ({ text: m[0], key: m[1], value: m[2], mime: m[3] }));
  let at = 0;
  const peek = () => tokens[at]?.text;
  const take = () => tokens[at++];
  const atom = () => {
    const t = take();
    if (t?.text === '(') { const inner = or(); take(); return inner; }
    if (t?.text === 'not') { const inner = atom(); return (f) => !inner(f); }
    const test = leaf(t);
    if (!test) throw new Error(`fakeDrive: don't understand "${t?.text}" in the search: ${q}`);
    return test;
  };
  const and = () => { let left = atom(); while (peek() === 'and') { take(); const l = left; const r = atom(); left = (f) => l(f) && r(f); } return left; };
  const or = () => { let left = and(); while (peek() === 'or') { take(); const l = left; const r = and(); left = (f) => l(f) || r(f); } return left; };
  const test = or();
  if (at < tokens.length) throw new Error(`fakeDrive: don't understand the end of the search: ${q}`);
  return test;
}
