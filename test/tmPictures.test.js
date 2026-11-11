// Getting pictures out of PowerPoint/Word files, and matching them to the pictures Google lists.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { documentPictures, matchPictures, pictureFile, slidePictures, zipEntries, zipFile } from '../public/js/templateMaker/officePackage.js';
import { deflateRawSync } from 'node:zlib';
import { docx, makeZip, pictureBytes, pptx } from './e2e/templateMaker/officeFiles.js';

test('zip files are read, stored or compressed', async () => {
  const zip = zipEntries(makeZip({ 'a.txt': 'hello hello hello', 'b.png': pictureBytes('x') }, { deflate: deflateRawSync }));
  assert.equal(new TextDecoder().decode(await zipFile(zip, 'a.txt')), 'hello hello hello');
  assert.deepEqual([...await zipFile(zip, 'b.png')], [...pictureBytes('x')]);
  assert.equal(await zipFile(zip, 'missing'), null);
  assert.throws(() => zipEntries(new Uint8Array(10)), /not_a_zip/);
});

test('the first slide’s pictures, with their place and size', async () => {
  const zip = zipEntries(pptx([{ x: 1, y: 2, cx: 30, cy: 40, file: 'image1.png', bytes: pictureBytes('a') }, { x: 5, y: 6, cx: 70, cy: 80, file: 'image2.emf', bytes: pictureBytes('b') }]));
  const found = await slidePictures(zip);
  assert.deepEqual(found, [
    { part: 'ppt/media/image1.png', box: { x: 1, y: 2, width: 30, height: 40 } },
    { part: 'ppt/media/image2.emf', box: { x: 5, y: 6, width: 70, height: 80 } },
  ]);
  assert.equal((await pictureFile(zip, found[0].part)).mimeType, 'image/png');
  assert.equal(await pictureFile(zip, found[1].part), null, 'drawings (EMF) can’t be used as pictures');
});

test('a Word file’s pictures in order, with their size', async () => {
  const zip = zipEntries(docx([{ cx: 10, cy: 20, file: 'image1.jpeg', bytes: pictureBytes('a') }]));
  assert.deepEqual(await documentPictures(zip), [{ part: 'word/media/image1.jpeg', box: { x: null, y: null, width: 10, height: 20 } }]);
});

test('Google’s pictures are matched by place and size; a picture with no close match is left out', () => {
  const found = [{ part: 'one', box: { x: 0, y: 0, width: 1000000, height: 1000000 } }, { part: 'two', box: { x: 5000000, y: 0, width: 500000, height: 500000 } }];
  const pictures = [
    { key: 'b', box: { x: 5000100, y: 0, width: 500000, height: 500000 } },
    { key: 'a', box: { x: 0, y: 0, width: 1000000, height: 1000000 } },
    { key: 'c', box: { x: 9000000, y: 9000000, width: 20, height: 20 } },
  ];
  assert.deepEqual([...matchPictures(pictures, found)], [['b', 'two'], ['a', 'one']]);
});
