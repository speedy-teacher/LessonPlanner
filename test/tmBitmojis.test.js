// Colleagues' decks: every bitmoji on the first slide is taken out (a picture spot is left), saved to the
// pictures folder with a sensible name, and "Week 10, Day 2" titles become placeholders.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeTemplate, prepareFile } from '../public/js/templateMaker/maker.js';
import { isUsefulTitle, pictureName } from '../public/js/templateMaker/pictureName.js';
import { boxOf } from '../public/js/templateMaker/scanSlides.js';
import { KINDS } from '../public/js/templateMaker/fileKinds.js';
import { pictureBytes, pptx } from './e2e/templateMaker/officeFiles.js';
import { deck, deckTexts, teacherDrive } from './e2e/templateMaker/samples.js';

const run = () => ({ pictures: new Map() });
const anchorsIn = (presentation) => presentation.slides[0].pageElements.filter((el) => el.title === 'IMAGE_ANCHOR');
const imagesIn = (presentation) => presentation.slides[0].pageElements.filter((el) => el.image);

/** A colleague's deck: "Week 10, Day 2" title, an "I can" box, a bitmoji with a computer-made name, several slides. */
function colleagueDeck(g, { flipped = false, exportSlidesAtMost = Infinity } = {}) {
  const bitmoji = { id: 'bm', x: 990000, y: 1170000, w: 3470000, h: 3470000, flipped, title: 'd83f1b55-fb28-413f-a6dd-9c4f51cf5037-v1.png' };
  return g.add({
    id: 'colleague', name: '2nd Week 10 Day 1', mimeType: KINDS.slides.google, parents: ['theirs'],
    content: deck([
      { texts: ['Week 10, Day 2\n', 'I can sing and identify dynamics (piano and forte).'], pictures: [bitmoji] },
      { texts: ['Ready for the Hall'] }, { texts: ['Echoes'] },
    ]),
    exported: pptx([{ x: 990000, y: 1170000, cx: 3470000, cy: 3470000, file: 'image1.png', bytes: pictureBytes('waving') }]),
    exportSlidesAtMost,
  });
}

async function make(opts = {}, choose = () => {}) {
  const drive = teacherDrive();
  const source = colleagueDeck(drive.g, opts);
  const prepared = await prepareFile(drive.calls, source, { setup: drive.setup });
  choose(prepared);
  const made = await makeTemplate(drive.calls, prepared, { setup: drive.setup, shared: run() });
  return { ...drive, prepared, made, copy: drive.g.get(made.lesson.fileId) };
}

test('a "Week 10, Day 2" title becomes Week {{week_number}}, Day {{lesson_number}}', async () => {
  const { copy, made } = await make();
  assert.equal(deckTexts(copy.content)[0], 'Week {{week_number}}, Day {{lesson_number}}');
  assert.ok(made.lesson.fields.includes('week') && made.lesson.fields.includes('lessonNumber'));
});

test('a deck too big for Google to export whole: its bitmoji is still saved, from a one-slide copy that is thrown away', async () => {
  const { g, copy, made } = await make({ exportSlidesAtMost: 1 });
  assert.equal(made.failedPictures.length, 0);
  assert.equal(made.images.length, 1);
  assert.deepEqual([...g.get(made.images[0].fileId).bytes], [...pictureBytes('waving')]);
  assert.equal(anchorsIn(copy.content).length, 1, 'a picture spot where the bitmoji was');
  assert.equal(imagesIn(copy.content).length, 0, 'the bitmoji is out of the template');
  assert.equal(copy.content.slides.length, 3, 'the template keeps every slide');
  const leftovers = [...g.files.values()].filter((f) => f.name.includes('first slide') && !f.trashed);
  assert.deepEqual(leftovers, [], 'the one-slide copy went to the trash');
  assert.equal(g.get('colleague').content.slides.length, 3, 'the colleague’s own deck is untouched');
});

test('a picture that can’t be saved still becomes a picture spot (it is still in the teacher’s own deck)', async () => {
  const { copy, made } = await make({ exportSlidesAtMost: 0 });
  assert.equal(made.images.length, 0);
  assert.deepEqual(made.failedPictures.map((f) => f.why), ['unreadable']);
  assert.equal(anchorsIn(copy.content).length, 1);
  assert.equal(imagesIn(copy.content).length, 0);
  assert.equal(made.pictures, 1);
  assert.ok(made.lesson.fields.includes('image'));
});

test('a flipped bitmoji (turned to face the other way) is found and saved', async () => {
  const { made, copy } = await make({ flipped: true });
  assert.equal(made.failedPictures.length, 0);
  assert.equal(made.images.length, 1);
  assert.equal(anchorsIn(copy.content).length, 1);
});

test('the saved bitmoji is named what the teacher typed — else after the template, never the computer-made file name', async () => {
  const typed = await make({}, (p) => { p.choices.pictureNames = { [p.scan.pictures[0].key]: 'Waving hello, big smile' }; });
  assert.equal(typed.made.images[0].name, 'Waving hello, big smile');
  const plain = await make({}, (p) => { p.name = 'Dynamics Forest'; });
  assert.equal(plain.made.images[0].name, 'Dynamics Forest picture');
});

test('which alt texts say something about the picture', () => {
  for (const junk of ['', 'd83f1b55-fb28-413f-a6dd-9c4f51cf5037-v1.png', 'image.png', 'Picture 3', 'IMG_2041', 'bitmoji', '1f2e3d4c5b6a']) {
    assert.equal(isUsefulTitle(junk), false, junk);
  }
  for (const good of ['Arms up, cheering', 'Thumbs up with a guitar']) assert.equal(isUsefulTitle(good), true, good);
  assert.equal(pictureName({ title: 'Arms up, cheering' }, { template: 'Song' }), 'Arms up, cheering');
  assert.equal(pictureName({ title: 'abc.png' }, { template: 'Song', index: 1, count: 2 }), 'Song picture 2');
  assert.equal(pictureName({ title: '' }, { typed: ' Sad / rainy day ', template: 'Song' }), 'Sad - rainy day');
});

test('a flipped picture’s box is where it shows on the slide', () => {
  const emu = (magnitude) => ({ magnitude, unit: 'EMU' });
  const box = boxOf({ size: { width: emu(100), height: emu(50) }, transform: { scaleX: -2, scaleY: 1, translateX: 500, translateY: 10, unit: 'EMU' } });
  assert.deepEqual(box, { x: 300, y: 10, width: 200, height: 50 });
});
