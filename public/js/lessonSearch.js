// Searching lessons — the same everywhere (Lesson Templates, the Lesson Schedule's list, assistant commands):
// every word typed must be somewhere in the lesson's name, category or the folders it's in, in any order.
// Punctuation doesn't matter ("Lines_and-Spaces" is found by "lines and spaces") and "&" counts as "and".

import { folderPath } from './library.js';

/** Lowercase words only: "Lines & Spaces_2" → "lines and spaces 2". */
export const plainWords = (text) => ` ${String(text ?? '').toLowerCase().replace(/&/g, ' and ').replace(/[^\p{L}\p{N}]+/gu, ' ').trim()} `;

/** The words typed in a search box ([] = no search). */
export const searchWords = (search) => plainWords(search).trim().split(' ').filter(Boolean);

/** What a lesson can be found by: its name, category, folders and (a colleague's) who shared it. */
export function lessonText(state, lesson) {
  const folders = folderPath(state, lesson.folderId).map((f) => f.name);
  return plainWords([lesson.name, lesson.category, ...folders, lesson.sharedBy].filter(Boolean).join(' '));
}

/** Every word is in the lesson's text (anywhere, any order). */
export const lessonMatches = (state, lesson, words) => words.every((w) => lessonText(state, lesson).includes(w));
