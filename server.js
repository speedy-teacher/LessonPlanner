// Small local web server: serves the app and saves/loads its data file.
//
//   GET  /api/state   -> { state: {...} | null }
//   PUT  /api/state   -> saves the whole state (POST also accepted, for
//                        saving while the page is closing)
//
// Data is written to data/lesson-planner.json. A copy is also kept per day
// in data/backups/ so an accidental change can always be recovered.

import { createServer } from 'node:http';
import { mkdir, readFile, rename, writeFile, copyFile, access } from 'node:fs/promises';
import { join, extname, normalize, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { exec } from 'node:child_process';

const ROOT = dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = join(ROOT, 'public');
const MAX_BODY = 20 * 1024 * 1024;

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.json': 'application/json',
};

export function createApp({ dataDir = join(ROOT, 'data') } = {}) {
  const dataFile = join(dataDir, 'lesson-planner.json');

  async function loadState() {
    try {
      return JSON.parse(await readFile(dataFile, 'utf8'));
    } catch (err) {
      if (err.code === 'ENOENT') return null;
      throw err;
    }
  }

  async function saveState(state) {
    await mkdir(join(dataDir, 'backups'), { recursive: true });
    const tmp = `${dataFile}.tmp`;
    await writeFile(tmp, JSON.stringify(state, null, 2));
    await rename(tmp, dataFile);
    const backup = join(dataDir, 'backups', `${new Date().toISOString().slice(0, 10)}.json`);
    const exists = await access(backup).then(() => true, () => false);
    if (!exists) await copyFile(dataFile, backup);
  }

  return createServer((req, res) => {
    handle(req, res, { loadState, saveState }).catch((err) => {
      console.error(err);
      send(res, 500, { error: 'Something went wrong on the server.' });
    });
  });
}

async function handle(req, res, store) {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname === '/api/state') return handleState(req, res, store);
  if (req.method !== 'GET') return send(res, 405, { error: 'Method not allowed' });
  return serveStatic(url.pathname, res);
}

async function handleState(req, res, store) {
  if (req.method === 'GET') return send(res, 200, { state: await store.loadState() });
  if (req.method !== 'PUT' && req.method !== 'POST') return send(res, 405, { error: 'Method not allowed' });
  const state = JSON.parse(await readBody(req));
  if (!isValidState(state)) return send(res, 400, { error: 'That does not look like planner data.' });
  await store.saveState(state);
  return send(res, 200, { ok: true, savedAt: new Date().toISOString() });
}

export function isValidState(state) {
  return Boolean(state) && typeof state === 'object' && !Array.isArray(state)
    && Number.isInteger(state.schemaVersion) && Array.isArray(state.years);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY) reject(new Error('Body too large'));
      else chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

async function serveStatic(pathname, res) {
  const rel = normalize(decodeURIComponent(pathname === '/' ? '/index.html' : pathname));
  const file = join(PUBLIC_DIR, rel);
  if (!file.startsWith(PUBLIC_DIR)) return send(res, 403, { error: 'Forbidden' });
  try {
    const body = await readFile(file);
    res.writeHead(200, { 'Content-Type': TYPES[extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    return res.end(body);
  } catch {
    return send(res, 404, { error: 'Not found' });
  }
}

function send(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

function openBrowser(url) {
  const cmd = process.platform === 'win32' ? `start "" "${url}"`
    : process.platform === 'darwin' ? `open "${url}"` : `xdg-open "${url}"`;
  exec(cmd);
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === normalize(process.argv[1]);
if (isMain) {
  const port = Number(process.env.PORT) || 5178;
  createApp().listen(port, '127.0.0.1', () => {
    const url = `http://localhost:${port}`;
    console.log(`Lesson Planner is running at ${url}  (close this window to stop it)`);
    if (!process.argv.includes('--no-open')) openBrowser(url);
  });
}
