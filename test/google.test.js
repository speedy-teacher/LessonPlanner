// Google Drive pilot: settings are kept, and the Client ID check is friendly.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalize, emptyState } from '../public/js/model.js';
import { looksLikeClientId, APP_ORIGIN, DRIVE_SCOPE, canReadFolders } from '../public/js/google.js';

test('Google settings start empty and survive saving and loading', () => {
  assert.deepEqual(emptyState().settings, { googleClientId: '', googleApiKey: '' });
  const saved = { ...emptyState(), settings: { googleClientId: 'fake-123.apps.googleusercontent.com' } };
  const loaded = normalize(JSON.parse(JSON.stringify(saved)));
  assert.equal(loaded.settings.googleClientId, 'fake-123.apps.googleusercontent.com');
  assert.equal(loaded.settings.googleApiKey, '');
  assert.deepEqual(normalize({ schemaVersion: 1, years: [] }).settings, { googleClientId: '', googleApiKey: '' });
});

test('the Connect button only accepts something shaped like a Google Client ID', () => {
  assert.ok(looksLikeClientId('fake-123abc.apps.googleusercontent.com'));
  assert.ok(looksLikeClientId('  fake-123abc.apps.googleusercontent.com \n'));
  assert.ok(!looksLikeClientId(''));
  assert.ok(!looksLikeClientId('AIzaFakeApiKey'));
  assert.ok(!looksLikeClientId('fake.apps.googleusercontent.com.evil.example'));
});

test('the planner asks Google to change only files you pick or it made, and to read folders, at its own address', () => {
  assert.equal(DRIVE_SCOPE, 'https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/drive.readonly');
  assert.ok(!DRIVE_SCOPE.split(' ').includes('https://www.googleapis.com/auth/drive'), 'never full Drive access');
  assert.equal(APP_ORIGIN, 'http://localhost:5178');
});

test('an older sign-in without folder reading is noticed, so you can be asked to sign in again', () => {
  assert.ok(!canReadFolders('https://www.googleapis.com/auth/drive.file'));
  assert.ok(!canReadFolders(''));
  assert.ok(canReadFolders('https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/drive.readonly'));
});
