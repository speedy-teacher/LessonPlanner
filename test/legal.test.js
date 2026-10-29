// The privacy policy and terms of use are plain pages anyone can open (no sign-in, no program code),
// linked from the planner, and they say how data is really handled and that there is no liability.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../server.js';

async function withServer(fn) {
  const server = createApp({ dataDir: await mkdtemp(join(tmpdir(), 'planner-')) });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try { return await fn(base); } finally { server.close(); }
}

async function page(base, path) {
  const res = await fetch(`${base}/${path}`);
  assert.equal(res.status, 200, `${path} opens`);
  return res.text();
}

function assertStandalone(html, path) {
  assert.doesNotMatch(html, /<script/i, `${path} needs no program code or sign-in`);
  assert.doesNotMatch(html, /(src|href)="\/[^/]/, `${path} works from a web host’s sub-folder`);
}

test('the privacy policy opens without signing in and explains where data really goes', async () => {
  await withServer(async (base) => {
    const html = await page(base, 'privacy.html');
    assertStandalone(html, 'privacy.html');
    assert.match(html, /<h1>Privacy Policy<\/h1>/);
    assert.match(html, /Last updated:/);
    for (const fact of [/no servers?/i, /GitHub Pages/, /Google Drive/, /drive\.file/, /drive\.readonly/,
      /IndexedDB/, /Limited Use/, /never sold/i, /student/i, /terms\.html/]) {
      assert.match(html, fact);
    }
  });
});

test('the terms of use open without signing in and disclaim warranty and liability', async () => {
  await withServer(async (base) => {
    const html = await page(base, 'terms.html');
    assertStandalone(html, 'terms.html');
    assert.match(html, /<h1>Terms of Use<\/h1>/);
    for (const fact of [/"as is"/i, /without warranty/i, /will not be liable/i, /US \$0/, /indemnify/i,
      /backups/i, /privacy\.html/]) {
      assert.match(html, fact);
    }
  });
});

test('the planner links to the privacy policy and terms of use', async () => {
  await withServer(async (base) => {
    const html = await page(base, '');
    assert.match(html, /href="privacy\.html"/);
    assert.match(html, /href="terms\.html"/);
  });
});
