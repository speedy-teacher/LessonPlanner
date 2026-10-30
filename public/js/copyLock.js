// Only one computer (or browser tab) updates a plan's lesson copies at a time, so two computers
// signed in as the same teacher don't both make the same copy or the same week folder.
//
// The one working leaves a note on the plan's copies folder in Drive (hidden labels: who, and until
// when) and renews it while it works. Others see the note and wait. A note nobody renews runs out
// (that computer was closed or lost the internet), and then someone else may take over.
// Drive can't check-and-set in one step, so a new claim is read back after a moment: if two claimed
// at once, only the last one written keeps it. Anything that still slips through is tidied up later
// (extra copies are trashed, same-name folders combined).
//
// Pure apart from the `read`/`write` it's given (exportDrive.js folderLabels), shared with the tests.

/** How long a note lasts without being renewed. */
export const CLAIM_MS = 3 * 60 * 1000;
/** How long to wait before reading a new claim back. */
const READ_BACK_MS = 1500;

const sleep = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });

/** Who holds the copies right now: 'free' · 'mine' · 'taken' (by someone else). */
export function claimState(labels, me, now) {
  const until = Number(labels?.lpWorkerUntil) || 0;
  if (!labels?.lpWorker || until <= now) return 'free';
  return labels.lpWorker === me ? 'mine' : 'taken';
}

/**
 * `me` = this computer/tab (a random id per visit). Returns { claim, release }:
 * claim() → 'new' (just claimed: the copies may have changed since this computer last looked),
 * 'kept' (still this computer's, renewed) or 'taken' (someone else is updating them).
 */
export function copyLock({ read, write, me, now = Date.now, wait = sleep }) {
  const note = () => ({ lpWorker: me, lpWorkerUntil: String(now() + CLAIM_MS) });

  async function claim() {
    const before = claimState(await read(), me, now());
    if (before === 'taken') return 'taken';
    await write(note());
    if (before === 'mine') return 'kept';
    await wait(READ_BACK_MS);
    return claimState(await read(), me, now()) === 'mine' ? 'new' : 'taken';
  }

  async function release() {
    if (claimState(await read(), me, now()) === 'mine') await write({ lpWorker: null, lpWorkerUntil: null });
  }

  return { claim, release };
}
