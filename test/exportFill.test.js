// Updating a lesson copy in place: the old details are swapped for new ones at exactly the right spots
// (same file, nothing to the trash), and a copy that was edited at those spots is remade instead.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  docsUpdates, fillText, NotInPlace, pictureAnchors, placedPictures, placePictureRequests, sheetsUpdates, slidesUpdates, swaps,
} from '../public/js/exportFill.js';

const OLD = { '{{week_number}}': '3', '{{school}}': 'School A' };
const NEW = { '{{week_number}}': '12', '{{school}}': 'School A' };

test('placeholders are filled in, and the spots of changed details are found (last first)', () => {
  assert.equal(fillText('Week {{week_number}} at {{school}}', OLD), 'Week 3 at School A');
  assert.deepEqual(swaps('Week {{week_number}}, again {{week_number}}', OLD, NEW), [
    { start: 14, end: 15, text: '12' }, // "Week 3, again 3": the second 3
    { start: 5, end: 6, text: '12' },
  ]);
  assert.deepEqual(swaps('{{school}} only', OLD, NEW), [], 'unchanged details are left alone');
});

// ---------- Slides ----------

const run = (content) => ({ textRun: { content } });
const shape = (objectId, ...texts) => ({ objectId, shape: { text: { textElements: [{ paragraphMarker: {} }, ...texts.map(run)] } } });
const slides = (...pageElements) => ({ slides: [{ objectId: 'slide1', pageElements }] });

test('Slides: the old week number is deleted and the new one typed at the same spot', () => {
  const template = slides(shape('title', 'Lesson time\n'), shape('week', 'Week ', '{{week_number}}', '\n'));
  const copy = slides(shape('title', 'Lesson time — my own note\n'), shape('week', 'Week ', '3', '\n'));
  assert.deepEqual(slidesUpdates(template, copy, OLD, NEW), [
    { deleteText: { objectId: 'week', textRange: { type: 'FIXED_RANGE', startIndex: 5, endIndex: 6 } } },
    { insertText: { objectId: 'week', insertionIndex: 5, text: '12' } },
  ], 'the teacher’s note in another box is untouched');
});

test('Slides: text in table cells and grouped shapes is followed too', () => {
  const table = (text) => ({ objectId: 'tbl', table: { tableRows: [{ tableCells: [{ text: { textElements: [run(text)] } }] }] } });
  const group = (text) => ({ objectId: 'grp', elementGroup: { children: [shape('inner', text)] } });
  const requests = slidesUpdates(slides(table('W{{week_number}}'), group('{{week_number}}!')), slides(table('W3'), group('3!')), OLD, NEW);
  assert.deepEqual(requests.filter((r) => r.insertText).map((r) => [r.insertText.objectId, r.insertText.cellLocation ?? null, r.insertText.insertionIndex]),
    [['tbl', { rowIndex: 0, columnIndex: 0 }, 1], ['inner', null, 0]]);
});

test('Slides: a copy edited where a detail goes can’t be updated in place (it’s remade instead)', () => {
  const template = slides(shape('week', 'Week {{week_number}}\n'));
  assert.throws(() => slidesUpdates(template, slides(shape('week', 'Week three\n')), OLD, NEW), NotInPlace);
  assert.throws(() => slidesUpdates(template, slides(), OLD, NEW), NotInPlace, 'the box was deleted');
});

test('Slides: picture spots are found by their alt text, and pictures the planner placed by their ids', () => {
  const spot = { objectId: 'anchor1', title: 'IMAGE_ANCHOR', size: { width: 1 }, transform: { scaleX: 1 } };
  const described = { objectId: 'anchor2', description: '{"anchor": "bitmoji", "removed_bitmoji": "abc"}' };
  const presentation = slides(spot, described, { objectId: 'other', title: 'Logo' }, { objectId: 'lpPicture0_x' });
  assert.deepEqual(pictureAnchors(presentation).map((a) => a.objectId), ['anchor1', 'anchor2']);
  assert.deepEqual(placedPictures(presentation), ['lpPicture0_x']);
  const [create, remove] = placePictureRequests(pictureAnchors(presentation).slice(0, 1), 'https://example.test/pic');
  assert.deepEqual(create.createImage.elementProperties, { pageObjectId: 'slide1', size: spot.size, transform: spot.transform });
  assert.deepEqual(remove, { deleteObject: { objectId: 'anchor1' } });
});

// ---------- Docs ----------

const para = (startIndex, ...texts) => {
  let at = startIndex;
  return { paragraph: { elements: texts.map((content) => { const el = { startIndex: at, textRun: { content } }; at += content.length; return el; }) } };
};

test('Docs: details are swapped at their document positions, across differently formatted pieces', () => {
  const template = { body: { content: [para(1, 'Week ', '{{week_number}}', '\n'), para(23, '{{school}} music\n')] } };
  const copy = { body: { content: [para(1, 'Week ', '3', '\n'), para(9, 'School A music\n')] } };
  const changed = { '{{week_number}}': '12', '{{school}}': 'School B' };
  assert.deepEqual(docsUpdates(template, copy, OLD, changed), [
    { deleteContentRange: { range: { startIndex: 9, endIndex: 17 } } },
    { insertText: { location: { index: 9 }, text: 'School B' } },
    { deleteContentRange: { range: { startIndex: 6, endIndex: 7 } } },
    { insertText: { location: { index: 6 }, text: '12' } },
  ]);
});

test('Docs: details in a header or footer mean the copy is remade instead', () => {
  const template = { body: { content: [] }, headers: { h1: { content: [para(0, '{{school}}\n')] } } };
  assert.throws(() => docsUpdates(template, { body: { content: [] } }, OLD, NEW), NotInPlace);
});

// ---------- Sheets ----------

const sheet = (rows) => ({ sheets: [{ properties: { sheetId: 7 }, data: [{ rowData: rows.map((cells) => ({ values: cells.map((v) => (v === null ? {} : { userEnteredValue: v })) })) }] }] });

test('Sheets: each cell holding details is rewritten (its formatting stays)', () => {
  const template = sheet([[{ stringValue: 'Name' }, { stringValue: 'Week {{week_number}}' }], [{ stringValue: '{{week_number}}' }, null]]);
  const copy = sheet([[{ stringValue: 'Name' }, { stringValue: 'Week 3' }], [{ numberValue: 3 }, { stringValue: 'my note' }]]);
  const requests = sheetsUpdates(template, copy, OLD, NEW);
  assert.deepEqual(requests.map((r) => [r.updateCells.range.startRowIndex, r.updateCells.range.startColumnIndex, r.updateCells.rows[0].values[0].userEnteredValue]),
    [[0, 1, { stringValue: 'Week 12' }], [1, 0, { stringValue: '12' }]]);
  assert.equal(requests[0].updateCells.fields, 'userEnteredValue');
  assert.throws(() => sheetsUpdates(template, sheet([[{ stringValue: 'Name' }, { stringValue: 'Week 4' }]]), OLD, NEW), NotInPlace);
});
