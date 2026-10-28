// The "Google Drive" card (Setup › School Year), and the bottom-left reminder that
// appears when the one-hour Google pass runs out with no click to renew it.
// The Google codes are built into the website (deviceSettings.js), so this is just connect/disconnect.

import { h } from '../dom.js';
import { setUi } from '../store.js';
import { canSignIn, configProblems, connectDrive, disconnectDrive, google } from '../google.js';
import { clientId, driveAvailable, googleConfig } from '../deviceSettings.js';
import { dismissNotice, showNotice } from '../notices.js';

const SIGN_IN_NOTICE = 'google-sign-in';

export function googleCard() {
  return h('section', { class: 'card setup-card google-card' },
    h('h3', {}, 'Google Drive'),
    h('p', { class: 'hint' }, 'Your plans are saved in a “Lesson Planner” folder in your Google Drive, and lesson decks can come from Drive.'),
    setupProblems(),
    driveAvailable() ? connectRow() : null);
}

function setupProblems() {
  const problems = configProblems(googleConfig());
  if (!problems.length) return null;
  return h('div', { class: 'google-status error' },
    h('strong', {}, 'The Google app info for this website needs fixing:'),
    h('ul', {}, problems.map((p) => h('li', {}, p))),
    h('span', {}, 'Fix it in the GitHub repository’s secrets, then publish again (see docs/hosting.md).'));
}

/** When the planner opens: a lasting error if the Google codes built into the website are missing or wrong. */
export function warnIfGoogleNotSetUp() {
  const problems = configProblems(googleConfig());
  if (!problems.length) return;
  showNotice({
    id: 'google-config', tone: 'error', title: 'Google Drive isn’t set up for this website',
    message: `${problems.join(' ')} Fix it in the GitHub repository’s secrets, then publish again (docs/hosting.md).`,
    actions: [{ label: 'Details', run: () => setUi({ tab: 'setup' }) }],
    seconds: null,
  });
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
      title: 'Opens Google’s sign-in window',
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

// ---------- top bar status pill ----------

const PILLS = {
  connected: { tone: 'ok', text: 'Drive connected', tip: () => `Connected to Google Drive${google.userName ? ` as ${google.userName}` : ''}. Click for settings.` },
  working: { tone: 'busy', text: 'Drive connecting…', tip: () => 'Connecting to Google Drive…' },
  'needs-signin': { tone: 'warn', text: 'Drive: click to reconnect', tip: () => 'Click anywhere to reconnect Google Drive.' },
  error: { tone: 'warn', text: 'Drive: not connected', tip: () => google.message || 'Click to connect.' },
  idle: { tone: 'off', text: 'Drive: not connected', tip: () => 'Click to connect Google Drive.' },
  'not-set-up': { tone: 'warn', text: 'Drive: not set up', tip: () => configProblems(googleConfig()).join(' ') },
};

/** Always-visible Drive status in the top bar (hidden until a Client ID is entered). */
export function drivePill() {
  const pill = configProblems(googleConfig()).length ? PILLS['not-set-up'] : PILLS[google.status] || PILLS.idle;
  const offerSignIn = google.status !== 'connected' && google.status !== 'working' && canSignIn(clientId());
  return h('button', {
    class: `drive-pill ${pill.tone}`,
    'data-tip': pill.tip(),
    'aria-label': pill.tip(),
    onclick: () => (offerSignIn ? signIn() : setUi({ tab: 'setup' })),
  }, h('span', { class: 'drive-dot', 'aria-hidden': 'true' }), pill.text);
}
