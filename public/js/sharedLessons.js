// Lesson templates from colleagues' Teacher Resources shared with you ("borrowed"), usable on your own
// Lesson Schedule. Their templates are only ever copied, never changed: they're added to the combined
// data the app works on, marked `sharedFrom` (their Teacher Resources' Drive file id) and `sharedBy`
// (the owner's name, from Google Drive), and never saved into any of your pieces. A schedule entry made
// from one keeps `sharedFrom` too, so it can say why it's greyed out when that file can't be had.
//
// Your lesson copies fill in your own schedule details and pictures: only the template comes from them.
//
// Pure logic, shared by the browser app and the Node tests.

/** Palette filter value for your own templates (any other value is a colleague's Teacher Resources file id). */
export const MINE = 'mine';

/**
 * A borrowed Teacher Resources: { fileId, owner, lessons } (`lessons` = its lesson records, or null when
 * it couldn't be loaded). Returns the lessons to add to the combined data: stamped with where they're
 * from, without any whose id the data already has (e.g. your own, or theirs shown by "Looking at").
 */
export function borrowedLessons(borrowed = [], have = []) {
  const ids = new Set(have.map((l) => l.id));
  const out = [];
  for (const source of borrowed) {
    for (const lesson of source.lessons ?? []) {
      if (ids.has(lesson.id)) continue;
      ids.add(lesson.id);
      out.push({ ...structuredClone(lesson), sharedFrom: source.fileId, sharedBy: source.owner || 'A colleague' });
    }
  }
  return out;
}

export const isBorrowed = (lesson) => Boolean(lesson?.sharedFrom);

/** Your own lessons only (what gets saved into your Teacher Resources). */
export const ownOnly = (lessons) => lessons.filter((l) => !isBorrowed(l));

/**
 * A change with whatever it did to borrowed templates taken back out (they can't be changed or
 * deleted here): `after`'s borrowed lessons are replaced by `before`'s. Returns { state, touched }.
 */
export function keepBorrowed(before, after) {
  const was = before.lessons.filter(isBorrowed);
  const now = after.lessons.filter(isBorrowed);
  const touched = JSON.stringify(was) !== JSON.stringify(now);
  if (!touched) return { state: after, touched };
  return { state: { ...after, lessons: [...ownOnly(after.lessons), ...was] }, touched };
}

/** The people whose templates are in the data, for the palette's "From" filter: [{ id: fileId, name }] by name. */
export function lessonAuthors(lessons) {
  const byFile = new Map();
  for (const l of lessons.filter(isBorrowed)) if (!byFile.has(l.sharedFrom)) byFile.set(l.sharedFrom, l.sharedBy);
  return [...byFile].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));
}

/** Does a lesson pass the "From" filter ('' = everyone, MINE = yours, else a colleague's file id)? */
export function fromAuthor(lesson, author = '') {
  if (!author) return true;
  if (author === MINE) return !isBorrowed(lesson);
  return lesson.sharedFrom === author;
}

/** Teacher Resources files your Lesson Schedule uses templates from (so they're loaded even if not listed). */
export function sourcesUsed(state) {
  return [...new Set(state.weekLessons.map((e) => e.sharedFrom).filter(Boolean))];
}

/**
 * Schedule entries whose colleague's template can't be had right now (not loaded, not shared any more,
 * removed): their lesson copies are left as they are — never remade or put in the trash — until it's back
 * or the entry leaves the schedule. Returns a Set of entry ids.
 */
export function heldEntries(state) {
  const ids = new Set(state.lessons.map((l) => l.id));
  return new Set(state.weekLessons.filter((e) => e.sharedFrom && !ids.has(e.lessonId)).map((e) => e.id));
}

/** Words for why a colleague's template can't be had (`why` = pieceEngine MISSING_WORDS key). */
export const SHARED_WORDS = {
  not_loaded: 'A colleague’s template: not loaded yet — connect Google Drive to load it.',
  no_access: 'A colleague’s template: their Teacher Resources isn’t shared with you any more.',
  not_found: 'A colleague’s template: their Teacher Resources was removed from Google Drive.',
  offline: 'A colleague’s template: can’t reach Google Drive right now.',
  signed_out: 'A colleague’s template: sign in to Google Drive to load it.',
  gone: 'A colleague’s template: they removed it from their Teacher Resources.',
};

/**
 * Why an entry's colleague's template isn't there, or null when it is (or the entry isn't from a
 * colleague). `status` = { [fileId]: why } for borrowed files that couldn't be loaded.
 */
export function sharedWhy(state, entry, status = {}) {
  if (!entry?.sharedFrom || state.lessons.some((l) => l.id === entry.lessonId)) return null;
  return SHARED_WORDS[status[entry.sharedFrom] ?? 'gone'] ?? SHARED_WORDS.gone;
}
