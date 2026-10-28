// The code-quality check itself works: long functions are only allowed when simple.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkFunctionLength } from '../scripts/quality.js';

test('a long but simple function passes the length check', async () => {
  const violations = await checkFunctionLength(['test/fixtures/long-simple.js'], { ignore: false });
  assert.deepEqual(violations, []);
});

test('a long and complex function fails the length check', async () => {
  const violations = await checkFunctionLength(['test/fixtures/long-complex.js'], { ignore: false });
  assert.equal(violations.length, 1);
  assert.ok(violations[0].cognitive > 5);
});

test('the project itself passes the length check', async () => {
  assert.deepEqual(await checkFunctionLength(['.']), []);
});
