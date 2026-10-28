// Google Drive connection. You sign in once through Google's own window;
// the local server keeps a long-lasting sign-in (see googleAuth.js) and the
// planner quietly gets fresh one-hour passes from it. The limited
// "drive.file" permission means the planner only sees Drive files you pick,
// or files it made itself. Passes are kept in memory only.

const GIS_SRC = 'https://accounts.google.com/gsi/client';
export const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file';
/** The address to add to "Authorized JavaScript origins" in Google's setup. */
export const APP_ORIGIN = 'http://localhost:5178';
const REFRESH_EARLY_SECONDS = 300;

/**
 * status: 'idle' | 'working' | 'connected' | 'needs-signin' | 'error'
 * hasSecret: the client secret is saved on this computer.
 */
export const google = { status: 'idle', message: '', userName: '', token: null, hasSecret: false };

let onChange = () => {};
let onNeedsSignIn = () => {};
let refreshTimer = null;

/** `change` redraws the page; `needsSignIn` is called when Google ends the sign-in. */
export function setGoogleHandlers({ change, needsSignIn }) {
  onChange = change;
  onNeedsSignIn = needsSignIn;
}

function set(patch) {
  Object.assign(google, patch);
  onChange();
}

// ---------- talking to the local server ----------

async function api(method, name, body) {
  const res = await fetch(`/api/google/${name}`, {
    method, headers: { 'X-Planner': '1' }, body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

export async function saveClientSecret(clientSecret) {
  const { body } = await api('PUT', 'secret', { clientSecret });
  set({ hasSecret: Boolean(body.hasSecret) });
}

/** Both codes needed to sign in are filled in. */
export function canSignIn(clientId) {
  return looksLikeClientId(clientId || '') && google.hasSecret;
}

// ---------- signing in ----------

let scriptPromise = null;
function loadSignInScript() {
  scriptPromise ??= new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = GIS_SRC;
    script.onload = resolve;
    script.onerror = () => { scriptPromise = null; reject(new Error('offline')); };
    document.head.append(script);
  });
  return scriptPromise;
}

/** Plain-language explanations for what can go wrong while connecting. */
const PROBLEMS = {
  offline: 'Couldn’t reach Google. Check the internet connection and try again.',
  popup_failed_to_open: 'The Google window was blocked. Allow pop-ups for this page, then try again.',
  popup_closed: 'The Google window was closed before finishing. If it said “Access blocked”, see the guide’s troubleshooting section.',
  access_denied: 'Google access was not allowed. If you clicked Cancel, try again and click Continue / Allow.',
  api_disabled: 'Signed in, but the Google Drive API isn’t turned on in your Google project yet (guide step 3).',
  drive_failed: 'Signed in, but Google Drive didn’t answer as expected. Try again in a minute.',
  no_secret: 'Paste the client secret first (guide step 6).',
  invalid_client: 'Google didn’t accept the Client ID or client secret. Check both were copied completely.',
  invalid_grant: 'Google didn’t accept the sign-in. Please try again.',
};

function problem(code) {
  return PROBLEMS[code] || `Something went wrong (${code}). Try again, or check the guide’s troubleshooting section.`;
}

/** Open Google's sign-in window (must follow a click), then stay signed in. */
export async function connectDrive(clientId) {
  set({ status: 'working', message: 'Waiting for the Google window…' });
  try {
    await loadSignInScript();
    const code = await requestCode(clientId);
    const { status, body } = await api('POST', 'exchange', { clientId, code });
    if (status !== 200) throw new Error(body.error || 'google_error');
    await useToken(clientId, body);
  } catch (err) {
    set({ status: 'error', token: null, message: problem(err.message) });
  }
}

function requestCode(clientId) {
  return new Promise((resolve, reject) => {
    const client = window.google.accounts.oauth2.initCodeClient({
      client_id: clientId,
      scope: DRIVE_SCOPE,
      ux_mode: 'popup',
      // "consent" makes Google hand out the long-lasting sign-in every time.
      prompt: 'consent',
      callback: (res) => (res.error ? reject(new Error(res.error)) : resolve(res.code)),
      error_callback: (err) => reject(new Error(err.type || 'unknown')),
    });
    client.requestCode();
  });
}

async function useToken(clientId, { accessToken, expiresIn }) {
  const userName = google.userName || await driveUserName(accessToken);
  set({ status: 'connected', token: accessToken, userName, message: '' });
  clearTimeout(refreshTimer);
  refreshTimer = setTimeout(() => refreshDrive(clientId), Math.max(60, expiresIn - REFRESH_EARLY_SECONDS) * 1000);
}

/** Get a fresh pass from the saved sign-in, with no Google window. */
export async function refreshDrive(clientId) {
  try {
    const { status, body } = await api('POST', 'refresh', { clientId });
    if (status === 200) return await useToken(clientId, body);
    if (status === 401) return needsSignIn();
    throw new Error(body.error || 'google_error');
  } catch (err) {
    return set({ status: 'error', token: null, message: problem(err.message) });
  }
}

function needsSignIn() {
  clearTimeout(refreshTimer);
  set({ status: 'needs-signin', token: null, message: 'Google signed you out. Sign in again to keep using Drive.' });
  onNeedsSignIn();
}

/** When the planner opens: reconnect quietly if you signed in before. */
export async function resumeDrive(clientId) {
  const { body } = await api('GET', 'status').catch(() => ({ body: {} }));
  set({ hasSecret: Boolean(body.hasSecret) });
  if (!looksLikeClientId(clientId || '')) return;
  if (body.signedIn) await refreshDrive(clientId);
}

async function driveUserName(token) {
  const res = await fetch('https://www.googleapis.com/drive/v3/about?fields=user(displayName)', {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (res.status === 403) throw new Error('api_disabled');
  if (!res.ok) throw new Error('drive_failed');
  const body = await res.json();
  return body.user?.displayName || '';
}

export async function disconnectDrive() {
  clearTimeout(refreshTimer);
  await api('POST', 'disconnect').catch(() => {});
  set({ status: 'idle', token: null, userName: '', message: '' });
}

/** A Google OAuth client ID looks like "1234-abc.apps.googleusercontent.com". */
export function looksLikeClientId(text) {
  return /^[\w-]+\.apps\.googleusercontent\.com$/.test(text.trim());
}
