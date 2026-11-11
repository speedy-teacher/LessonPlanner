// Making templates against a pretend Google Drive: picked files become templates in the templates folder,
// with the planner's placeholders and their pictures saved to the pictures folder. The teacher's own
// files are never changed. (Adding them to the open plan: tmSession.test.js.)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dropFile, makeTemplate, prepareFile, staleDrafts } from '../public/js/templateMaker/maker.js';
import { KINDS } from '../public/js/templateMaker/fileKinds.js';
import { renderDoc } from './e2e/templateMaker/fakeDocs.js';
import { docx, pictureBytes } from './e2e/templateMaker/officeFiles.js';
import { deckTexts, sheetValues, teacherDrive } from './e2e/templateMaker/samples.js';

const run = () => ({ pictures: new Map() });
const anchorsIn = (presentation) => presentation.slides[0].pageElements.filter((el) => el.title === 'IMAGE_ANCHOR');

test('a Google Slides deck becomes a template: numbers on every slide become placeholders, the picture a picture spot', async () => {
  const { g, calls, setup, files } = teacherDrive();
  const original = structuredClone(files.slides.content);
  const prepared = await prepareFile(calls, files.slides, { setup });
  assert.equal(prepared.name, 'Rhythm Tree');
  assert.deepEqual(prepared.scan.matches.map((m) => [m.where, m.found]), [['Slide 1', '1+2'], ['Slide 1', '5'], ['Slide 2', '2']]);
  assert.equal(prepared.scan.pictures.length, 1);

  const made = await makeTemplate(calls, prepared, { setup, shared: run() });
  const copy = g.get(made.lesson.fileId);
  assert.deepEqual(copy.parents, ['tplFolder']);
  assert.equal(copy.name, 'Rhythm Tree');
  assert.deepEqual(deckTexts(copy.content), ['Rhythm Tree', 'Lesson {{lesson_number}} · Week {{week_number}}', 'Day {{lesson_number}} warm-up']);
  const [anchor] = anchorsIn(copy.content);
  assert.ok(anchor, 'a see-through IMAGE_ANCHOR spot is where the picture was');
  assert.deepEqual(anchor.transform, original.slides[0].pageElements.find((el) => el.objectId === 'pic1').transform);
  assert.equal(copy.content.slides[0].pageElements.some((el) => el.image), false);
  assert.deepEqual(made.lesson.fields.sort(), ['image', 'lessonNumber', 'week']);

  const [picture] = made.images;
  const saved = g.get(picture.fileId);
  assert.deepEqual(saved.parents, ['picFolder']);
  assert.deepEqual([...saved.bytes], [...pictureBytes('bitmoji')]);
  assert.deepEqual(g.get('deck1').content, original, 'the teacher’s own deck is untouched');
});

test('unticked numbers and pictures stay as they are; a lesson number can be switched to the one in the year', async () => {
  const { g, calls, setup, files } = teacherDrive();
  const prepared = await prepareFile(calls, files.slides, { setup });
  const [lesson, week, day] = prepared.scan.matches;
  prepared.choices.matches[week.key] = false;
  prepared.choices.matches[lesson.key] = 'lessonNumberAbs';
  prepared.choices.matches[day.key] = false;
  prepared.choices.pictures[prepared.scan.pictures[0].key] = false;
  prepared.name = 'My Rhythm Tree';
  const made = await makeTemplate(calls, prepared, { setup, shared: run() });
  const copy = g.get(made.lesson.fileId);
  assert.equal(copy.name, 'My Rhythm Tree');
  assert.deepEqual(deckTexts(copy.content), ['Rhythm Tree', 'Lesson {{lesson_number_abs}} · Week 5', 'Day 2 warm-up']);
  assert.equal(anchorsIn(copy.content).length, 0);
  assert.deepEqual(made.images, []);
});

test('a PowerPoint file never opened in Google is turned into Google Slides, then templatized', async () => {
  const { g, calls, setup, files } = teacherDrive();
  const prepared = await prepareFile(calls, files.office, { setup });
  assert.ok(prepared.draft, 'a draft copy was made to read it');
  assert.equal(g.get(prepared.draft.id).properties.lessonPlanner, 'template-maker-draft', 'Lesson Planner skips drafts');
  assert.equal(prepared.name, 'Beat Buddies');
  const made = await makeTemplate(calls, prepared, { setup, shared: run() });
  assert.equal(made.lesson.fileId, prepared.draft.id, 'the draft becomes the template');
  const copy = g.get(made.lesson.fileId);
  assert.equal(copy.mimeType, KINDS.slides.google);
  assert.equal(copy.appProperties.templateMaker, 'template');
  assert.equal(copy.properties.lessonPlanner, undefined);
  assert.deepEqual(deckTexts(copy.content), ['Beat Buddies', 'Week {{week_number}}']);
  assert.equal(anchorsIn(copy.content).length, 1);
  assert.equal(g.get('ppt1').mimeType, KINDS.slides.office, 'the PowerPoint file itself is untouched');
});

test('a file taken out again leaves no draft behind; old drafts are found to tidy away', async () => {
  const { g, calls, setup, files } = teacherDrive();
  const prepared = await prepareFile(calls, files.office, { setup });
  await dropFile(calls, prepared);
  assert.equal(g.get(prepared.draft.id).trashed, true);
  const drafts = [{ appProperties: { templateMaker: 'draft' }, modifiedTime: '2026-11-01T08:00:00Z' }, { appProperties: { templateMaker: 'draft' }, modifiedTime: '2026-11-01T09:30:00Z' }];
  assert.equal(staleDrafts(drafts, Date.parse('2026-11-01T10:00:00Z')).length, 1);
});

test('a Google Doc: numbers in the text and header become placeholders; its picture is saved but stays in place', async () => {
  const { g, calls, setup, files } = teacherDrive();
  files.doc.exported = docx([{ cx: 127000, cy: 254000, file: 'image1.jpeg', bytes: pictureBytes('song') }]);
  g.get('doc1').exported = files.doc.exported;
  const prepared = await prepareFile(calls, files.doc, { setup });
  assert.deepEqual(prepared.scan.matches.map((m) => [m.where, m.found]), [['Text', '2'], ['Header', '7']]);
  const made = await makeTemplate(calls, prepared, { setup, shared: run() });
  const doc = renderDoc(g.get(made.lesson.fileId).content);
  const text = (content) => content.flatMap((p) => p.paragraph.elements.map((e) => e.textRun?.content ?? '')).join('');
  assert.equal(text(doc.body.content), 'Lesson {{lesson_number}} notes\nSing \n');
  assert.equal(text(doc.headers.h1.content), 'Week {{week_number}}\n');
  assert.ok(doc.body.content[1].paragraph.elements.some((e) => e.inlineObjectElement), 'the picture stays');
  assert.equal(made.images.length, 1);
  assert.equal(g.get(made.images[0].fileId).mimeType, 'image/jpeg');
  assert.equal(made.lesson.fields.includes('image'), false);
});

test('a Google Sheet: typed-in numbers become placeholders, formulas and numbers are left alone', async () => {
  const { g, calls, setup, files } = teacherDrive();
  const prepared = await prepareFile(calls, files.spreadsheet, { setup });
  assert.deepEqual(prepared.scan.pictures, [], 'sheets have no pictures to choose');
  const made = await makeTemplate(calls, prepared, { setup, shared: run() });
  assert.deepEqual(sheetValues(g.get(made.lesson.fileId).content), [['Week {{week_number}}', 'Lesson {{lesson_number}}'], ['=SUM(A1)', 12]]);
});

test('without a pictures folder, pictures aren’t offered', async () => {
  const { calls, setup, files } = teacherDrive({ images: false });
  const prepared = await prepareFile(calls, files.slides, { setup });
  assert.deepEqual(prepared.scan.pictures, []);
});

test('the same picture in two files is saved once', async () => {
  const { g, calls, setup, files } = teacherDrive();
  const shared = run();
  const a = await makeTemplate(calls, await prepareFile(calls, files.slides, { setup }), { setup, shared });
  const b = await makeTemplate(calls, await prepareFile(calls, files.office, { setup }), { setup, shared });
  assert.equal(a.images[0].fileId, b.images[0].fileId);
  const later = await makeTemplate(calls, await prepareFile(calls, files.slides, { setup }), { setup, shared: run() });
  assert.equal(later.images[0].fileId, a.images[0].fileId, 'found again in the pictures folder on a later visit');
  assert.equal([...g.files.values()].filter((f) => f.parents.includes('picFolder')).length, 1);
});

test('Google’s “slow down” answers are waited out and tried again', async () => {
  const { g, calls, setup, files } = teacherDrive();
  g.failNext('/copy', { status: 429, times: 2 });
  g.failNext('presentations', { status: 403, reason: 'userRateLimitExceeded' });
  const made = await makeTemplate(calls, await prepareFile(calls, files.slides, { setup }), { setup, shared: run() });
  assert.ok(g.get(made.lesson.fileId));
});
