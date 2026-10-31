// Which of the plan records cached on this computer a teacher sees and works with. Besides older
// one-file plans, the cache holds every piece of a plan in pieces (School Year, Lesson Schedule,
// Teacher Resources) and "rescue" copies kept while the page closed; only plans the teacher opens
// are listed, and removing one tidies up its own pieces.
//
// Pure logic, shared by the browser app and the Node tests.

const isRescue = (rec) => String(rec.key).startsWith('rescue:');

/** Plans kept only on this computer that a teacher can open: older one-file plans and Lesson Schedules. */
export function listedPlans(records) {
  return records.filter((rec) => !rec.fileId && !isRescue(rec) && (!rec.piece || rec.piece === 'schedule'));
}

/** Ids of the years already held in cached plans (older one-file plans and School Year pieces). */
export function broughtInYearIds(records) {
  const ids = new Set();
  for (const rec of records) {
    const years = rec.piece === 'schoolYear' ? rec.data?.years : rec.state?.years;
    for (const y of years ?? []) ids.add(y.id);
  }
  return ids;
}

/**
 * The cached records to delete when a plan kept on this computer is removed: the plan itself, its
 * rescue copy, and its School Year when that is also only on this computer and no other plan uses it.
 * Teacher Resources is never removed (other years use it).
 */
export function keysToRemove(records, scheduleKey) {
  const keys = [scheduleKey, `rescue:${scheduleKey}`];
  const yearKey = linkedYearKey(records.find((rec) => rec.key === scheduleKey));
  const year = yearKey && records.find((rec) => rec.key === yearKey);
  const sharedWithOthers = records.some((rec) => rec.key !== scheduleKey && linkedYearKey(rec) === yearKey);
  if (year && !year.fileId && !sharedWithOthers) keys.push(yearKey);
  return keys;
}

/** The key of the School Year a Lesson Schedule record is linked to (null for anything else). */
function linkedYearKey(rec) {
  return rec?.piece === 'schedule' ? rec.data?.meta?.links?.schoolYear?.key ?? null : null;
}
