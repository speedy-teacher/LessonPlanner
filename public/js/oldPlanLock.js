// Before an older one-file plan is moved to pieces, its Drive version is locked in: the plan must be
// fully saved to Drive, and Drive must agree to keep that version forever. If either fails the move is
// stopped (nothing is changed), so the old plan can always be gone back to.
//
// Pure logic: Drive calls are handed in, so the Node tests can run it against fakes.

/**
 * `saved()` → everything reached Drive; `info()` → { rev }; `keep(rev)` asks Drive to keep that version.
 * Throws Error('not_saved') or Error('cant_keep_backup').
 */
export async function lockOldVersion({ saved, info, keep }) {
  if (!saved()) throw new Error('not_saved');
  const { rev } = await info();
  if (!rev) throw new Error('cant_keep_backup');
  try {
    await keep(rev);
  } catch {
    throw new Error('cant_keep_backup');
  }
  return rev;
}
