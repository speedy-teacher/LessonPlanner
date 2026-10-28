// Where a lesson deck's or folder's file lives. A record keeps a list of
// locations (for example a Google Drive file and a copy on the computer) and
// the planner uses the first one it can reach. Whether a location can be
// reached is checked while the planner runs and never saved: an unreachable
// one gets a warning but is never removed, so the workspace keeps working
// when it's opened on another computer or Drive permissions change.
//
// Google Drive: { kind: 'drive', uri: 'https://drive.google.com/open?id=<fileId>', fileId, mimeType, modifiedTime, lastSeenAt }
// Computer:     { kind: 'local', uri: 'local:<rootId>/<path>', rootId, path, size, modifiedTime, lastSeenAt }
//
// `rootId` points at a `localRoots` record: a folder picked on a computer. Each computer gives the
// planner access to its own copy of that folder once (kept in that browser, never in the workspace),
// and `path` is the file's place inside it ('' for the folder itself). Files picked one by one have
// no root (rootId null) and can only be found again by picking them again.
// `lastSeenAt` is when the file was last found (at most updated once a day).

export function driveUri(fileId) {
  return `https://drive.google.com/open?id=${encodeURIComponent(fileId)}`;
}

const GOOGLE = 'application/vnd.google-apps.';
const OFFICE = 'application/vnd.openxmlformats-officedocument.';

// Which Google editor opens each kind of file (Word, Excel and PowerPoint files kept in Drive open there too).
const EDITORS = {
  presentation: [`${GOOGLE}presentation`, `${OFFICE}presentationml.presentation`, 'application/vnd.ms-powerpoint', 'application/vnd.oasis.opendocument.presentation'],
  document: [`${GOOGLE}document`, `${OFFICE}wordprocessingml.document`, 'application/msword', 'application/vnd.oasis.opendocument.text'],
  spreadsheets: [`${GOOGLE}spreadsheet`, `${OFFICE}spreadsheetml.sheet`, 'application/vnd.ms-excel', 'application/vnd.oasis.opendocument.spreadsheet'],
  forms: [`${GOOGLE}form`],
  drawings: [`${GOOGLE}drawing`],
};
const EDITOR_NAMES = { presentation: 'Google Slides', document: 'Google Docs', spreadsheets: 'Google Sheets', forms: 'Google Forms', drawings: 'Google Drawings' };

function editorFor(mimeType) {
  // Decks saved before file kinds were kept were all slide decks.
  if (!mimeType) return 'presentation';
  return Object.keys(EDITORS).find((editor) => EDITORS[editor].includes(mimeType)) ?? null;
}

/**
 * The address that opens a Drive file straight in its Google editor (people who may only view it
 * get the same page in view-only mode — Google decides that). Files no editor opens (e.g. PDFs,
 * pictures) open in Drive's viewer.
 */
export function driveOpenUrl(location) {
  const id = encodeURIComponent(location.fileId);
  const editor = editorFor(location.mimeType);
  return editor ? `https://docs.google.com/${editor}/d/${id}/edit` : `https://drive.google.com/file/d/${id}/view`;
}

/** What the open link is called: "Open in Google Docs", or "Open in Google Drive" for other files. */
export function driveOpenLabel(location) {
  return `Open in ${EDITOR_NAMES[editorFor(location.mimeType)] ?? 'Google Drive'}`;
}

/** File kinds the planner can fill details into ({{school}}, {{lesson_number}}…): Google Docs, Sheets and Slides. */
export const FILLABLE_TYPES = [`${GOOGLE}document`, `${GOOGLE}spreadsheet`, `${GOOGLE}presentation`];

/**
 * Whether details can be filled in automatically for a lesson: its Drive file is a Google Doc, Sheet
 * or Slides deck. A lesson with no file yet still can (its file will be made later).
 */
export function canFillIn(record) {
  if (!record?.locations?.length) return true;
  const drive = findLocation(record, 'drive');
  if (!drive) return false;
  return !drive.mimeType || FILLABLE_TYPES.includes(drive.mimeType);
}

export function localUri(rootId, path) {
  return `local:${rootId ?? ''}/${path.split('/').map(encodeURIComponent).join('/')}`;
}

export function driveLocation({ fileId, mimeType = null, modifiedTime = null }, seenAt = null) {
  return { kind: 'drive', uri: driveUri(fileId), fileId, mimeType, modifiedTime, lastSeenAt: seenAt };
}

export function localLocation({ rootId = null, path, size = null, modifiedTime = null }, seenAt = null) {
  return { kind: 'local', uri: localUri(rootId, path), rootId, path, size, modifiedTime, lastSeenAt: seenAt };
}

/** The record's first location of a kind ('drive' or 'local'), or null. */
export function findLocation(record, kind) {
  return record?.locations?.find((l) => l.kind === kind) ?? null;
}

export function driveFileId(record) {
  return findLocation(record, 'drive')?.fileId ?? null;
}

export function hasLocation(record, uri) {
  return Boolean(record?.locations?.some((l) => l.uri === uri));
}

/** Add a location to a record, or refresh the one with the same address. */
export function addLocation(record, location) {
  const i = record.locations.findIndex((l) => l.uri === location.uri);
  if (i === -1) record.locations.push(location);
  else record.locations[i] = { ...record.locations[i], ...location };
  return record;
}

/** Note that a location was found just now (only once a day, so the workspace doesn't change constantly). */
export function markSeen(location, now) {
  if (location && location.lastSeenAt?.slice(0, 10) !== now.slice(0, 10)) location.lastSeenAt = now;
}
