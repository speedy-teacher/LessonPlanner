// Which people each tab lists and what a choice shows (lensRules.js): the rules, without any browser.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LENS, peopleFrom, sameView, wantedView } from '../public/js/lensRules.js';

const pat = { fileId: 'sched-pat', name: 'Pat', ownerId: 'u1' };
const sam = { fileId: 'res-sam', name: 'Sam', ownerId: 'u2' };

test('each tab has its lens; other tabs have none', () => {
  assert.deepEqual(['lessonSchedule', 'reports', 'outcomes'].map((p) => LENS[p]), ['schedule', 'schedule', 'schedule']);
  assert.deepEqual(['lessons', 'images'].map((p) => LENS[p]), ['resources', 'resources']);
  for (const page of ['plan', 'schedule', 'setup']) assert.deepEqual(wantedView(page, { [page]: pat }), { lens: null, schedule: null, resources: null });
});

test('a schedule tab shows their schedule and the templates it links to; a templates tab keeps my schedule', () => {
  assert.deepEqual(wantedView('lessonSchedule', { lessonSchedule: pat }), { lens: 'schedule', schedule: pat, resources: 'linked' });
  assert.deepEqual(wantedView('images', { images: sam }), { lens: 'resources', schedule: null, resources: sam });
  assert.deepEqual(wantedView('images', {}), { lens: 'resources', schedule: null, resources: null });
});

test('a choice on one tab does not leak onto another', () => {
  const picks = { lessonSchedule: pat };
  assert.equal(wantedView('reports', picks).schedule, null);
  assert.equal(wantedView('lessons', picks).resources, null);
  assert.equal(wantedView('lessonSchedule', picks).schedule, pat);
});

test('changing tabs swaps pieces only when what is shown differs', () => {
  const picks = { lessonSchedule: pat, reports: pat, lessons: sam };
  assert.ok(sameView(wantedView('lessonSchedule', picks), wantedView('reports', picks)));
  assert.ok(sameView(wantedView('plan', picks), wantedView('images', {})));
  assert.ok(!sameView(wantedView('lessonSchedule', picks), wantedView('lessons', picks)));
  assert.ok(!sameView(wantedView('lessons', picks), wantedView('images', {})));
  assert.ok(sameView(wantedView('lessons', picks), wantedView('images', { images: { ...sam } })));
});

test('people: one row per owner (newest file), never my own file or files I own, by name', () => {
  const files = [
    { fileId: 'a1', name: 'Resources', owner: 'Zed', ownerId: 'z', ownedByMe: false, modifiedTime: '2026-10-01' },
    { fileId: 'a2', name: 'Resources', owner: 'Zed', ownerId: 'z', ownedByMe: false, modifiedTime: '2026-10-20' },
    { fileId: 'b1', name: 'Resources', owner: 'Amy', ownerId: 'a', ownedByMe: false, modifiedTime: '2026-09-01' },
    { fileId: 'mine', name: 'Resources', owner: 'Me', ownerId: 'm', ownedByMe: false },
    { fileId: 'mine2', name: 'Older resources', owner: 'Me', ownerId: 'm', ownedByMe: true },
    { fileId: 'c1', name: 'Unnamed owner file', owner: '', ownerId: 'c', ownedByMe: false },
  ];
  assert.deepEqual(peopleFrom(files, { mineFileId: 'mine' }), [
    { fileId: 'b1', name: 'Amy', ownerId: 'a' },
    { fileId: 'c1', name: 'Unnamed owner file', ownerId: 'c' },
    { fileId: 'a2', name: 'Zed', ownerId: 'z' },
  ]);
});
