// Google Drive connection (pilot). Uses Google's own sign-in window
// (Google Identity Services) and the limited "drive.file" permission:
// the planner can only see Drive files you pick, or files it made itself.
// The sign-in pass (access token) is kept in memory only, never saved.

const GIS_SRC = 'https://accounts.google.com/gsi/client';
export const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file';
/** The address to add to "Authorized JavaScript origins" in Google's setup. */
export const APP_ORIGIN = 'http://localhost:5178';

export const google = { status: 'idle', message: '', userName: '', token: null };

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
};

function problem(code) {
  return PROBLEMS[code] || `Something went wrong (${code}). Try again, or check the guide’s troubleshooting section.`;
}

/** Open Google's sign-in window, then check that Drive answers. `onChange` redraws the page. */
export async function connectDrive(clientId, onChange) {
  const set = (patch) => { Object.assign(google, patch); onChange(); };
  set({ status: 'working', message: 'Waiting for the Google window…' });
  try {
    await loadSignInScript();
    const token = await requestToken(clientId);
    const userName = await driveUserName(token);
    set({ status: 'connected', token, userName, message: '' });
  } catch (err) {
    set({ status: 'error', token: null, message: problem(err.message) });
  }
}

function requestToken(clientId) {
  return new Promise((resolve, reject) => {
    const client = window.google.accounts.oauth2.initTokenClient({
      client_id: clientId,
      scope: DRIVE_SCOPE,
      callback: (res) => (res.error ? reject(new Error(res.error)) : resolve(res.access_token)),
      error_callback: (err) => reject(new Error(err.type || 'unknown')),
    });
    client.requestAccessToken();
  });
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

export function disconnectDrive(onChange) {
  if (google.token) window.google?.accounts.oauth2.revoke(google.token, () => {});
  Object.assign(google, { status: 'idle', token: null, userName: '', message: '' });
  onChange();
}

/** A Google OAuth client ID looks like "1234-abc.apps.googleusercontent.com". */
export function looksLikeClientId(text) {
  return /^[\w-]+\.apps\.googleusercontent\.com$/.test(text.trim());
}
