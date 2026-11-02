// End-to-end browser tests: "Looking at" per tab (docs/plans/looking-at-per-tab-e2e.md).
// Run in the real app, in the Browser pane, at http://127.0.0.1:5178 (never localhost). See README.md.
//
//   const t = await import('/e2e/lookingAt.e2e.js'); await t.reset();      // then reload the page
//   const t = await import('/e2e/lookingAt.e2e.js'); await t.run({ only: 'L1' });
//
// Colleagues' files live in a pretend Google Drive inside the page (fakeDrive.js): nothing reaches Google,
// and a case fails if anything tried. Made-up names only. One case per page load, on a fresh computer.

import * as workspace from '/js/workspace.js';
import { store } from '/js/store.js';
import { allPlans } from '/js/localCache.js';
import { check, guardHost, sleep, watchErrors } from './helpers.js';
import * as fakeDrive from './fakeDrive.js';
import { CASES_ACCESS } from './lookingAtAccess.js';
import { CASES_LISTS } from './lookingAtLists.js';
import { CASES_MINE } from './lookingAtMine.js';
import { CASES_SIGN_IN } from './signInLate.js';
import { CASES_CAPSULES } from './capsules.js';

export { reset } from './helpers.js';

const CASES = { ...CASES_LISTS, ...CASES_ACCESS, ...CASES_MINE, ...CASES_SIGN_IN, ...CASES_CAPSULES };

// ---------- running ----------

async function runCase(name) {
  const stop = watchErrors();
  let error = null;
  try {
    await CASES[name]();
  } catch (err) {
    error = err?.message ?? String(err);
  }
  await sleep(150);
  const problems = stop();
  const stray = fakeDrive.violations();
  if (!error && stray.length) error = `a request tried to reach Google: ${stray.join('; ')}`;
  if (!error && problems.length) error = `errors while running: ${problems.join('; ')}`;
  return { name, ok: !error, error };
}

/** The cache is empty and nothing is open: a fresh computer. */
async function requireFresh() {
  const records = await allPlans();
  check(records.length === 0 && !workspace.current && !store.state, 'This is not a fresh computer: call reset(), reload the page, then run one case.');
}

/** Run cases: `only` = 'L1', or a list. Always run one case per page load (see README.md). */
export async function run({ only } = {}) {
  guardHost();
  const names = only ? [].concat(only) : Object.keys(CASES);
  const results = [];
  for (const name of names) {
    check(CASES[name], `No case named ${name}`);
    try { await requireFresh(); } catch (err) { results.push({ name, ok: false, error: err.message }); continue; }
    results.push(await runCase(name));
  }
  const passed = results.filter((r) => r.ok).length;
  return { passed, failed: results.length - passed, results };
}
