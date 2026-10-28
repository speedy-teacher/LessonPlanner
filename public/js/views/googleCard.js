// The "Google Drive" card (Setup › School Year), and the bottom-left reminder that
// appears when Google ends your sign-in (about once a week in testing mode).

import { editable, h, toast } from '../dom.js';
import { commit, setUi, store } from '../store.js';
import {
  APP_ORIGIN, canSignIn, connectDrive, disconnectDrive, google, saveClientSecret,
} from '../google.js';
import { dismissNotice, showNotice } from '../notices.js';

const SIGN_IN_NOTICE = 'google-sign-in';

export function googleCard() {
  const { googleClientId, googleApiKey } = store.state.settings;
  const setSetting = (key) => (value) => commit((s) => { s.settings[key] = value; });
  return h('section', { class: 'card setup-card google-card' },
    h('h3', {}, 'Google Drive'),
    h('p', { class: 'hint' }, 'Paste the codes from your Google project (see the setup guide), then connect. You stay signed in.'),
    h('div', { class: 'google-origin' },
      h('span', {}, 'Your planner’s address for Google: '),
      h('code', {}, APP_ORIGIN),
      h('button', { class: 'btn small light', onclick: () => copyText(APP_ORIGIN) }, 'Copy')),
    h('label', { class: 'field' }, h('span', {}, 'Client ID'),
      editable(googleClientId, setSetting('googleClientId'), { placeholder: '…apps.googleusercontent.com', allowEmpty: true, spellcheck: 'false' })),
    secretField(),
    h('label', { class: 'field' }, h('span', {}, 'API key (for picking files later)'),
      editable(googleApiKey, setSetting('googleApiKey'), { placeholder: 'AIza…', allowEmpty: true, spellcheck: 'false' })),
    connectRow(googleClientId),
  );
}

/** The secret is sent to this computer's server and never shown again. */
function secretField() {
  return h('label', { class: 'field' },
    h('span', {}, 'Client secret ', google.hasSecret ? h('span', { class: 'saved-tag' }, '✓ saved on this computer') : null),
    h('input', {
      class: 'inline-edit', type: 'password', autocomplete: 'off', spellcheck: 'false',
      placeholder: google.hasSecret ? 'Paste a new one to replace it' : 'GOCSPX-…',
      onchange: (e) => {
        const value = e.target.value.trim();
        if (value) saveClientSecret(value).then(() => toast('Client secret saved on this computer.'));
      },
    }));
}

function connectRow(clientId) {
  if (location.origin !== APP_ORIGIN) {
    return h('p', { class: 'google-status error' }, 'Google only works when the planner is opened at ', h('a', { href: APP_ORIGIN }, APP_ORIGIN), '.');
  }
  if (google.status === 'connected') {
    return h('div', { class: 'google-status ok' },
      h('span', {}, `✓ Connected to Google Drive${google.userName ? ` as ${google.userName}` : ''}`),
      h('button', { class: 'btn small light', onclick: disconnectDrive }, 'Disconnect'));
  }
  const ready = canSignIn(clientId);
  const again = google.status === 'needs-signin';
  return h('div', {},
    h('button', {
      class: 'btn', disabled: !ready || google.status === 'working',
      title: ready ? 'Opens Google’s sign-in window' : 'Paste the Client ID and client secret first',
      onclick: () => signIn(),
    }, buttonLabel(again)),
    google.message ? h('p', { class: `google-status ${google.status === 'error' ? 'error' : ''}` }, google.message) : null);
}

function buttonLabel(again) {
  if (google.status === 'working') return 'Connecting…';
  return again ? 'Sign in to Google again' : 'Connect Google Drive';
}

function signIn() {
  dismissNotice(SIGN_IN_NOTICE);
  return connectDrive(store.state.settings.googleClientId.trim());
}

/** Bottom-left reminder with a Sign in button — only when both codes are filled in. */
export function showSignInNotice() {
  if (!canSignIn(store.state.settings.googleClientId)) return;
  showNotice({
    id: SIGN_IN_NOTICE,
    tone: 'warn',
    title: 'Google Drive signed you out',
    message: 'This happens about once a week. Sign in again to keep using Drive.',
    actions: [{ label: 'Sign in', run: signIn }],
    seconds: 20,
  });
}

function copyText(text) {
  navigator.clipboard?.writeText(text).then(() => toast('Copied!'), () => toast(`Copy this: ${text}`));
}

// ---------- top bar status pill ----------

const PILLS = {
  connected: { tone: 'ok', text: 'Drive connected', tip: () => `Connected to Google Drive${google.userName ? ` as ${google.userName}` : ''}. Click for settings.` },
  working: { tone: 'busy', text: 'Drive connecting…', tip: () => 'Connecting to Google Drive…' },
  'needs-signin': { tone: 'warn', text: 'Drive: sign in', tip: () => 'Google signed you out. Click to sign in again.' },
  error: { tone: 'warn', text: 'Drive: not connected', tip: () => google.message || 'Click to connect.' },
  idle: { tone: 'off', text: 'Drive: not connected', tip: () => 'Click to connect Google Drive.' },
};

/** Always-visible Drive status in the top bar (hidden until a Client ID is entered). */
export function drivePill() {
  const clientId = store.state.settings.googleClientId;
  if (!clientId) return null;
  const pill = PILLS[google.status] || PILLS.idle;
  const offerSignIn = google.status !== 'connected' && google.status !== 'working' && canSignIn(clientId);
  return h('button', {
    class: `drive-pill ${pill.tone}`,
    'data-tip': pill.tip(),
    'aria-label': pill.tip(),
    onclick: () => (offerSignIn ? signIn() : setUi({ tab: 'setup' })),
  }, h('span', { class: 'drive-dot', 'aria-hidden': 'true' }), pill.text);
}
