// Keeps you signed in to Google Drive. The page signs in once through
// Google's window and hands the server a one-time code; the server swaps it
// for a long-lasting "refresh token" and keeps that (with the client secret)
// in data/google-auth.json on this computer only. Afterwards the page asks
// the server for fresh one-hour passes, so you don't have to sign in again.
//
//   GET  /api/google/status      -> { hasSecret, signedIn }  (signedIn: a sign-in is saved;
//                                   Google may still have ended it, which refresh reports)
//   PUT  /api/google/secret      { clientSecret }        (empty clears it)
//   POST /api/google/exchange    { clientId, code }      -> { accessToken, expiresIn }
//   POST /api/google/refresh     { clientId }            -> { accessToken, expiresIn } | 401 { needsSignIn }
//   POST /api/google/disconnect
//
// Requests must carry the X-Planner header, which other websites can't send,
// and come to this computer's own address.

import { readFile, rename, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';

export const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
export const GOOGLE_REVOKE_URL = 'https://oauth2.googleapis.com/revoke';
const LOCAL_HOSTS = /^(localhost|127\.0\.0\.1)(:\d+)?$/;

export function createGoogleAuth({ dataDir, tokenUrl = GOOGLE_TOKEN_URL, revokeUrl = GOOGLE_REVOKE_URL }) {
  const file = join(dataDir, 'google-auth.json');

  async function load() {
    try { return JSON.parse(await readFile(file, 'utf8')); } catch { return {}; }
  }

  async function save(data) {
    await mkdir(dataDir, { recursive: true });
    await writeFile(`${file}.tmp`, JSON.stringify(data, null, 2));
    await rename(`${file}.tmp`, file);
  }

  async function askGoogle(params) {
    let res;
    try {
      res = await fetch(tokenUrl, { method: 'POST', body: new URLSearchParams(params) });
    } catch {
      return { status: 502, body: { error: 'offline' } };
    }
    const body = await res.json().catch(() => ({}));
    if (res.ok) return { status: 200, body };
    return { status: body.error === 'invalid_grant' ? 401 : 400, body: { error: body.error || 'google_error' } };
  }

  const routes = {
    'GET status': async () => {
      const { clientSecret, refreshToken } = await load();
      return [200, { hasSecret: Boolean(clientSecret), signedIn: Boolean(refreshToken) }];
    },
    'PUT secret': async ({ clientSecret = '' }) => {
      const data = await load();
      await save({ ...data, clientSecret: String(clientSecret).trim() });
      return [200, { hasSecret: Boolean(String(clientSecret).trim()) }];
    },
    'POST exchange': async ({ clientId, code }) => {
      const data = await load();
      if (!data.clientSecret) return [400, { error: 'no_secret' }];
      const reply = await askGoogle({
        client_id: clientId, client_secret: data.clientSecret, code, grant_type: 'authorization_code', redirect_uri: 'postmessage',
      });
      if (reply.status !== 200) return [reply.status, reply.body];
      if (reply.body.refresh_token) await save({ ...data, refreshToken: reply.body.refresh_token });
      return [200, pass(reply.body)];
    },
    'POST refresh': async ({ clientId }) => {
      const data = await load();
      if (!data.clientSecret || !data.refreshToken) return [401, { needsSignIn: true }];
      const reply = await askGoogle({
        client_id: clientId, client_secret: data.clientSecret, refresh_token: data.refreshToken, grant_type: 'refresh_token',
      });
      // An ended sign-in is kept until you sign in again, so each time the
      // planner opens it can remind you.
      if (reply.status === 401) return [401, { needsSignIn: true }];
      return reply.status === 200 ? [200, pass(reply.body)] : [reply.status, reply.body];
    },
    'POST disconnect': async () => {
      const data = await load();
      if (data.refreshToken) {
        await fetch(revokeUrl, { method: 'POST', body: new URLSearchParams({ token: data.refreshToken }) }).catch(() => {});
      }
      await save({ ...data, refreshToken: '' });
      return [200, { ok: true }];
    },
  };

  /** Returns [status, body] for /api/google/<name>. */
  return async function handleGoogle(req, name, readJson) {
    if (!LOCAL_HOSTS.test(req.headers.host || '') || req.headers['x-planner'] !== '1') return [403, { error: 'forbidden' }];
    const route = routes[`${req.method} ${name}`];
    if (!route) return [404, { error: 'Not found' }];
    return route(req.method === 'GET' ? {} : await readJson());
  };
}

function pass(body) {
  return { accessToken: body.access_token, expiresIn: Number(body.expires_in) || 3600, scope: body.scope || '' };
}
