// Lesson copies: a picture that couldn't be placed is held for a while, then tried again by itself
// (on the regular recheck or a renewed sign-in) — no page reload needed — and what went wrong stays
// visible until a copy gets the picture.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { add, createYear, emptyState } from '../public/js/model.js';
import { addWeekLesson, schoolWeeks } from '../public/js/weekPlan.js';
import { driveFileId, driveLocation, canFillIn } from '../public/js/locations.js';
import { keysToDo, wantedCopies } from '../public/js/exportPlan.js';
import { addImage } from '../public/js/library.js';
import { holdPicture, isHeld, picturePlaced, pictureHolds, pictureReport, releaseHeld } from '../public/js/pictureHolds.js';

const SLIDES = 'application/vnd.google-apps.presentation';

test('a picture that Google couldn’t fetch is tried again on the recheck and after a renewed sign-in', () => {
  for (const why of ['recheck', 'signin', 'change']) {
    const holds = pictureHolds();
    holdPicture(holds, 'fakeBanner', { reason: 'fetch_failed', now: 1000 });
    assert.equal(isHeld(holds, 'fakeBanner'), true);
    assert.deepEqual(releaseHeld(holds, why), ['fakeBanner'], `let go on ${why}`);
    assert.equal(isHeld(holds, 'fakeBanner'), false);
  }
});

test('a picture Google wouldn’t let the planner share stays held until it’s found shared', () => {
  const holds = pictureHolds();
  holdPicture(holds, 'fakeBanner', { reason: 'cant_share', now: 1000 });
  for (const why of ['recheck', 'signin', 'change']) assert.deepEqual(releaseHeld(holds, why), [], `still held after ${why}`);
  assert.deepEqual(releaseHeld(holds, 'sharing', ['fakeOther']), [], 'news about another picture');
  assert.deepEqual(releaseHeld(holds, 'sharing', ['fakeBanner']), ['fakeBanner']);
  assert.equal(isHeld(holds, 'fakeBanner'), false);
});

test('the teacher is told once per problem, not every time it’s tried again', () => {
  const holds = pictureHolds();
  assert.equal(holdPicture(holds, 'fakeBanner', { reason: 'fetch_failed', now: 1000 }), true, 'first time: tell');
  releaseHeld(holds, 'recheck');
  assert.equal(holdPicture(holds, 'fakeBanner', { reason: 'fetch_failed', now: 2000 }), false, 'same problem again: quiet');
  releaseHeld(holds, 'recheck');
  assert.equal(holdPicture(holds, 'fakeBanner', { reason: 'cant_share', now: 3000 }), true, 'a different problem: tell');
});

test('what went wrong is kept (for the status) until a copy gets the picture', () => {
  const holds = pictureHolds();
  holdPicture(holds, 'fakeBanner', { reason: 'fetch_failed', lessonId: 'lessonA', now: Date.UTC(2026, 9, 30, 8) });
  releaseHeld(holds, 'recheck');
  holdPicture(holds, 'fakeBanner', { reason: 'fetch_failed', lessonId: 'lessonA', now: Date.UTC(2026, 9, 30, 9) });
  const [report] = pictureReport(holds);
  assert.equal(report.fileId, 'fakeBanner');
  assert.equal(report.reason, 'fetch_failed');
  assert.equal(report.onHold, true);
  assert.equal(report.tries, 2);
  assert.equal(report.lessonId, 'lessonA');
  assert.equal(report.since, '2026-10-30T08:00:00.000Z');
  assert.equal(report.lastTry, '2026-10-30T09:00:00.000Z');
  assert.match(report.advice, /tries again/);
  releaseHeld(holds, 'recheck');
  assert.equal(pictureReport(holds)[0].onHold, false, 'still listed while it’s being tried again');
  picturePlaced(holds, 'fakeBanner');
  assert.deepEqual(pictureReport(holds), []);
  holdPicture(holds, 'fakeOther', { reason: 'cant_share' });
  assert.match(pictureReport(holds)[0].advice, /Anyone with the link/);
});

test('copies made while a picture was held want it again once the recheck lets it go', () => {
  const s = emptyState();
  const year = createYear(s, { name: 'Year A', startDate: '2026-08-26', endDate: '2026-10-06' });
  const school = add(s, 'schools', { yearId: year.id, name: 'School A' });
  const grade = add(s, 'grades', { yearId: year.id, name: 'Kindergarten', short: 'K' });
  const deck = add(s, 'lessons', {
    yearId: year.id, name: 'Welcome', category: '', autoFields: ['school', 'image'], instrumentIds: [],
    locations: [driveLocation({ fileId: 'tmpl-Welcome', mimeType: SLIDES })],
  });
  Object.assign(addImage(s, { yearId: year.id, name: 'Banner', locations: [driveLocation({ fileId: 'fakeBanner', mimeType: 'image/png' })] }),
    { when: { anytime: true, priority: 2, windows: [] } });
  schoolWeeks(year).slice(0, 3).forEach((w) => addWeekLesson(s, { yearId: year.id, schoolId: school.id, gradeId: grade.id, weekStart: w.weekStart, lessonId: deck.id }));

  const holds = pictureHolds();
  const target = {
    rootKey: 'drive:fakeRoot', yearFolder: 'Music 2026-27', templateOf: driveFileId, canFill: canFillIn,
    canPicture: () => true, pictureOnHold: (id) => isHeld(holds, id),
  };
  holdPicture(holds, 'fakeBanner', { reason: 'fetch_failed' });
  // The copies were made without the picture while it was held.
  const haves = wantedCopies(s, year.id, target).map((w) => ({ ...w, id: `copy-${w.key}` }));
  assert.ok(haves.every((c) => c.picture === ''));
  assert.deepEqual(keysToDo(wantedCopies(s, year.id, target), haves), [], 'while held: nothing to do');
  releaseHeld(holds, 'recheck');
  assert.equal(keysToDo(wantedCopies(s, year.id, target), haves).length, 3, 'after the recheck: every copy gets its picture');
});
