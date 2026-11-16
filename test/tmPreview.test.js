// Looking at every template before adding it: several files at once (Slides, PowerPoint, Docs, Sheets) each get a
// picture and an "Open it" link to its Google editor; a change made there stays when the template is added;
// pictures Google is slow to give (busy, or a brand-new file) are asked for again instead of never showing.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSession } from '../public/js/templateMaker/session.js';
import { addTemplates } from '../public/js/templateMaker/addToPlan.js';
import { copyPace } from '../public/js/copyPace.js';
import { deckTexts, plannerState, teacherDrive } from './e2e/templateMaker/samples.js';

const wait = (ms) => new Promise((r) => { setTimeout(r, ms); });
const until = async (fn, ms = 1000) => {
  for (const end = Date.now() + ms; Date.now() < end; await wait(5)) if (fn()) return true;
  return fn();
};

async function visit() {
  const drive = teacherDrive();
  const m = new Map();
  const storage = { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, v), removeItem: (k) => m.delete(k) };
  const plan = { now: plannerState() };
  const api = { state: () => plan.now, yearId: () => 'yr_1', add: (made) => addTemplates(plan.now, made, { yearId: 'yr_1', now: '2026-11-16T10:00:00Z' }) };
  const session = createSession({ calls: drive.calls, pace: copyPace(), storage, plan: api, pictureRetries: [10, 10, 10] });
  await session.checkSetup();
  return { ...drive, session, plan };
}

const EDITORS = [/docs\.google\.com\/presentation\/d\/.+\/edit/, /docs\.google\.com\/presentation\/d\/.+\/edit/, /docs\.google\.com\/document\/d\/.+\/edit/, /docs\.google\.com\/spreadsheets\/d\/.+\/edit/];

test('several files at once: every template can be looked at (a picture) and opened to change before it is added', async () => {
  const { session, files } = await visit();
  await session.addFiles([files.slides, files.office, files.doc, files.spreadsheet]);
  await session.makeAll();
  const made = session.state.files;
  assert.deepEqual(made.map((f) => f.status), ['made', 'made', 'made', 'made']);
  assert.equal(session.state.phase, 'review', 'nothing is added yet');
  assert.ok(await until(() => made.every((f) => f.pictureState === 'ready')), `every one gets a picture: ${made.map((f) => f.pictureState)}`);
  made.forEach((f, i) => {
    assert.match(f.picture, /^data:image/, `${f.made.lesson.name} has a picture`);
    assert.match(f.made.link, EDITORS[i], `${f.made.lesson.name} opens in its Google editor`);
  });
});

test('a change made in Google while looking shows in the picture and stays when the template is added', async () => {
  const { g, session, files, plan } = await visit();
  await session.addFiles([files.slides, files.spreadsheet]);
  await session.makeAll();
  const [deck] = session.state.files;
  assert.ok(await until(() => deck.pictureState === 'ready'));
  const copy = g.get(deck.made.lesson.fileId);
  copy.content.slides[0].pageElements[0].shape.text.textElements[0].textRun.content = 'Rhythm Tree — my change\n';
  const before = deck.picture;
  deck.picture = null;
  session.refreshPictures(); // the teacher comes back to the planner tab
  assert.ok(await until(() => deck.picture && deck.pictureState === 'ready'));
  assert.equal(deck.picture, before, 'drawn again (the pretend Google draws the same picture)');
  await session.addKept();
  assert.equal(session.state.save.count, 2);
  assert.ok(deckTexts(g.get(deck.made.lesson.fileId).content).includes('Rhythm Tree — my change'), 'adding never undoes the teacher’s change');
  assert.ok(plan.now.lessons.some((l) => l.locations[0].fileId === deck.made.lesson.fileId));
});

test('when Google won’t draw slide pictures (too many at once), Drive’s own picture is used instead', async () => {
  const { g, session, files } = await visit();
  g.failNext('/thumbnail', { status: 429, times: 100 });
  await session.addFiles([files.slides, files.office]);
  await session.makeAll();
  const made = session.state.files;
  assert.ok(await until(() => made.every((f) => f.pictureState === 'ready'), 2000), `pictures: ${made.map((f) => f.pictureState)}`);
});

test('a picture Drive hasn’t made yet is asked for again, and “🔄” asks again by hand', async () => {
  const { g, session, files } = await visit();
  g.failNext('/thumbnail', { status: 429, times: 100 });
  await session.addFiles([files.slides]);
  await session.makeAll();
  const [deck] = session.state.files;
  const copy = g.get(deck.made.lesson.fileId);
  copy.noThumbnail = true;
  deck.picture = null;
  deck.pictureState = 'none';
  session.reloadPicture(deck.uid);
  assert.equal(deck.pictureState, 'loading');
  await wait(15);
  copy.noThumbnail = false; // Drive has made it now
  assert.ok(await until(() => deck.pictureState === 'ready', 2000), 'asked again until it came');
  copy.noThumbnail = true;
  deck.picture = null;
  session.reloadPicture(deck.uid);
  assert.ok(await until(() => deck.pictureState === 'none', 2000), 'gives up after a few tries, saying so');
});
