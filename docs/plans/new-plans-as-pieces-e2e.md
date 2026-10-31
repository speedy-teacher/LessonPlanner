# End-to-end tests: new plans are born as pieces

Companion to `docs/plans/new-plans-as-pieces.md`. These run the real app in a real browser, through its buttons where a
teacher would click, on this computer only (no Google Drive). A separate manual pass covers Drive (bottom of this file).

## Harness
- `test/e2e/newPlans.e2e.js` — an ES module exporting `async function run({ only } = {})` → `{ passed, failed, results:
  [{ name, ok, error }] }`. Cases are plain async functions using a tiny `check(cond, message)`; one failing case doesn't
  stop the others. It imports the app's own modules by absolute path (`/js/workspace.js`, `/js/store.js`,
  `/js/localCache.js`, `/js/deviceSettings.js`, `/js/model.js`, `/js/workspaceFile.js`, `/js/pieces.js` …) so it shares
  the running app's module instances.
- `test/e2e/README.md` — how to run (below), what each case proves.
- `server.js`: serve `test/e2e/*` at `/e2e/…` (GET only, same path-escape guard as `serveStatic`, `.js` as
  `text/javascript`). Local server only — the Pages site never has it. Add a `test/server.test.js` case: `/e2e/` serves a
  file from test/e2e and refuses `/e2e/../server.js`.
- **Isolation (required):** run at `http://127.0.0.1:5178`, never `http://localhost:5178`. Browser storage is per
  origin, so 127.0.0.1 has none of the teacher's cached plans, and Google sign-in can't connect there (only localhost is
  registered) — so nothing can reach Drive. The harness must refuse to run when `location.hostname !== '127.0.0.1'`.
- Every case starts on a fresh computer: `export async function reset()` deletes the IndexedDB database(s) that
  `localCache.js` uses and clears `localStorage`. A reload can't happen inside a run, so each case is its own call:
  `reset()` → reload the page → `run({ only: 'E1' })`. Cases needing a reload in the middle (E2) are split into two
  parts (`E2a`, then reload, `E2b`) that the README runs in order without a reset between them.
- UI helpers in the harness: `click(text or selector)`, `fill(label, value)`, `waitFor(fn, ms)`, `openPlansMenu()`
  (click `[data-tour="plan-button"]`), `startNewYear({ name, start, end, copy })` (plans menu → `[data-tour="start-year"]`
  → fill the window → "Create year"), `chooseFile(input, json)` (DataTransfer → `input.files`, dispatch `change`).
  Make data with the app's commands (`window.lessonPlanner.run(...)`, see `lessonPlanner.help()`) or `commit()` from
  `/js/store.js` — not by writing records directly — so saving goes through the real save path.
- Read results back from the cache (`allPlans()` from `/js/localCache.js`) and from `pieces`/`current` in
  `/js/workspace.js`. Wait for saves (`flushSave()` from store.js) before reading the cache.

## Cases
Each lists what is done and what must be true. Use made-up names only ("Test Year 2030–31", "Maple School", "Drum").

- **E1 First plan on a fresh computer is three pieces.** Welcome screen shows; click "Start a new school year", name
  "Test Year 2030–31", dates 2030-08-26 → 2031-06-13, Create. Then: `pieces` is not null; `current.kind === 'pieces'`;
  the cache holds exactly one School Year, one Lesson Schedule and one Teacher Resources record, none with a `fileId`,
  none is an old one-file plan (`state` field); the schedule's `meta.links` point at the other two keys. No notice with
  id `share-offer` is shown (also after calling `offerSharing()` from `/js/views/shareSetup.js`). The plans menu has no
  "Share with your department…" button.
- **E2 Edits land in the right piece and survive a reload.** In E1's plan add a school and a grade (Setup or commands),
  a lesson template, an outcome + eval with that lesson in its order, and one Lesson Schedule entry. After `flushSave`:
  the school/grade/outcome are in the School Year record's data, the template in Resources, the week entry and lesson
  order in the Schedule. Reload: the same plan opens (in pieces) with all of it.
- **E3 New school year reuses the same Teacher Resources.** From E2's state, plans menu → Start a new school year
  ("Test Year 2031–32", copy ticked). Then: 2 School Years, 2 Schedules, still exactly **1** Resources record, and the
  new Schedule links to it. The new plan has the school/grade/outcome/eval with **the same ids** as last year, the
  lesson order (same lesson ids), the template, no weekly schedule entries, no calendar placements. The grade color is
  kept. Switching back to "Test Year 2030–31" from the plans menu shows its week entry unchanged.
- **E4 New year without copying still keeps templates and pictures.** As E3 but copy unticked: School Year empty
  (no schools/outcomes), lesson order empty, yet the Lesson Templates page still lists the template; 1 Resources record.
- **E5 Importing a two-year file makes pieces and one Resources.** On a fresh computer, build an older-format planner
  file in the test (with `/js/model.js` + `/js/seed.js`: two years, a template carried over from year 1 to year 2 with
  `copiedFromId`, plus a template only in year 1) and feed it to the plans menu's "📂 Open a plan file from this computer"
  input. Then: 2 School Years, 2 Schedules, exactly 1 Resources holding each template once (the carried-over one not
  doubled); the year that was active in the file is open, in pieces; no `share-offer` notice.
- **E6 A downloaded copy of a plan in pieces imports as pieces.** Download-copy text = `toWorkspaceFile(myPlanState())`
  of E2's plan; import it on a fresh computer → pieces, same counts of schools/templates/week entries as the original.
- **E7 Old one-file plans still work and still convert.** On a fresh computer, make an old-format plan with
  `createPlan({ name, state }, { open: true })` from `/js/workspace.js` (state = one seeded year). Then `pieces` is null,
  the plans menu shows "🤝 Share with your department…", and editing it saves to the old record (its `state`). Convert
  with the button → "Start a new shared School Year": now in pieces, 3 piece records, the old record is kept and renamed
  "(old – before sharing)".
- **E8 Plan lists only show plans.** With E3's two years plus an old one-file plan cached: the plans menu's "On this
  computer only" list shows exactly the two Lesson Schedules and the old plan — no "School Year …" or "Teacher Resources"
  rows. The "Your plans from the planner on this computer" box doesn't break the menu (no console errors).
- **E9 Removing a local plan in pieces.** With E3's two years: remove "Test Year 2031–32" from the list (× → Remove).
  Its Schedule and School Year records are gone; the Resources record and the other year's School Year remain; the
  other year still opens with its data.
- **E10 Plans menu for a plan in pieces.** On this computer only: no "Share the School Year in Drive ↗" link (no Drive
  file) and no "Use a colleague's School Year…" button (needs Drive); "☁ Save to Google Drive" is offered only when
  Drive is connected (it isn't here). The new-year window has no "Use one a colleague already made" choice when Drive
  isn't connected.

Each case also checks `read_console_messages`-visible errors: wrap `window.onerror`/`unhandledrejection` during the case
and fail it on any error.

## How to run (README content)
1. Start the dev server (`.claude/launch.json` config `lesson-planner`, port 5178).
2. In the browser open `http://127.0.0.1:5178/`.
3. For each case: `const t = await import('/e2e/newPlans.e2e.js'); await t.reset();` → reload →
   `const t = await import('/e2e/newPlans.e2e.js'); await t.run({ only: 'E1' })`. Cases that build on another (E2 on
   E1, E3/E4/E8/E9 on E2) set up what they need themselves through the same UI helpers (they don't rely on a previous
   case's leftovers).
4. All cases must pass. Record the results in the final report.

## Manual Drive pass (done by the lead with the teacher's sign-in, at localhost, in a test folder only)
Create "Lesson Planner – TEST (safe to delete)" first and pass its folderId everywhere. Check: first plan → 3 labelled
files in that folder; new year → one Teacher Resources file still; import two years → one Resources; new-year "Use one a
colleague already made" with the first year's School Year rolled over (matched by id, no review step); plans-menu join;
"Share the School Year in Drive ↗" link opens the School Year file. Then list the files for the teacher to delete.
