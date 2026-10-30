// Behavior tests: an assistant that only sees the web page (no extension) can find out how to
// drive the planner, and a planner open in another browser picks up the assistant's changes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(`../public/${path}`, import.meta.url), 'utf8');

test('the page itself tells an assistant how to use the planner', () => {
  const page = read('index.html');
  for (const call of ['lessonPlanner.status()', 'lessonPlanner.help()', 'lessonPlanner.run(']) {
    assert.ok(page.includes(call), `index.html mentions ${call}`);
  }
  assert.match(page, /class="sr-only" id="assistant-note"/, 'the note is hidden from the teacher but readable');
});

test('the planner offers status, help and run to an assistant', () => {
  assert.match(read('js/agentBridge.js'), /window\.lessonPlanner = Object\.freeze\(\{ status, help, run/);
});

test('an open planner checks Google Drive for changes made elsewhere', () => {
  const app = read('js/app.js');
  assert.match(app, /visibilitychange[^\n]*syncNow/);
  assert.match(app, /setInterval\([^\n]*syncNow/);
});
