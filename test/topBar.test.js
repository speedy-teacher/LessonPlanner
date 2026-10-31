// The top bar on thin windows: its pieces move to a second row instead of being squashed,
// so the Drive pill stays one round capsule (its words on one line, its dot a circle).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const css = readFileSync(join(import.meta.dirname, '..', 'public', 'css', 'app.css'), 'utf8');

/** The declarations of the first rule whose selector is exactly `selector`. */
function rule(selector) {
  const at = css.indexOf(`\n${selector} {`);
  assert.ok(at >= 0, `${selector} has a rule`);
  return css.slice(at, css.indexOf('}', at));
}

test('the top bar wraps onto a second row rather than squashing its pieces', () => {
  assert.match(rule('.topbar'), /flex-wrap: wrap/);
});

test('the Drive pill never wraps or shrinks, and its dot stays round', () => {
  assert.match(rule('.drive-pill'), /white-space: nowrap/);
  assert.match(rule('.drive-pill'), /flex: none/);
  assert.match(rule('.drive-dot'), /flex: none/);
});

test('a long plan name is cut short with … instead of squashing the bar', () => {
  assert.match(rule('.plan-name'), /text-overflow: ellipsis/);
  assert.match(rule('.plan-button'), /white-space: nowrap/);
});
