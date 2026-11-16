// The site's logo is a sunflower (nature), not a music note, so the planner suits any teacher.
// It shows in the top bar, the browser tab icon and the Privacy/Terms page headers.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const page = (name) => readFileSync(join(import.meta.dirname, '..', 'public', name), 'utf8');

for (const name of ['index.html', 'privacy.html', 'terms.html']) {
  test(`${name}: the logo and tab icon are a sunflower, with no music note`, () => {
    const html = page(name);
    assert.match(html, /<span class="brand-icon">🌻<\/span>/);
    assert.match(html, /rel="icon".*🌻/);
    assert.doesNotMatch(html, /🎵/);
  });
}

test('the Materials Schedule tab and its tutorial wear a pencil', () => {
  const tabs = page(join('js', 'tabInfo.js'));
  const tutorials = page(join('js', 'tutorials.js'));
  assert.match(tabs, /label: 'Materials Schedule', icon: '✏️'/);
  assert.match(tutorials, /icon: '✏️',\s*title: 'The Materials Schedule'/);
});
