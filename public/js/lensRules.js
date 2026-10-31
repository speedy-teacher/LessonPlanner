// Which person's pieces each tab can show ("Looking at"), worked out without any browser parts.
//
// A tab about the Lesson Schedule (Lesson Schedule, Reports, Outcomes' lesson order) looks at people who
// shared their Lesson Schedule for this School Year; a tab about templates and pictures (Lesson Templates,
// Images) looks at people who shared their Teacher Resources. Every other tab shows your own pieces.
// Each tab remembers its own choice.

/** Page id → what its "Looking at" is about. Pages not listed have no picker. */
export const LENS = {
  lessonSchedule: 'schedule',
  reports: 'schedule',
  outcomes: 'schedule',
  lessons: 'resources',
  images: 'resources',
};

/**
 * What a page should show, from the choices made on each page (`picks[pageId]` = a person
 * { fileId, name, ownerId }, or nothing for "Me"):
 *   schedule: their Teacher Schedule, or null = yours
 *   resources: 'linked' = the Teacher Resources their schedule links to · a person = their Teacher
 *     Resources on its own (your schedule stays) · null = yours
 */
export function wantedView(pageId, picks = {}) {
  const lens = LENS[pageId] ?? null;
  const person = lens ? picks[pageId] ?? null : null;
  if (lens === 'schedule') return { lens, schedule: person, resources: person ? 'linked' : null };
  if (lens === 'resources') return { lens, schedule: null, resources: person };
  return { lens, schedule: null, resources: null };
}

const resourcesId = (resources) => (resources === 'linked' ? 'linked' : resources?.fileId ?? null);

/** True when two wanted views show the same pieces (so changing tabs needs no swap). */
export function sameView(a, b) {
  return (a.schedule?.fileId ?? null) === (b.schedule?.fileId ?? null) && resourcesId(a.resources) === resourcesId(b.resources);
}

const isNewer = (f, seen) => !seen || String(f.modifiedTime ?? '') > String(seen.modifiedTime ?? '');

/**
 * The people behind a list of Drive files: one row per owner (their newest file), without your own
 * file or any file you own, by name: [{ fileId, name, ownerId }].
 */
export function peopleFrom(files, { mineFileId = null } = {}) {
  const newest = new Map();
  for (const f of files.filter((file) => file.fileId !== mineFileId && file.ownedByMe !== true)) {
    const who = f.ownerId ?? f.fileId;
    if (isNewer(f, newest.get(who))) newest.set(who, f);
  }
  return [...newest.values()]
    .map((f) => ({ fileId: f.fileId, name: f.owner || f.name, ownerId: f.ownerId ?? null }))
    .sort((a, b) => a.name.localeCompare(b.name));
}
