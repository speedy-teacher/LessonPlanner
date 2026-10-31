import test from 'node:test';
import assert from 'node:assert/strict';
import { emptyState, createYear, add } from '../public/js/model.js';
import { driveLocation } from '../public/js/locations.js';
import { scanSlides, scansNeeded, scanTemplates } from '../public/js/templateScan.js';

const SLIDES = 'application/vnd.google-apps.presentation';
const withSpot = { slides: [{ objectId: 's1', pageElements: [{ objectId: 'a', title: 'IMAGE_ANCHOR', size: {}, transform: {} }] }] };
const without = { slides: [{ objectId: 's1', pageElements: [{ objectId: 'b', title: 'Title' }] }] };

function setup() {
  const s = emptyState();
  const year = createYear(s, { name: 'Year A', startDate: '2026-08-26', endDate: '2027-06-10' });
  const deck = (name, fileId, mimeType = SLIDES) => add(s, 'lessons', {
    yearId: year.id, name, category: '', autoFields: [], instrumentIds: [],
    locations: [driveLocation({ fileId, mimeType, modifiedTime: 't1' })],
  });
  return { s, year, spot: deck('Spot', 'f-spot'), plain: deck('Plain', 'f-plain'), pdf: deck('Sheet', 'f-pdf', 'application/pdf') };
}

const fakeGoogle = (files) => async (url) => {
  const id = decodeURIComponent(url.match(/presentations\/([^?]+)/)[1]);
  return files[id] ? { ok: true, json: async () => files[id] } : { ok: false, status: 404 };
};
const apply = (s) => (mutate) => mutate(s);

test('a template with an IMAGE_ANCHOR shape is found to have a picture spot', () => {
  assert.equal(scanSlides(withSpot).picture, true);
  assert.equal(scanSlides(without).picture, false);
});

test('Google Slides templates are read once, and again only after the file changes', async () => {
  const { s, year, spot, plain } = setup();
  const fetchFn = fakeGoogle({ 'f-spot': withSpot, 'f-plain': without });
  assert.deepEqual(scansNeeded(s, year.id).map((n) => n.lesson.name), ['Spot', 'Plain'], 'PDFs are never read');
  assert.equal(await scanTemplates({ state: s, yearId: year.id, token: 't', annotate: apply(s), fetchFn }), true);
  assert.equal(spot.scan.picture, true);
  assert.equal(plain.scan.picture, false);
  assert.equal(scansNeeded(s, year.id).length, 0);
  spot.locations[0].modifiedTime = 't2';
  assert.deepEqual(scansNeeded(s, year.id).map((n) => n.lesson.name), ['Spot']);
});

test('a template that can’t be read is left alone', async () => {
  const { s, year, spot } = setup();
  await scanTemplates({ state: s, yearId: year.id, token: 't', annotate: apply(s), fetchFn: fakeGoogle({}) });
  assert.equal(spot.scan, undefined);
});
