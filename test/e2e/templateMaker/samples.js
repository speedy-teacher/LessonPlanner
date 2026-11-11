// Made-up teacher files for the tests (no real names): a slide deck, a spreadsheet, a Teacher Resources file
// and a teacher's Google Drive with all of them in it.
import { googleClient } from '../../../public/js/templateMaker/googleApi.js';
import { driveCalls } from '../../../public/js/templateMaker/makerDrive.js';
import { KINDS } from '../../../public/js/templateMaker/fileKinds.js';
import { fakeDoc } from './fakeDocs.js';
import { fakeGoogle } from './fakeGoogle.js';
import { pptx, pictureBytes } from './officeFiles.js';

const emu = (magnitude) => ({ magnitude, unit: 'EMU' });
const place = (x, y) => ({ scaleX: 1, scaleY: 1, translateX: x, translateY: y, unit: 'EMU' });
/** What a pretend picture looks like (shown on the demo page). */
export const PRETEND_PICTURE = `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><text y=".9em" font-size="80">🧑‍🎤</text></svg>')}`;
const textOf = (content) => ({ textElements: [{ startIndex: 0, endIndex: content.length, textRun: { content } }] });

/** slides = [{ texts: ['Lesson 1+2', …], pictures: [{ id, x, y, w, h }] }] */
export function deck(slides) {
  return {
    slides: slides.map((s, i) => ({
      objectId: `slide${i + 1}`,
      pageElements: [
        ...(s.texts ?? []).map((t, j) => ({ objectId: `s${i + 1}text${j + 1}`, size: { width: emu(100), height: emu(50) }, transform: place(0, 0), shape: { text: textOf(`${t}\n`) } })),
        ...(s.pictures ?? []).map((p) => ({ objectId: p.id, size: { width: emu(p.w), height: emu(p.h) }, transform: place(p.x, p.y), image: { contentUrl: PRETEND_PICTURE } })),
      ],
    })),
  };
}

/** The text of every shape on every slide (to check the template). */
export const deckTexts = (presentation) => presentation.slides.flatMap((s) => s.pageElements.filter((el) => el.shape?.text)
  .map((el) => el.shape.text.textElements.map((t) => t.textRun?.content ?? '').join('').trim()));

/** rows = [['Week 5', 'Lesson 2'], …] on one sheet. */
export function sheet(rows) {
  return {
    sheets: [{
      properties: { sheetId: 0, title: 'Plan' },
      data: [{ rowData: rows.map((r) => ({ values: r.map((v) => (v === null ? {} : { userEnteredValue: typeof v === 'number' ? { numberValue: v } : { stringValue: v } })) })) }],
    }],
  };
}

export const sheetValues = (spreadsheet) => spreadsheet.sheets[0].data[0].rowData.map((r) => r.values.map((v) => v.userEnteredValue?.stringValue ?? v.userEnteredValue?.numberValue ?? null));

const driveLoc = (fileId, mimeType) => ({ kind: 'drive', uri: `https://drive.google.com/open?id=${fileId}`, fileId, mimeType, modifiedTime: null, lastSeenAt: null });

/** A Teacher Resources piece with a watched templates folder (+ a grade folder inside) and a pictures folder. */
export function resourcesPiece({ images = true, extra = {} } = {}) {
  return {
    kind: 'lesson-planner-resources', schemaVersion: 6, meta: {},
    deckFolders: [
      { id: 'fld_top', name: 'Lessons', parentId: null, locations: [driveLoc('tplFolder', 'application/vnd.google-apps.folder')], watch: true, seenDriveIds: [] },
      { id: 'fld_g2', name: 'Grade 2', parentId: 'fld_top', locations: [driveLoc('g2Folder', 'application/vnd.google-apps.folder')], watch: false, seenDriveIds: [] },
    ],
    imageFolders: images ? [{ id: 'ifld_pics', name: 'Bitmojis', parentId: null, locations: [driveLoc('picFolder', 'application/vnd.google-apps.folder')], watch: true, seenDriveIds: [] }] : [],
    lessons: [{ id: 'les_old', name: 'Old Song', category: '', autoFields: ['school'], instrumentIds: [], folderId: 'fld_top', locations: [driveLoc('oldFile', KINDS.slides.google)], isNew: false }],
    images: [], tagGroups: [], tags: [], localRoots: [], ...extra,
  };
}

/**
 * A pretend teacher's Drive: Teacher Resources + folders, a Google Slides deck with a picture, a PowerPoint
 * file never opened in Google, a Google Doc and a Google Sheet. Returns { g, calls, files, setup }.
 */
export function teacherDrive({ images = true, delayMs = 0 } = {}) {
  const g = fakeGoogle();
  const folder = (id, name) => g.add({ id, name, mimeType: 'application/vnd.google-apps.folder' });
  folder('tplFolder', 'Lessons');
  folder('g2Folder', 'Grade 2');
  folder('picFolder', 'Bitmojis');
  const resources = g.add({ id: 'resFile', name: 'Teacher Resources', mimeType: 'application/json', properties: { lessonPlanner: 'resources' }, text: JSON.stringify(resourcesPiece({ images })) });
  const bitmoji = { id: 'pic1', x: 5000, y: 6000, w: 300000, h: 400000 };
  const slides = g.add({
    id: 'deck1', name: 'Week 05 - Rhythm Tree Lesson 1+2', mimeType: KINDS.slides.google, parents: ['mine'],
    content: deck([{ texts: ['Rhythm Tree', 'Lesson 1+2 · Week 5'], pictures: [bitmoji] }, { texts: ['Day 2 warm-up'] }]),
    exported: pptx([{ x: 5000, y: 6000, cx: 300000, cy: 400000, file: 'image1.png', bytes: pictureBytes('bitmoji') }]),
  });
  const office = g.add({
    id: 'ppt1', name: 'Beat Buddies Wk 3.pptx', mimeType: KINDS.slides.office, parents: ['mine'],
    bytes: pptx([{ x: 10, y: 20, cx: 300000, cy: 400000, file: 'image9.png', bytes: pictureBytes('bitmoji') }]),
    converted: deck([{ texts: ['Beat Buddies', 'Week 3'], pictures: [{ id: 'g1', x: 10, y: 20, w: 300000, h: 400000 }] }]),
  });
  const doc = g.add({
    id: 'doc1', name: 'Lesson plan', mimeType: KINDS.docs.google,
    content: fakeDoc({ body: [['Lesson 2 notes\n'], ['Sing ', { picture: 'img1' }, '\n']], headers: { h1: [['Week 7\n']] }, pictures: { img1: { size: { width: { magnitude: 10, unit: 'PT' }, height: { magnitude: 20, unit: 'PT' } } } } }),
  });
  const spreadsheet = g.add({ id: 'sheet1', name: 'Week 4 checklist', mimeType: KINDS.sheets.google, content: sheet([['Week 4', 'Lesson 3'], ['=SUM(A1)', 12]]) });
  const slowly = async (url, init) => { await new Promise((r) => { setTimeout(r, delayMs); }); return g.fetch(url, init); };
  const calls = driveCalls(googleClient({ token: () => 'pass', fetchFn: delayMs ? slowly : g.fetch, sleep: async () => {} }));
  const setup = {
    resources: { file: resources },
    templateFolder: { id: 'fld_top', driveId: 'tplFolder', path: 'Lessons' },
    imageFolder: images ? { id: 'ifld_pics', driveId: 'picFolder', path: 'Bitmojis' } : null,
  };
  return { g, calls, setup, files: { slides, office, doc, spreadsheet, resources } };
}

/** The open plan as the planner holds it: the same library, every record in this school year (`yr_1`). */
export function plannerState(opts = {}) {
  const piece = resourcesPiece(opts);
  const state = { years: [{ id: 'yr_1', name: '2026-27', startDate: '2026-08-24', endDate: '2027-06-04' }] };
  for (const name of ['deckFolders', 'imageFolders', 'lessons', 'images']) state[name] = piece[name].map((r) => ({ ...r, yearId: 'yr_1' }));
  return state;
}
