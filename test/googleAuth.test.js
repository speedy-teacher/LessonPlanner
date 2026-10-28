// Staying signed in to Google Drive, tested against a pretend Google.
// All codes here are obviously fake test values.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../server.js';

const CLIENT = 'fake-client.apps.googleusercontent.com';
const SECRET = 'fake-secret';

/** A pretend Google token service. `google.expired = true` acts like a 7-day-old test-mode sign-in. */
function fakeGoogle() {
  const google = { expired: false, revoked: [] };
  google.server = createServer(async (req, res) => {
    let raw = '';
    for await (const chunk of req) raw += chunk;
    const [status, body] = googleAnswer(google, req.url, new URLSearchParams(raw));
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(body));
  });
  return google;
}

function googleAnswer(google, url, p) {
  if (url === '/revoke') { google.revoked.push(p.get('token')); return [200, {}]; }
  if (p.get('client_id') !== CLIENT || p.get('client_secret') !== SECRET) return [401, { error: 'invalid_client' }];
  const grant = p.get('grant_type');
  if (grant === 'authorization_code' && p.get('code') === 'fake-code' && p.get('redirect_uri') === 'postmessage') {
    return [200, { access_token: 'fake-access-1', expires_in: 3599, refresh_token: 'fake-refresh' }];
  }
  if (grant === 'refresh_token' && p.get('refresh_token') === 'fake-refresh' && !google.expired) {
    return [200, { access_token: 'fake-access-2', expires_in: 3599 }];
  }
  return [400, { error: 'invalid_grant' }];
}

async function withPlanner(fn) {
  const google = fakeGoogle();
  await new Promise((r) => google.server.listen(0, '127.0.0.1', r));
  const g = `http://127.0.0.1:${google.server.address().port}`;
  const dataDir = await mkdtemp(join(tmpdir(), 'planner-google-'));
  const app = createApp({ dataDir, google: { tokenUrl: `${g}/token`, revokeUrl: `${g}/revoke` } });
  await new Promise((r) => app.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${app.address().port}/api/google`;
  const call = async (method, name, body, headers = { 'X-Planner': '1' }) => {
    const res = await fetch(`${base}/${name}`, { method, headers, body: body && JSON.stringify(body) });
    return { status: res.status, body: await res.json() };
  };
  try {
    await fn({ call, google, dataDir });
  } finally {
    app.close();
    google.server.close();
    await rm(dataDir, { recursive: true, force: true });
  }
}

test('after signing in once, the planner gets fresh passes without signing in again', async () => {
  await withPlanner(async ({ call }) => {
    assert.deepEqual((await call('GET', 'status')).body, { hasSecret: false, signedIn: false });
    await call('PUT', 'secret', { clientSecret: SECRET });
    assert.deepEqual((await call('GET', 'status')).body, { hasSecret: true, signedIn: false });
    const first = await call('POST', 'exchange', { clientId: CLIENT, code: 'fake-code' });
    assert.deepEqual(first.body, { accessToken: 'fake-access-1', expiresIn: 3599 });
    assert.deepEqual((await call('GET', 'status')).body, { hasSecret: true, signedIn: true });
    const again = await call('POST', 'refresh', { clientId: CLIENT });
    assert.deepEqual(again, { status: 200, body: { accessToken: 'fake-access-2', expiresIn: 3599 } });
  });
});

test('when Google ends the sign-in (e.g. weekly in testing mode), the planner is told to ask you to sign in', async () => {
  await withPlanner(async ({ call, google }) => {
    await call('PUT', 'secret', { clientSecret: SECRET });
    await call('POST', 'exchange', { clientId: CLIENT, code: 'fake-code' });
    google.expired = true;
    assert.deepEqual(await call('POST', 'refresh', { clientId: CLIENT }), { status: 401, body: { needsSignIn: true } });
    assert.equal((await call('POST', 'refresh', { clientId: CLIENT })).status, 401, 'reminds you again next time');
    google.expired = false;
    await call('POST', 'exchange', { clientId: CLIENT, code: 'fake-code' });
    assert.equal((await call('POST', 'refresh', { clientId: CLIENT })).status, 200, 'signing in again fixes it');
  });
});

test('without the client secret or a sign-in, refreshing asks you to sign in', async () => {
  await withPlanner(async ({ call }) => {
    assert.equal((await call('POST', 'refresh', { clientId: CLIENT })).status, 401);
    assert.deepEqual((await call('POST', 'exchange', { clientId: CLIENT, code: 'fake-code' })).body, { error: 'no_secret' });
  });
});

test('disconnecting forgets the sign-in and tells Google, but keeps the client secret', async () => {
  await withPlanner(async ({ call, google, dataDir }) => {
    await call('PUT', 'secret', { clientSecret: SECRET });
    await call('POST', 'exchange', { clientId: CLIENT, code: 'fake-code' });
    await call('POST', 'disconnect');
    assert.deepEqual(google.revoked, ['fake-refresh']);
    assert.deepEqual((await call('GET', 'status')).body, { hasSecret: true, signedIn: false });
    const saved = JSON.parse(await readFile(join(dataDir, 'google-auth.json'), 'utf8'));
    assert.equal(saved.refreshToken, '');
  });
});

test('the secret is never sent back to the page, and other websites are refused', async () => {
  await withPlanner(async ({ call }) => {
    await call('PUT', 'secret', { clientSecret: SECRET });
    assert.ok(!JSON.stringify((await call('GET', 'status')).body).includes(SECRET));
    assert.equal((await call('GET', 'status', undefined, {})).status, 403, 'missing X-Planner header');
  });
});
