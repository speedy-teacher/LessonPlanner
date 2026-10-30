// Lesson previews: only asked for when their card comes into view, a few at a time, and
// each arriving picture is announced on its own (so the page never redraws hundreds of times).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { google } from '../public/js/google.js';
import { driveLocation } from '../public/js/locations.js';
import { deckThumbnail, onThumbnail, requestThumbnail } from '../public/js/thumbnails.js';

const deck = (i) => ({ id: `les${i}`, name: `Pretend deck ${i}`, locations: [{ kind: 'drive', uri: `https://drive.google.com/open?id=deck${i}`, fileId: `deck${i}` }] });

test('previews load only when asked for, at most 4 at once, and each one is announced once', async () => {
  Object.assign(google, { status: 'connected', token: 'pretend' });
  let asking = 0;
  let mostAtOnce = 0;
  let asked = 0;
  globalThis.fetch = async (url) => {
    asked += 1;
    asking += 1;
    mostAtOnce = Math.max(mostAtOnce, asking);
    await new Promise((resolve) => setTimeout(resolve, 5));
    asking -= 1;
    const id = new URL(url).pathname.split('/').pop();
    return new Response(JSON.stringify({ hasThumbnail: true, thumbnailLink: `https://pictures.example/${id}=s220` }));
  };
  const announced = [];
  onThumbnail((fileId) => announced.push(fileId));

  const decks = Array.from({ length: 30 }, (_, i) => deck(i));
  assert.deepEqual(decks.map((d) => deckThumbnail(d).status), decks.map(() => 'waiting'));
  assert.equal(asked, 0, 'nothing is asked for until a card is in view');

  decks.slice(0, 10).forEach(requestThumbnail);
  decks.slice(0, 10).forEach(requestThumbnail); // asking twice doesn't load twice
  await new Promise((resolve) => setTimeout(resolve, 200));
  assert.equal(asked, 10);
  assert.ok(mostAtOnce <= 4, `at most 4 at once (was ${mostAtOnce})`);
  assert.deepEqual([...announced].sort(), decks.slice(0, 10).map((d) => d.locations[0].fileId).sort());
  assert.equal(deckThumbnail(decks[0]).url, 'https://pictures.example/deck0=s640');
  assert.equal(deckThumbnail(decks[20]).status, 'waiting');
});

test('decks not in Drive, or Drive not connected, say why there is no preview', () => {
  assert.match(deckThumbnail({ id: 'x', locations: [] }).reason, /only shown for decks in Google Drive/);
  Object.assign(google, { status: 'idle', token: null });
  assert.match(deckThumbnail(deck(99)).reason, /Connect Google Drive/);
});

test('a lesson standing in for its filled-in copy gets the copy’s own picture, not the template’s', async () => {
  Object.assign(google, { status: 'connected', token: 'pretend' });
  globalThis.fetch = async (url) => {
    const id = new URL(url).pathname.split('/').pop();
    return new Response(JSON.stringify({ hasThumbnail: true, thumbnailLink: `https://pictures.example/${id}=s220` }));
  };
  const template = deck(500);
  const copy = { ...template, locations: [driveLocation({ fileId: 'copy500' })] };
  requestThumbnail(template);
  requestThumbnail(copy);
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(deckThumbnail(template).url, 'https://pictures.example/deck500=s640');
  assert.equal(deckThumbnail(copy).url, 'https://pictures.example/copy500=s640');
});
