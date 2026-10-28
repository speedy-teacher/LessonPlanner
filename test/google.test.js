// Google Drive pilot: settings are kept, and the Client ID check is friendly.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalize, emptyState } from '../public/js/model.js';
import { looksLikeClientId, DRIVE_SCOPE, canReadFolders } from '../public/js/google.js';
import { deviceSettingsIn, toWorkspaceFile } from '../public/js/workspaceFile.js';

test('the Google codes stay on each computer and are never written into a plan file', () => {
  assert.deepEqual(emptyState().settings, {});
  const old = { ...emptyState(), settings: { googleClientId: 'fake-123.apps.googleusercontent.com', googleApiKey: 'AIzaFake' } };
  assert.deepEqual(deviceSettingsIn(normalize(old)), { googleClientId: 'fake-123.apps.googleusercontent.com', googleApiKey: 'AIzaFake' });
  const file = toWorkspaceFile(normalize(old));
  assert.doesNotMatch(file, /fake-123|AIzaFake/);
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
