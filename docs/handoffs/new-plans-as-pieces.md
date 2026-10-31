# Handoff: create new plans as pieces (School Year + Lesson Schedule + Teacher Resources)

**DONE** — implemented as specified in `docs/plans/new-plans-as-pieces.md` (kept below for background).

For another agent. Read `CLAUDE.md` first (esp. "Plans in pieces"), then `docs/plans/data-split.md`.

## Where things stand
- Branch `claude/lesson-planner-data-split-fdf88c` (worktree `.claude/worktrees/lesson-planner-data-split-fdf88c`), version 0.5.0.
  **It may not be merged to `main` yet — ask the user.** If it is merged, start from `main`; if not, branch off it.
- Done and tested (357-ish tests, `npm test`, `npm run lint`): the three piece files, `PiecePlan` engine, converting an
  older one-file plan ("Share with your department…"), joining a colleague's School Year, "Looking at" teammates,
  view-only pages, exports/reports from your own plan only, one Teacher Resources per teacher (`resourceMerge.js`).
- Tried against real Drive (one account): conversion, cold open, per-piece saving, concurrent edits, second year reusing
  the same Resources, teammate view. **Not tried:** a second Google account sharing a piece as Viewer.

## The problem to solve
**Nothing creates a plan in the new format.** Every way of making a plan still makes the old one-file format, so new users
(and every new school year) get the "New: share with your department" notice and must convert:
- `views/plans.js` → `openNewYear` → `newYearPlan(store.state, …)` (workspaceFile.js) → `createPlan` (workspace.js) — new
  school year, and the first plan a new user makes from the Welcome screen.
- `views/plans.js` file button / `importPlannerData` (workspace.js) → `splitYears` → `createPlan` — opening a downloaded
  plan or the old computer-only planner data.
- `createPiecePlan(state, { folderId, reuseResources })` (workspace.js) already makes the three files from one year's
  combined state; `splitCurrentPlan` uses it for conversion.

Goal: new plans are born as pieces. `offerSharing()` (views/shareSetup.js) should then only ever appear for genuinely old
plans. The old one-file code path must keep working (people still have old plans); don't remove it.

## Design decisions to make (recommend, then confirm with the user — they're non-technical; explain the consequence)
1. **First plan for a new user** (no plan yet): make all three files at once with `createPiecePlan` (Drive when connected,
   else this computer). Name them as `pieceFileName` does.
2. **New school year when the open plan is in pieces** — what's new vs reused:
   - New **School Year** file for the new year (carried over from the old one: instruments, schools, grades, outcomes,
     criteria, holidays; calendars start empty). Use `newYearPlan`'s logic (`keepIds` keeps ids, so everything the
     teacher's long-lived Resources and lesson order point at still matches). *Question:* in a department, should the
     second teacher make their own next-year School Year or join the first teacher's? Recommend: the "first" teacher makes
     it and others use "Join" (joinYear.js matches by name — **improve it to match by id first**, since carried-over
     records keep their ids).
   - New **Lesson Schedule** for the new year: empty schedule, but the **lesson order** (`criterionLessons`) is copied
     (it's the teacher's, in the Schedule piece). Colors (`looks`), `settings`, reports settings carry over; `output`
     (lesson-copies folder) — decide (old behaviour: calendars empty, output per year).
   - **Same Teacher Resources** — do not copy or recreate; link the new Schedule to the existing one (`meta.links.resources`).
   - Use the teacher's **own** data (`myPlanState()`), never the teammate currently shown by "Looking at".
3. **Import paths** (`importPlannerData`, open-from-file): decide whether they make pieces (recommended: yes, with
   `reuseResources: true` so a second imported year joins the same Resources via `resourceMerge.js`).
4. **Menu/wording:** the plan menu lists Drive plans via `listPlanFiles` (old plans + Schedules). Check the list, "Open now"
   section, Welcome screen text, and the `welcome` / `plans` / `sharing` tutorials (`tutorials.js`) still make sense —
   `ctx.inPieces` is available to tutorial steps.

## Pointers
- `pieces.js` (split/compose/`PIECES`/`TEACHER_FIELDS`), `pieceEngine.js` (`PiecePlan`, `rebaseState`, `whyUnavailable`),
  `workspace.js` (`createPiecePlan`, `resourcesFor`/`myResources`, `splitCurrentPlan`, `joinSchoolYear`, `openPieces`),
  `workspaceFile.js` (`newYearPlan`, `keepIds`, `yearOnly`), `resourceMerge.js`, `joinYear.js`, `driveFiles.js`
  (labels `lessonPlanner`=schoolYear|schedule|resources, `lpSchoolYear`; `listMyResources`, `listSchedulesFor`).
- Keep the pure parts pure and tested (`test/*.test.js`, node --test); put browser-only wiring in `workspace.js` / views.
  `workspace.js` is ~690 lines (limit 800) — move new logic into a new module rather than growing it much.
- Known hazard (fixed once): edits made while a sync runs. Any new code that replaces `store.state` from pieces must first
  `await pieces.save(store.state)` (see `syncPieces`, `viewTeammate`).
- Every new feature needs: tests, a tutorial step where a teacher would learn it, an assistant command if it changes data
  (`agentCommands*.js`, `test/agentCommands*.test.js`), README/CLAUDE.md update, and a version bump before merging to
  `main` (`public/js/version.js`, `package.json`, both spots in `package-lock.json`; minor for a feature).

## Working agreements (from the user's global rules — follow them)
- The user is not technical: plain language, a recommendation and its practical consequence for each decision.
- Feature branch, commit at milestones, then **recommend** merging to `main` and wait for the user's OK.
- **Real data safety:** never open, sync or change the user's real plans. Test with made-up data only. The user's Google
  sign-in in the test browser can reconnect by itself after a reload — **always create a separate Drive test folder first
  (e.g. "Lesson Planner – TEST (safe to delete)") and pass its `folderId`; a plan created without `folderId` lands in the
  user's real "Lesson Planner" folder** (this happened once). Don't trash Drive files yourself: list the folder for the
  user to delete. No real names, schools, emails or Google codes in code, tests, commits or chat. Never open anything with
  "roster" in its name.
- Run the app with the `lesson-planner` launch config (`.claude/launch.json`, port 5178). A Drive test needs the user to
  click "Connect Google Drive" (popups only open from their own click); `public/config.js` (gitignored) holds the Google
  codes — copy it from the main checkout into the worktree.
- Static analysis thresholds are enforced by `npm run lint` (complexity 10, cognitive 14, 5 params, 800 lines, function length).

## Definition of done
- A brand-new user, a new school year, and file import all produce pieces; old one-file plans still open and still convert.
- No "share with your department" notice for plans made this way.
- Tests for the pure parts; verified in the browser against Drive using only a test folder; the user told which Drive files
  to delete.
