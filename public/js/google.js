// Google Drive connection, entirely in the browser (no planner server needed).
// You sign in through Google's own window; Google hands the page a one-hour
// pass, kept in memory only. Before it runs out, your next click anywhere in
// the planner quietly gets a fresh one (Google's window may flash briefly).
// Browsers only allow Google's window to open right after a click, which is
// why reconnecting waits for one.
//
// Permissions: "drive.file" (change only files you pick or the planner made)
// plus "drive.readonly" (look inside your folders, to bring in and watch folders
// of decks, and to find plans shared with you — it never changes them).

import { device, setDevice } from './deviceSettings.js';

const GIS_SRC = 'https://accounts.google.com/gsi/client';
export const DRIVE_FILE_SCOPE = 'https://www.googleapis.com/auth/drive.file';
export const DRIVE_READ_SCOPE = 'https://www.googleapis.com/auth/drive.readonly';
export const DRIVE_SCOPE = `${DRIVE_FILE_SCOPE} ${DRIVE_READ_SCOPE}`;
const RENEW_EARLY_SECONDS = 600;

/** status: 'idle' | 'working' | 'connected' | 'needs-signin' | 'error' */
export const google = { status: 'idle', message: '', userName: '', token: null, scope: '' };

let handlers = { change: () => {}, needsSignIn: () => {} };
let tokenClient = null;
let clientIdInUse = '';
let renewTimer = null;
let expireTimer = null;

/** `change` redraws the page; `needsSignIn` is called when the pass runs out with no click to renew it. */
export function setGoogleHandlers(next) {
  handlers = { ...handlers, ...next };
}

function set(patch) {
  Object.assign(google, patch);
  handlers.change();
}

/** The address to add to "Authorized JavaScript origins" in Google's setup (where the planner is open now). */
export function appAddress() {
  return location.origin;
}

/** The Client ID is filled in (it's all the browser needs to sign in). */
export function canSignIn(clientId) {
  return looksLikeClientId(clientId || '');
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
  invalid_client: 'Google didn’t accept the Client ID. Check it was copied completely.',
  idpiframe_initialization_failed: 'Google doesn’t know this address yet. Add it to “Authorized JavaScript origins” (guide step 5).',
};

function problem(code) {
  return PROBLEMS[code] || `Something went wrong (${code}). Try again, or check the guide’s troubleshooting section.`;
}

/**
 * Get ready to sign in when the planner opens (loads Google's sign-in code). If you were
 * connected last time, your first click anywhere reconnects.
 */
export async function prepareDrive(clientId) {
  if (!canSignIn(clientId)) return;
  try {
    await clientFor(clientId);
  } catch (err) {
    set({ status: 'error', message: problem(err.message) });
    return;
  }
  if (device.driveConnected && google.status === 'idle') {
    set({ status: 'needs-signin', message: 'Click anywhere to reconnect Google Drive.' });
    renewOnNextClick();
  }
}

async function clientFor(clientId) {
  await loadSignInScript();
  if (tokenClient && clientIdInUse === clientId) return tokenClient;
  clientIdInUse = clientId;
  tokenClient = window.google.accounts.oauth2.initTokenClient({
    client_id: clientId,
    scope: DRIVE_SCOPE,
    include_granted_scopes: true,
    callback: (res) => (res.error ? failed(res.error) : useToken(res)),
    error_callback: (err) => failed(err.type || 'unknown'),
  });
  return tokenClient;
}

/** Open Google's sign-in window. Must follow a click. */
export async function connectDrive(clientId) {
  if (google.status === 'working') return;
  set({ status: 'working', message: 'Waiting for the Google window…' });
  try {
    // An empty prompt lets Google skip the questions once you've said yes before.
    (await clientFor(clientId)).requestAccessToken({ prompt: device.driveConnected ? '' : 'consent' });
  } catch (err) {
    failed(err.message);
  }
}

function failed(code) {
  const quiet = code === 'popup_closed' && google.token;
  set(quiet ? { status: 'connected', message: '' } : { status: 'error', message: problem(code) });
}

async function useToken({ access_token: token, expires_in: expiresIn, scope = '' }) {
  try {
    const userName = google.userName || await driveUserName(token);
    setDevice({ driveConnected: true });
    set({ status: 'connected', token, userName, message: '', scope });
    scheduleRenewal(Number(expiresIn) || 3600);
  } catch (err) {
    failed(err.message);
  }
}

function scheduleRenewal(seconds) {
  clearTimeout(renewTimer);
  clearTimeout(expireTimer);
  renewTimer = setTimeout(renewOnNextClick, Math.max(60, seconds - RENEW_EARLY_SECONDS) * 1000);
  expireTimer = setTimeout(expired, seconds * 1000);
}

function expired() {
  set({ status: 'needs-signin', token: null, message: 'Click anywhere to reconnect Google Drive.' });
  renewOnNextClick();
  handlers.needsSignIn();
}

let armed = false;
/** Your next click anywhere gets a fresh pass from Google. */
function renewOnNextClick() {
  if (armed) return;
  armed = true;
  document.addEventListener('click', () => {
    armed = false;
    if (google.status !== 'working') connectDrive(clientIdInUse);
  }, { capture: true, once: true });
}

async function driveUserName(token) {
  let res;
  try {
    res = await fetch('https://www.googleapis.com/drive/v3/about?fields=user(displayName)', {
      headers: { Authorization: `Bearer ${token}` },
    });
  } catch {
    throw new Error('offline');
  }
  if (res.status === 403) throw new Error('api_disabled');
  if (!res.ok) throw new Error('drive_failed');
  const body = await res.json();
  return body.user?.displayName || '';
}

export function disconnectDrive() {
  clearTimeout(renewTimer);
  clearTimeout(expireTimer);
  if (google.token) window.google?.accounts?.oauth2?.revoke(google.token, () => {});
  setDevice({ driveConnected: false });
  set({ status: 'idle', token: null, userName: '', message: '', scope: '' });
}

/** The sign-in allows looking inside folders (older sign-ins only had drive.file). */
export function canReadFolders(scope = google.scope) {
  return scope.split(/\s+/).includes(DRIVE_READ_SCOPE);
}

/**
 * What's wrong with the Google codes built into the website (empty list = fine).
 * Shown as an error, so whoever publishes the site knows to fix them.
 */
export function configProblems({ googleClientId = '', googleApiKey = '' } = {}) {
  const problems = [];
  if (!googleClientId.trim()) problems.push('The Client ID is missing (GitHub secret GOOGLE_CLIENT_ID).');
  else if (!looksLikeClientId(googleClientId)) problems.push('The Client ID doesn’t look right — it should end in “.apps.googleusercontent.com” (GitHub secret GOOGLE_CLIENT_ID).');
  if (!googleApiKey.trim()) problems.push('The API key is missing (GitHub secret GOOGLE_API_KEY).');
  else if (!/^AIza[\w-]{30,}$/.test(googleApiKey.trim())) problems.push('The API key doesn’t look right — it should start with “AIza” (GitHub secret GOOGLE_API_KEY).');
  return problems;
}

/** A Google OAuth client ID looks like "1234-abc.apps.googleusercontent.com". */
export function looksLikeClientId(text) {
  return /^[\w-]+\.apps\.googleusercontent\.com$/.test(text.trim());
}
