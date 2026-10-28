// Small local web server for trying the planner on this computer. The planner
// itself is a plain website (the public/ folder) that keeps its data in the
// browser and Google Drive, so it can be put on any static web host.
//
//   GET /api/state -> { state: {...} | null }  read-only: the data the older planner
//                     saved in data/lesson-planner.json, so it can be moved to Drive.

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, extname, normalize, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { exec } from 'node:child_process';

const ROOT = dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = join(ROOT, 'public');

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

  return createServer((req, res) => {
    handle(req, res, loadState).catch((err) => {
      console.error(err);
      send(res, 500, { error: 'Something went wrong on the server.' });
    });
  });
}

async function handle(req, res, loadState) {
  if (req.method !== 'GET') return send(res, 405, { error: 'Method not allowed' });
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname === '/api/state') return send(res, 200, { state: await loadState() });
  return serveStatic(url.pathname, res);
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
