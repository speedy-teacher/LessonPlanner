// Connecting to Google Drive never gets stuck on "Waiting for the Google window…".
import { test, mock } from 'node:test';
import assert from 'node:assert/strict';

// Just enough of a browser page and of Google's sign-in code for google.js.
const page = new EventTarget();
let answer = () => {};
page.google = {
  accounts: {
    oauth2: {
      initTokenClient: (config) => ({ requestAccessToken: () => answer(config) }),
    },
  },
};
globalThis.window = page;
globalThis.document = {
  createElement: () => ({}),
  head: { append: (script) => script.onload() },
  addEventListener: () => {},
};
globalThis.fetch = async () => new Response(JSON.stringify({ user: { displayName: 'Pretend Teacher' } }));

const { connectDrive, google } = await import('../public/js/google.js');
const CLIENT_ID = 'fake-123abc.apps.googleusercontent.com';

test('if Google’s window closes without answering, the planner stops waiting and says so', async () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    answer = () => {}; // the window flashes and closes; Google never calls back
    await connectDrive(CLIENT_ID);
    assert.equal(google.status, 'working');
    page.dispatchEvent(new Event('focus')); // back in the planner
    mock.timers.tick(5000);
    assert.equal(google.status, 'error');
    assert.match(google.message, /closed without finishing/);
  } finally {
    mock.timers.reset();
  }
});

test('even without coming back to the planner, it stops waiting after a while', async () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    answer = () => {};
    await connectDrive(CLIENT_ID);
    mock.timers.tick(30 * 1000);
    assert.equal(google.status, 'working', 'still time to finish in Google’s window');
    mock.timers.tick(20 * 1000);
    assert.equal(google.status, 'error');
  } finally {
    mock.timers.reset();
  }
});

test('when Google answers, the planner connects (and a late time limit changes nothing)', async () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    answer = (config) => config.callback({ access_token: 'pretend-token', expires_in: 3600, scope: '' });
    await connectDrive(CLIENT_ID);
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(google.status, 'connected');
    assert.equal(google.userName, 'Pretend Teacher');
    page.dispatchEvent(new Event('focus'));
    mock.timers.tick(60 * 1000);
    assert.equal(google.status, 'connected');
  } finally {
    mock.timers.reset();
  }
});
