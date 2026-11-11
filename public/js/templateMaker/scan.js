// One place for "what's in this file, and what changes": each kind of file (scanSlides.js, scanDocs.js,
// scanSheets.js) gives its lesson/week numbers, its first-page pictures and the edits for the chosen ones.
// The teacher's ticks (`choices`) are kept by `key`, which is the same in a copy of the file — so the
// file can be read, the teacher choose, and the template copy be read again and changed in the same places.
//
// Pure logic, shared by the browser and the Node tests.

import { docsMatches, docsParagraphs, docsPictures, docsTextRequests } from './scanDocs.js';
import { sheetCells, sheetsMatches, sheetsTextRequests } from './scanSheets.js';
import { slidesAnchorRequests, slidesMatches, slidesPictures, slidesTextRequests, slidesTexts } from './scanSlides.js';

const none = () => [];

export const SCANNERS = {
  slides: { texts: slidesTexts, matches: slidesMatches, pictures: slidesPictures, textRequests: slidesTextRequests, pictureRequests: slidesAnchorRequests, picturesStay: false },
  docs: { texts: docsParagraphs, matches: docsMatches, pictures: docsPictures, textRequests: docsTextRequests, pictureRequests: none, picturesStay: true },
  sheets: { texts: sheetCells, matches: sheetsMatches, pictures: none, textRequests: sheetsTextRequests, pictureRequests: none, picturesStay: false },
};

/** What a file holds: { matches, pictures } (pictures only when the teacher has a pictures folder). */
export function scanFile(kind, json, { pictures = true } = {}) {
  const s = SCANNERS[kind];
  return { matches: s.matches(json), pictures: pictures ? s.pictures(json) : [] };
}

/** Everything ticked to start with: every match (as its usual detail) and every picture. */
export function defaultChoices(scan) {
  return {
    matches: Object.fromEntries(scan.matches.map((m) => [m.key, m.field])),
    pictures: Object.fromEntries(scan.pictures.map((p) => [p.key, true])),
  };
}

/** The ticked matches (with the chosen detail) and pictures of a scan. */
export function chosen(scan, choices) {
  return {
    matches: scan.matches.filter((m) => choices.matches[m.key]).map((m) => ({ ...m, chosenField: choices.matches[m.key] })),
    pictures: scan.pictures.filter((p) => choices.pictures[p.key]),
  };
}

/** The Lesson Planner details a template now has (for the lesson's ticks in Lesson Planner). */
export function fieldsUsed(kind, picked, placedPictures) {
  const fields = new Set(picked.matches.map((m) => m.chosenField));
  if (placedPictures.length && !SCANNERS[kind].picturesStay) fields.add('image');
  return [...fields];
}

/** All edits for a template copy: the ticked numbers, and the pictures that were saved (Slides: swapped for picture spots). */
export function editRequests(kind, picked, placedPictures) {
  const s = SCANNERS[kind];
  return [...s.textRequests(picked.matches), ...s.pictureRequests(placedPictures)];
}

/** How many of the planner's placeholders ({{…}}) a file's text holds. */
export function placeholdersIn(kind, json) {
  return SCANNERS[kind].texts(json).reduce((n, t) => n + (t.text.match(/\{\{[a-z_]+\}\}/g) ?? []).length, 0);
}
