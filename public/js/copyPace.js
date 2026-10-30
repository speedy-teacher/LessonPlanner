// How many lesson copies to work on at once. Normally a few (faster), but when Google says
// "slow down" (lots of copies, or several teachers updating at the same time on the shared Google
// project) it drops to one at a time, then speeds back up one step every half minute.
//
// Pure, shared by the browser app and the Node tests.

export const MOST_JOBS = 4;
/** After a "slow down", one more job is allowed every this often. */
export const STEP_MS = 30 * 1000;

export function copyPace({ most = MOST_JOBS, now = Date.now } = {}) {
  let slowedAt = null;
  return {
    /** Google asked the planner to slow down. */
    slowDown() { slowedAt = now(); },
    /** How many copies may be worked on at once right now. */
    jobs() {
      if (slowedAt === null) return most;
      return Math.min(most, 1 + Math.floor((now() - slowedAt) / STEP_MS));
    },
  };
}
