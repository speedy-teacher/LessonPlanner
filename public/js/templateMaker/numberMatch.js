// Finding the lesson and week numbers in a file's text, so they can become Lesson Planner's
// placeholders: "Lesson 1+2" → "Lesson {{lesson_number}}", "Wk. 5" → "Wk. {{week_number}}".
//
// Fuzzy on purpose (ported from lesson-organizer templatize.py and loosened):
//   - the word: Lesson / Lessons / Lsn / Les. / Day, and small typos of "lesson" ("Leson", "Lessson");
//     Week / Weeks / Wk / Wks
//   - between word and number: nothing, "#", "No.", "number", ":" or a dash ("Lesson #3", "Week: 5", "Week - 5")
//   - the number: digits or a number word ("one" … "twenty"), several joined with + & , / - "and" "to"
//     ("Lesson 1+2", "Week 5-6", "Lesson one and two")
//   - a blank to fill in: "Week ____", or "Week" at the very end of a short line ("Spirit Week" is shown too —
//     the teacher can untick it)
// Only short lines count (titles and headers, not paragraphs of lesson text).
//
// Pure logic, shared by the browser and the Node tests.

import { AUTO_FIELD_PLACEHOLDERS } from '../model.js';

/** Lines longer than this are lesson text, not a title: numbers in them are left alone. */
export const SHORT_LINE = 60;
/** "Lesson 7" is more likely the lesson's number in the year than in its week. */
export const IN_WEEK_AT_MOST = 6;

const NUMBER_WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve',
  'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen', 'twenty'];
const WORDS = {
  lesson: ['lesson', 'lessons', 'lsn', 'les', 'day', 'days'],
  week: ['week', 'weeks', 'wk', 'wks'],
};

const ONE = `(?:\\d{1,3}|${NUMBER_WORDS.join('|')})`;
const JOIN = '[ \\t]*(?:[+&,/]|-|–|and|to)[ \\t]*';
const GAP = '[ \\t]*(?:#|no\\.?|number|num\\.?|:|-|–)?[ \\t]*';
const AFTER_WORD = new RegExp(`^(${GAP})(${ONE}(?:${JOIN}${ONE})*|_{2,})(?![\\p{L}\\d])`, 'iu');
const WORD = /(?<![\p{L}\d_{])(\p{L}{2,8})\.?/gu;

/** Which kind of number a word introduces ('lesson' | 'week'), or null. */
export function wordKind(word) {
  const w = word.toLowerCase();
  for (const [kind, words] of Object.entries(WORDS)) if (words.includes(w)) return kind;
  if (w.length >= 5 && w.length <= 7 && closeTo(w, 'lesson')) return 'lesson';
  return null;
}

/** True when `a` is at most one typo (letter added, missing or changed) away from `b`. */
function closeTo(a, b) {
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0;
  let j = 0;
  let typos = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { i += 1; j += 1; continue; }
    typos += 1;
    if (typos > 1) return false;
    if (a.length > b.length) i += 1;
    else if (a.length < b.length) j += 1;
    else { i += 1; j += 1; }
  }
  return typos + (a.length - i) + (b.length - j) <= 1;
}

/** The first number in "1+2" / "five and six" (null for a blank). */
export function firstNumber(text) {
  const m = /\d+|\p{L}+/u.exec(text);
  if (!m) return null;
  if (/^\d+$/.test(m[0])) return Number(m[0]);
  const i = NUMBER_WORDS.indexOf(m[0].toLowerCase());
  return i === -1 ? null : i;
}

/** The Lesson Planner detail a found number becomes: 'week', 'lessonNumber' or 'lessonNumberAbs'. */
export function defaultField(kind, number) {
  if (kind === 'week') return 'week';
  return number !== null && number > IN_WEEK_AT_MOST ? 'lessonNumberAbs' : 'lessonNumber';
}

/**
 * The lesson and week numbers in one short line: [{ kind, field, start, end, found, insert }].
 * `start`..`end` is what gets replaced (just the number, the word stays), `insert` the placeholder typed there.
 */
export function findInLine(line) {
  if (line.trim().length > SHORT_LINE) return [];
  const out = [];
  for (const m of line.matchAll(WORD)) {
    const kind = wordKind(m[1]);
    if (!kind) continue;
    const match = numberAfter(line, m.index + m[0].length, kind);
    if (match && !out.some((o) => o.start < match.end && match.start < o.end)) out.push(match);
  }
  return out;
}

function numberAfter(line, wordEnd, kind) {
  const rest = line.slice(wordEnd);
  const m = AFTER_WORD.exec(rest);
  if (m) {
    const start = wordEnd + m[1].length;
    const number = firstNumber(m[2]);
    const spaced = m[1].length === 0 && !m[2].startsWith('_');
    return made(kind, defaultField(kind, number), { start, end: start + m[2].length, line, before: spaced ? ' ' : '' });
  }
  if (kind === 'week' && /^[ \t]*$/.test(rest)) {
    return made(kind, 'week', { start: wordEnd, end: line.length, line, before: ' ' });
  }
  return null;
}

function made(kind, field, { start, end, line, before }) {
  return { kind, field, start, end, found: line.slice(start, end), insert: `${before}${AUTO_FIELD_PLACEHOLDERS[field]}` };
}

/**
 * Every lesson/week number in a text (several lines), with positions in the whole text.
 * Each match also keeps its `line` and where in it the match is (`at`), for showing the teacher.
 */
export function findNumbers(text) {
  const out = [];
  let offset = 0;
  for (const line of text.split(/[\n\v]/)) { // \v = a line break inside a paragraph (Slides, Docs)
    for (const m of findInLine(line)) out.push({ ...m, start: m.start + offset, end: m.end + offset, line, at: m.start });
    offset += line.length + 1;
  }
  return out;
}

/** The placeholder a match is typed as, for the chosen field (the teacher may switch lesson ↔ lesson in the year). */
export function placeholderFor(match, field = match.field) {
  return match.insert.replace(AUTO_FIELD_PLACEHOLDERS[match.field], AUTO_FIELD_PLACEHOLDERS[field]);
}

/** The text with these matches replaced (each may carry `chosenField`, the teacher's lesson ↔ lesson-in-the-year switch). */
export function applyMatches(text, matches) {
  let out = text;
  for (const m of [...matches].sort((a, b) => b.start - a.start)) {
    out = out.slice(0, m.start) + placeholderFor(m, m.chosenField) + out.slice(m.end);
  }
  return out;
}

/** The match's line as it reads now and afterwards: { before, after }. */
export function preview(match, field = match.field) {
  const { line, at } = match;
  return { before: line.trim(), after: (line.slice(0, at) + placeholderFor(match, field) + line.slice(at + match.found.length)).trim() };
}
