// Google Drive pilot: settings are kept, and the Client ID check is friendly.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalize, emptyState } from '../public/js/model.js';
import { looksLikeClientId, DRIVE_SCOPE, canReadFolders, configProblems } from '../public/js/google.js';
import { toWorkspaceFile } from '../public/js/workspaceFile.js';
import { configScript } from '../scripts/write-config.js';

test('the Google codes are built into the website, and never written into a plan file', () => {
  assert.deepEqual(emptyState().settings, {});
  // Older planner files kept the codes inside them; plan files leave them out.
  const old = { ...emptyState(), settings: { googleClientId: 'fake-123.apps.googleusercontent.com', googleApiKey: 'AIzaFake' } };
  assert.doesNotMatch(toWorkspaceFile(normalize(old)), /fake-123|AIzaFake/);
  // The website gets them from config.js, made when it's published.
  const script = configScript({ googleClientId: ' fake-123.apps.googleusercontent.com  ', googleApiKey: 'AIzaFake' });
  const sandbox = {};
  new Function('window', script)(sandbox);
  assert.deepEqual(sandbox.PLANNER_CONFIG, { googleClientId: 'fake-123.apps.googleusercontent.com', googleApiKey: 'AIzaFake' });
  assert.deepEqual(new Function('window', `${configScript({})}; return window.PLANNER_CONFIG;`)({}), { googleClientId: '', googleApiKey: '' });
});

test('the Connect button only accepts something shaped like a Google Client ID', () => {
  assert.ok(looksLikeClientId('fake-123abc.apps.googleusercontent.com'));
  assert.ok(looksLikeClientId('  fake-123abc.apps.googleusercontent.com \n'));
  assert.ok(!looksLikeClientId(''));
  assert.ok(!looksLikeClientId('AIzaFakeApiKey'));
  assert.ok(!looksLikeClientId('fake.apps.googleusercontent.com.evil.example'));
});

test('the planner asks Google to change only files you pick or it made, and to read folders', () => {
  assert.equal(DRIVE_SCOPE, 'https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/drive.readonly');
  assert.ok(!DRIVE_SCOPE.split(' ').includes('https://www.googleapis.com/auth/drive'), 'never full Drive access');
});

test('an older sign-in without folder reading is noticed, so you can be asked to sign in again', () => {
  assert.ok(!canReadFolders('https://www.googleapis.com/auth/drive.file'));
  assert.ok(!canReadFolders(''));
  assert.ok(canReadFolders('https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/drive.readonly'));
});

test('missing or wrong Google app info is reported, so whoever publishes the site knows to fix it', () => {
  const good = { googleClientId: 'fake-123abc.apps.googleusercontent.com', googleApiKey: 'AIzaFakeFakeFakeFakeFakeFakeFakeFake123' };
  assert.deepEqual(configProblems(good), []);
  assert.equal(configProblems({}).length, 2);
  assert.match(configProblems({ ...good, googleClientId: '' })[0], /Client ID is missing.*GOOGLE_CLIENT_ID/);
  assert.match(configProblems({ ...good, googleClientId: 'GOCSPX-oops' })[0], /Client ID doesn’t look right/);
  assert.match(configProblems({ ...good, googleApiKey: '' })[0], /API key is missing.*GOOGLE_API_KEY/);
  assert.match(configProblems({ ...good, googleApiKey: 'not-a-key' })[0], /API key doesn’t look right/);
});
