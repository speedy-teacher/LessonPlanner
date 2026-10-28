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
