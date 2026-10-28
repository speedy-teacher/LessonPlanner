// The "Google Drive" card (Setup › School Year), and the bottom-left reminder that
// appears when the one-hour Google pass runs out with no click to renew it.
// The Google codes are kept on this computer only (deviceSettings.js).

import { editable, h, toast } from '../dom.js';
import { refresh, setUi } from '../store.js';
import { apiKey, clientId, setDevice, setupLink } from '../deviceSettings.js';
import {
  appAddress, canSignIn, connectDrive, disconnectDrive, google, prepareDrive,
} from '../google.js';
import { dismissNotice, showNotice } from '../notices.js';

const SIGN_IN_NOTICE = 'google-sign-in';

export function googleCard() {
  const setCode = (key) => (value) => {
    setDevice({ [key]: value.trim() });
    if (key === 'googleClientId') prepareDrive(clientId());
    refresh();
  };
  return h('section', { class: 'card setup-card google-card' },
    h('h3', {}, 'Google Drive'),
    h('p', { class: 'hint' }, 'Paste the codes from your Google project (see the setup guide), then connect. They’re kept on this computer only.'),
    h('div', { class: 'google-origin' },
      h('span', {}, 'Your planner’s address for Google: '),
      h('code', {}, appAddress()),
      h('button', { class: 'btn small light', onclick: () => copyText(appAddress()) }, 'Copy')),
    h('label', { class: 'field' }, h('span', {}, 'Client ID'),
      editable(clientId(), setCode('googleClientId'), { placeholder: '…apps.googleusercontent.com', allowEmpty: true, spellcheck: 'false' })),
    h('label', { class: 'field' }, h('span', {}, 'API key (for picking files)'),
      editable(apiKey(), setCode('googleApiKey'), { placeholder: 'AIza…', allowEmpty: true, spellcheck: 'false' })),
    connectRow(),
    clientId() ? h('p', { class: 'hint' }, 'Using another computer? ',
      h('button', { class: 'btn small light', onclick: () => copyText(setupLink()), 'data-tip': 'Open this link on the other computer and the codes fill themselves in.' }, 'Copy a setup link')) : null,
  );
}

function connectRow() {
  if (google.status === 'connected') {
    return h('div', { class: 'google-status ok' },
      h('span', {}, `✓ Connected to Google Drive${google.userName ? ` as ${google.userName}` : ''}`),
      h('button', { class: 'btn small light', onclick: disconnectDrive }, 'Disconnect'));
  }
  const ready = canSignIn(clientId());
  return h('div', {},
    h('button', {
      class: 'btn', disabled: !ready || google.status === 'working',
      title: ready ? 'Opens Google’s sign-in window' : 'Paste the Client ID first',
      onclick: () => signIn(),
    }, google.status === 'working' ? 'Connecting…' : 'Connect Google Drive'),
    google.message ? h('p', { class: `google-status ${google.status === 'error' ? 'error' : ''}` }, google.message) : null);
}

function signIn() {
  dismissNotice(SIGN_IN_NOTICE);
  return connectDrive(clientId());
}

/** Bottom-left reminder with a button — when the Google pass ran out. */
export function showSignInNotice() {
  if (!canSignIn(clientId())) return;
  showNotice({
    id: SIGN_IN_NOTICE,
    tone: 'warn',
    title: 'Google Drive needs a click',
    message: 'Google asks the planner to check in every hour. Click anywhere (or here) to reconnect — your changes are safe on this computer meanwhile.',
    actions: [{ label: 'Reconnect', run: () => {} }],
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
  'needs-signin': { tone: 'warn', text: 'Drive: click to reconnect', tip: () => 'Click anywhere to reconnect Google Drive.' },
  error: { tone: 'warn', text: 'Drive: not connected', tip: () => google.message || 'Click to connect.' },
  idle: { tone: 'off', text: 'Drive: not connected', tip: () => 'Click to connect Google Drive.' },
};

/** Always-visible Drive status in the top bar (hidden until a Client ID is entered). */
export function drivePill() {
  if (!clientId()) return null;
  const pill = PILLS[google.status] || PILLS.idle;
  const offerSignIn = google.status !== 'connected' && google.status !== 'working' && canSignIn(clientId());
  return h('button', {
    class: `drive-pill ${pill.tone}`,
    'data-tip': pill.tip(),
    'aria-label': pill.tip(),
    onclick: () => (offerSignIn ? signIn() : setUi({ tab: 'setup' })),
  }, h('span', { class: 'drive-dot', 'aria-hidden': 'true' }), pill.text);
}
