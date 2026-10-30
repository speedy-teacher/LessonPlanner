// Pictures that couldn't be placed in lesson copies (this visit only, never saved).
// A picture that fails goes "on hold": copies are made without it for now, so one problem doesn't
// mean one failed try per copy. Held pictures are let go again — and so tried again — after a data
// change, on the regular recheck and when the Google sign-in is renewed. When Google wouldn't let the
// planner share the picture ('cant_share'), it stays held until the picture is found shared (or picked
// again), because trying again wouldn't help. The problem is remembered (even once let go) so the
// copies' status can say what went wrong, until a copy gets the picture.

const CANT_SHARE = 'cant_share';
const RETRY_WHEN = ['change', 'recheck', 'signin'];

/** An empty book of picture problems. */
export function pictureHolds() {
  return new Map(); // Drive file id → { reason, lessonId, since, lastTry, tries, onHold }
}

/**
 * The picture `fileId` couldn't be placed (`reason` = the problem's code). Puts it on hold.
 * Returns true when the person should be told: the first time, or when the problem is a different one.
 */
export function holdPicture(holds, fileId, { reason, lessonId = null, now = Date.now() }) {
  const before = holds.get(fileId);
  const tell = !before || before.reason !== reason;
  holds.set(fileId, {
    reason, lessonId, since: tell ? now : before.since, lastTry: now,
    tries: (before?.tries ?? 0) + 1, onHold: true,
  });
  return tell;
}

/** Copies are being made without this picture for now. */
export function isHeld(holds, fileId) {
  return Boolean(holds.get(fileId)?.onHold);
}

/**
 * Let held pictures go so the next look tries them again. `why` = 'change' | 'recheck' | 'signin'
 * (every picture except those Google wouldn't let the planner share) or 'sharing' (just `fileIds`,
 * whatever the problem). Returns the file ids let go.
 */
export function releaseHeld(holds, why, fileIds = []) {
  const picks = why === 'sharing'
    ? ([fileId]) => fileIds.includes(fileId)
    : ([, p]) => RETRY_WHEN.includes(why) && p.reason !== CANT_SHARE;
  const ids = [...holds].filter(([, p]) => p.onHold).filter(picks).map(([fileId]) => fileId);
  ids.forEach((id) => { holds.get(id).onHold = false; });
  return ids;
}

/** A copy got the picture: its problem is over. */
export function picturePlaced(holds, fileId) {
  return holds.delete(fileId);
}

/** What went wrong, in plain words, for the copies' status (and assistants). */
export function pictureAdvice(reason) {
  return reason === CANT_SHARE
    ? 'Google didn’t let the planner share the picture for a moment to place it. Share it in Google Drive with “Anyone with the link” and the planner places it.'
    : 'Google couldn’t fetch the picture to place it. The planner tries again by itself every few minutes, after your next change, and when Google Drive reconnects.';
}

/**
 * Every picture problem this visit, for copyStatus(): [{ fileId, reason, advice, onHold, tries,
 * since, lastTry (ISO times), lessonId }]. `onHold` false = being tried again.
 */
export function pictureReport(holds) {
  return [...holds].map(([fileId, p]) => ({
    fileId, reason: p.reason, advice: pictureAdvice(p.reason), onHold: p.onHold, tries: p.tries,
    since: new Date(p.since).toISOString(), lastTry: new Date(p.lastTry).toISOString(), lessonId: p.lessonId,
  }));
}
