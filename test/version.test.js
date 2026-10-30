// The footer shows the site's semantic version, and it matches package.json.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { VERSION } from '../public/js/version.js';

test('the version is MAJOR.MINOR.PATCH and matches package.json', () => {
  assert.match(VERSION, /^\d+\.\d+\.\d+$/);
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  assert.equal(VERSION, pkg.version);
});

test('the page footer has a spot for the version next to the legal links', () => {
  const html = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
  assert.match(html, /<footer class="app-footer"><span id="app-version"><\/span> · <a href="privacy\.html">/);
});
