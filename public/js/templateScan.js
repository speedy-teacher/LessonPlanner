// Reading a lesson's template file to see what it asks for, so nobody has to tick anything.
// The text details ({{school}}, {{week_number}}…) need no scan: they are filled in wherever they are
// found. The picture spot (IMAGE_ANCHOR, Google Slides only) does: lessons whose template has one take
// part in choosing pictures. Only the yes/no is saved on the lesson (`scan`), never the file's contents.
//
// scanSlides / scansNeeded / recordScan are pure (tested); scanTemplates does the Google call.

import { pictureAnchors } from './exportFill.js';
import { SLIDES } from './exportGoogle.js';
import { findLocation } from './locations.js';

const SLIDES_URL = 'https://slides.googleapis.com/v1/presentations';
const SLIDES_FIELDS = 'slides(objectId,pageElements(objectId,title,description,size,transform))';

/** What a Slides presentation asks for. */
export function scanSlides(presentation) {
  return { picture: pictureAnchors(presentation).length > 0 };
}

/** Lessons whose template (a Google Slides file) hasn't been read since it last changed: [{ lesson, location }]. */
export function scansNeeded(state, yearId) {
  return state.lessons.filter((l) => l.yearId === yearId).map((lesson) => ({ lesson, location: findLocation(lesson, 'drive') }))
    .filter(({ lesson, location }) => location?.mimeType === SLIDES && !isCurrent(lesson.scan, location));
}

const isCurrent = (scan, location) => Boolean(scan) && scan.fileId === location.fileId && scan.modifiedTime === location.modifiedTime;

/** Note what was found (on the lesson, next to the file version it was found in). */
export function recordScan(lesson, location, found) {
  lesson.scan = { fileId: location.fileId, modifiedTime: location.modifiedTime ?? null, picture: found.picture };
}

const failed = new Set(); // files that couldn't be read this visit (not tried again until the file changes)

/**
 * Read every template that needs it. `annotate(mutate)` saves the findings (store.js). Returns true when
 * anything was recorded. A file that can't be read is left as it was (older lessons keep their tick).
 */
export async function scanTemplates({ state, yearId, token, annotate, fetchFn = fetch }) {
  let recorded = false;
  for (const { lesson, location } of scansNeeded(state, yearId)) {
    const key = `${location.fileId}|${location.modifiedTime}`;
    if (failed.has(key)) continue;
    try {
      const found = scanSlides(await readSlides(location.fileId, token, fetchFn));
      annotate((s) => { recordScan(s.lessons.find((l) => l.id === lesson.id), location, found); });
      recorded = true;
    } catch {
      failed.add(key);
    }
  }
  return recorded;
}

async function readSlides(fileId, token, fetchFn) {
  const res = await fetchFn(`${SLIDES_URL}/${encodeURIComponent(fileId)}?fields=${encodeURIComponent(SLIDES_FIELDS)}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`slides_${res.status}`);
  return res.json();
}
